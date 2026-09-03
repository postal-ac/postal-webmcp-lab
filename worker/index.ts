/**
 * Postal WebMCP Lab — edge Worker.
 *
 * Two jobs, and deliberately no more:
 *
 *   1. Turn a Postal sign-in into an httpOnly session cookie, so the access
 *      token never lives in a place page scripts (or a tool an agent calls)
 *      can read it.
 *   2. Proxy an allow-listed set of Postal endpoints, attaching that token
 *      server-side.
 *
 * The allow-list matters. Without it this Worker would be an open,
 * credential-bearing relay to every endpoint on the Postal API — an agent that
 * went off-script could reach far past the five capabilities the page
 * advertises. The list below is exactly what the five WebMCP tools need.
 *
 * Two ways in:
 *
 *   - Postal accounts sign in with an emailed code (request → verify).
 *   - Reviewers who cannot read that inbox enter a shared access code and get
 *     a session minted from a pre-issued demo token held as a Worker secret.
 *     Optional: leave DEMO_ACCESS_CODE unset and that door does not exist.
 */

/** Cloudflare's rate-limiting binding, as much of it as this Worker uses. */
interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Sign-in attempts per IP. Absent in environments that cannot bind one. */
  AUTH_RATE_LIMIT?: RateLimiter;
  /** Reviewer-door attempts per IP — tighter, because it guards a shared code. */
  DEMO_RATE_LIMIT?: RateLimiter;
  POSTAL_API_URL: string;
  POSTAL_API_KEY: string;
  SESSION_SECRET: string;
  /** Shared code reviewers type in to reach the demo account. */
  DEMO_ACCESS_CODE?: string;
  /** A Postal access token for the demo account (30-day, revocable). */
  DEMO_ACCESS_TOKEN?: string;
}

const SESSION_COOKIE = "postal_webmcp_session";
const SESSION_MAX_AGE = 60 * 60 * 8;

/**
 * The reviewer access code is a bearer credential that opens a live Postal
 * session, and this repo is public — so the endpoint's shape is known to
 * anyone. Rate limiting slows guessing down; entropy is what actually stops
 * it. Refuse to enable the door with a code short enough to be guessed.
 */
const MIN_DEMO_CODE_LENGTH = 20;

/**
 * Fallback limiter for when no rate-limit binding exists (a plain `wrangler
 * dev`, or a self-hoster who has not configured one). Per-isolate and
 * therefore leaky across colos — it is a backstop, not the real control.
 */
const isolateHits = new Map<string, { count: number; resetAt: number }>();

function isolateRateLimit(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = isolateHits.get(key);
  if (!entry || entry.resetAt <= now) {
    isolateHits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

/**
 * The caller's IP, from the one header that cannot be spoofed here:
 * Cloudflare sets `cf-connecting-ip` at the edge and overwrites whatever the
 * client sent. `x-forwarded-for` is deliberately NOT consulted — trusting it
 * would let a caller rotate the header to slip both this Worker's rate limits
 * and Postal's (the backend runs `trust proxy`, so it reads that header too).
 * Outside Cloudflare there is no trustworthy source, so everyone shares one
 * bucket, which fails closed rather than open.
 */
function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

/** Returns true when the caller may proceed. */
async function withinRateLimit(
  limiter: RateLimiter | undefined,
  request: Request,
  scope: string,
  fallbackLimit: number,
): Promise<boolean> {
  const key = `${scope}:${clientIp(request)}`;
  if (limiter) return (await limiter.limit({ key })).success;
  return isolateRateLimit(key, fallbackLimit);
}

function tooManyRequests(): Response {
  return json(
    { message: "Too many attempts. Wait a minute and try again." },
    { status: 429 },
  );
}

/** The reviewer door only exists when it is configured to a usable standard. */
function demoConfigured(env: Env): boolean {
  return Boolean(
    env.DEMO_ACCESS_TOKEN &&
      env.DEMO_ACCESS_CODE &&
      env.DEMO_ACCESS_CODE.length >= MIN_DEMO_CODE_LENGTH,
  );
}

interface SessionPayload {
  accessToken: string;
  musicianId?: string;
  organisationId?: string;
  user: { id?: string; email?: string; name?: string };
}

const ALLOWED_ENDPOINTS: { method: string; pattern: RegExp }[] = [
  { method: "GET", pattern: /^\/tracks\/all$/ },
  { method: "GET", pattern: /^\/pack$/ },
  { method: "GET", pattern: /^\/tracks\/details\/[^/]+$/ },
  // Precomputed peaks + section markers for the page's player and for
  // get_now_playing's "sections you can jump to".
  { method: "GET", pattern: /^\/tracks\/[^/]+\/waveform$/ },
  { method: "GET", pattern: /^\/pack\/manage$/ },
  // Brief → ranked tracks (match_brief). Read-only for the catalogue, but it
  // is a metered AI call: Postal charges the account one credit per request.
  { method: "POST", pattern: /^\/smart-playlists\/generate-from-brief$/ },
  { method: "POST", pattern: /^\/pack\/create$/ },
  { method: "POST", pattern: /^\/pack\/add-tracks$/ },
  { method: "POST", pattern: /^\/pack\/remove-track$/ },
  { method: "PATCH", pattern: /^\/pack\/update$/ },
  { method: "PATCH", pattern: /^\/pack\/reorder$/ },
  { method: "DELETE", pattern: /^\/pack\/delete$/ },
  { method: "POST", pattern: /^\/packs\/[^/]+\/modes\/PRIVATE\/link$/ },
];

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sealSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    encoder.encode(body),
  );
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function openSession(
  cookie: string | undefined,
  secret: string,
): Promise<SessionPayload | null> {
  if (!cookie) return null;
  const [body, signature] = cookie.split(".");
  if (!body || !signature) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(secret),
    base64UrlDecode(signature),
    encoder.encode(body),
  );
  if (!valid) return null;
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as SessionPayload;
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function sessionCookie(value: string, maxAge: number): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ].join("; ");
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

/**
 * A missing secret used to surface as a WebCrypto complaint about a zero-bit
 * HMAC key, three frames deep. Say what is actually wrong instead.
 */
function missingConfig(env: Env): string | null {
  const missing = (["POSTAL_API_URL", "POSTAL_API_KEY", "SESSION_SECRET"] as const)
    .filter((name) => !env[name])
    .join(", ");
  if (!missing) {
    if (
      env.DEMO_ACCESS_CODE &&
      env.DEMO_ACCESS_CODE.length < MIN_DEMO_CODE_LENGTH
    ) {
      console.warn(
        `DEMO_ACCESS_CODE is shorter than ${MIN_DEMO_CODE_LENGTH} characters — reviewer access stays disabled.`,
      );
    }
    return null;
  }
  return `Missing Worker configuration: ${missing}. Locally, copy .dev.vars.example to .dev.vars and fill it in; in production, set them with \`wrangler secret put\`.`;
}

/**
 * Headers for an upstream Postal call.
 *
 * The client's IP and user agent are forwarded deliberately. Without them
 * every Lab request reaches Postal from a Cloudflare address, which blinds
 * Postal's own per-IP throttling and its request logging — abuse routed
 * through this proxy would be neither attributable nor rate-limited on their
 * side. Postal's own frontend forwards the same set.
 */
function postalHeaders(
  env: Env,
  request: Request,
  extra: Record<string, string> = {},
): Headers {
  const headers = new Headers({ "x-api-key": env.POSTAL_API_KEY, ...extra });

  // Derive the forwarded IP from cf-connecting-ip alone and overwrite rather
  // than relay: passing the caller's own x-forwarded-for through would hand
  // them control of the value Postal throttles and logs on.
  const ip = clientIp(request);
  if (ip !== "unknown") {
    headers.set("cf-connecting-ip", ip);
    headers.set("x-forwarded-for", ip);
  }
  const userAgent = request.headers.get("user-agent");
  if (userAgent) headers.set("user-agent", userAgent);

  return headers;
}

/**
 * Turn an access token into a sealed session.
 *
 * The profile is read back from Postal rather than trusted from the sign-in
 * response, which both validates the token and picks up the musician /
 * organisation IDs that scope later calls.
 */
async function establishSession(
  accessToken: string,
  env: Env,
  request: Request,
): Promise<Response> {
  const profileResponse = await fetch(`${env.POSTAL_API_URL}/users/me`, {
    headers: postalHeaders(env, request, { authorization: `Bearer ${accessToken}` }),
  });
  const profile = (await profileResponse.json().catch(() => null)) as any;
  const me = profile?.data ?? profile;

  if (!profileResponse.ok || !me?.id) {
    return json({ message: "Postal rejected that session token." }, { status: 401 });
  }

  const payload: SessionPayload = {
    accessToken,
    musicianId: me.currentMusicianId,
    organisationId: me.currentOrganisationId,
    user: {
      id: me.id,
      email: me.email,
      name: me.name ?? [me.first_name, me.last_name].filter(Boolean).join(" "),
    },
  };

  return json(
    { user: payload.user },
    {
      headers: {
        "set-cookie": sessionCookie(
          await sealSession(payload, env.SESSION_SECRET),
          SESSION_MAX_AGE,
        ),
      },
    },
  );
}

/** Step one of the email-code flow: ask Postal to send the code. */
async function handleRequestCode(request: Request, env: Env): Promise<Response> {
  // Postal creates an account for an unrecognised address and emails it a
  // code, so an unthrottled relay here would be an account-creation and
  // mail-spam tool wearing Postal's sender reputation.
  if (!(await withinRateLimit(env.AUTH_RATE_LIMIT, request, "request-code", 10))) {
    return tooManyRequests();
  }

  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  if (!body?.email) {
    return json({ message: "An email address is required." }, { status: 400 });
  }

  const upstream = await fetch(`${env.POSTAL_API_URL}/auth/login-code/request`, {
    method: "POST",
    headers: postalHeaders(env, request, { "content-type": "application/json" }),
    body: JSON.stringify({ email: body.email }),
  });
  const result = (await upstream.json().catch(() => null)) as any;

  if (!upstream.ok) {
    return json(
      {
        message:
          upstream.status === 429
            ? "Too many code requests. Wait a minute and try again."
            : (result?.message ?? "Postal could not send a sign-in code."),
      },
      { status: upstream.status },
    );
  }
  return json({ sent: true });
}

/** Step two: trade the emailed code for a session. */
async function handleLogin(request: Request, env: Env): Promise<Response> {
  if (!(await withinRateLimit(env.AUTH_RATE_LIMIT, request, "login", 10))) {
    return tooManyRequests();
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    code?: string;
  } | null;
  if (!body?.email || !body.code) {
    return json({ message: "An email and sign-in code are required." }, { status: 400 });
  }

  const upstream = await fetch(`${env.POSTAL_API_URL}/auth/login-code/verify`, {
    method: "POST",
    headers: postalHeaders(env, request, { "content-type": "application/json" }),
    body: JSON.stringify({ email: body.email, code: body.code }),
  });
  const result = (await upstream.json().catch(() => null)) as any;

  if (!upstream.ok) {
    return json(
      { message: result?.message ?? "That sign-in code was not accepted." },
      { status: upstream.status },
    );
  }

  const accessToken = result?.data?.access_token ?? result?.access_token;
  if (!accessToken) {
    return json({ message: "Postal returned no access token." }, { status: 502 });
  }
  return establishSession(accessToken, env, request);
}

/**
 * Reviewer door. Hackathon judges cannot read the demo account's inbox, so a
 * shared access code (handed out on the submission form) unlocks a session
 * built from a token issued ahead of time. The token itself never leaves the
 * Worker, and revoking that Postal session closes the door instantly.
 */
async function handleDemoLogin(request: Request, env: Env): Promise<Response> {
  if (!demoConfigured(env)) {
    return json({ message: "Demo access is not configured." }, { status: 404 });
  }

  if (!(await withinRateLimit(env.DEMO_RATE_LIMIT, request, "demo", 5))) {
    return tooManyRequests();
  }

  const body = (await request.json().catch(() => null)) as {
    accessCode?: string;
  } | null;
  if (!timingSafeEqual(body?.accessCode ?? "", env.DEMO_ACCESS_CODE!)) {
    return json({ message: "That access code is not valid." }, { status: 401 });
  }
  return establishSession(env.DEMO_ACCESS_TOKEN!, env, request);
}

/** Compare without leaking length or position through timing. */
function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return mismatch === 0;
}

async function handleProxy(
  request: Request,
  env: Env,
  session: SessionPayload,
  endpoint: string,
): Promise<Response> {
  const url = new URL(request.url);
  const path = endpoint.split("?")[0];
  const allowed = ALLOWED_ENDPOINTS.some(
    (entry) => entry.method === request.method && entry.pattern.test(path),
  );
  if (!allowed) {
    return json(
      { message: `The Lab proxy does not expose ${request.method} ${path}.` },
      { status: 403 },
    );
  }

  const headers = postalHeaders(env, request, {
    authorization: `Bearer ${session.accessToken}`,
  });
  if (session.musicianId) headers.set("x-musician-id", session.musicianId);
  if (session.organisationId) headers.set("x-organisation-id", session.organisationId);
  // Pass the body's own content-type through untouched: multipart uploads
  // carry a boundary in it that must survive the hop.
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const upstream = await fetch(`${env.POSTAL_API_URL}${path}${url.search}`, {
    method: request.method,
    headers,
    body: request.method === "GET" ? undefined : await request.arrayBuffer(),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    const configError = missingConfig(env);
    if (configError) return json({ message: configError }, { status: 500 });

    if (url.pathname === "/api/auth/request-code" && request.method === "POST") {
      return handleRequestCode(request, env);
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      return handleLogin(request, env);
    }

    if (url.pathname === "/api/auth/demo" && request.method === "POST") {
      return handleDemoLogin(request, env);
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      return json({ ok: true }, { headers: { "set-cookie": sessionCookie("", 0) } });
    }

    const session = await openSession(
      readCookie(request, SESSION_COOKIE),
      env.SESSION_SECRET,
    );

    if (url.pathname === "/api/auth/session") {
      // `demoLogin` tells the page whether to offer the reviewer door.
      const demoLogin = demoConfigured(env);
      if (!session) return json({ user: null, demoLogin }, { status: 401 });
      return json({ user: session.user, demoLogin });
    }

    if (url.pathname.startsWith("/api/postal/")) {
      if (!session) {
        return json(
          { statusCode: 401, messageCode: "unauthenticated", message: "Sign in first." },
          { status: 401 },
        );
      }
      return handleProxy(request, env, session, url.pathname.slice("/api/postal".length));
    }

    return json({ message: "Not found" }, { status: 404 });
  },
};
