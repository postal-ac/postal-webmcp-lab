/**
 * Client-side view of the session. The access token itself never reaches this
 * file — it lives in the Worker's httpOnly cookie. All the browser gets to know
 * is *whether* someone is signed in and who they are.
 */
export interface PostalUser {
  id?: string;
  email?: string;
  name?: string;
}

let cachedUser: PostalUser | null | undefined;
let demoLoginAvailable = false;

export function setCachedUser(user: PostalUser | null) {
  cachedUser = user;
}

export function getCachedUser(): PostalUser | null | undefined {
  return cachedUser;
}

/** Whether the Worker is configured with a reviewer access code. */
export function isDemoLoginAvailable(): boolean {
  return demoLoginAvailable;
}

export async function resolveClientSession(): Promise<PostalUser | null> {
  if (cachedUser !== undefined) return cachedUser;

  try {
    const response = await fetch("/api/auth/session");
    const body = (await response.json()) as {
      user: PostalUser | null;
      demoLogin?: boolean;
    };
    demoLoginAvailable = Boolean(body.demoLogin);
    cachedUser = response.ok ? body.user : null;
  } catch {
    cachedUser = null;
  }
  return cachedUser;
}

async function post<T>(path: string, body: Record<string, string>): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "Postal could not sign you in.");
  return payload;
}

/** Step one of the email-code flow — Postal emails a six-digit code. */
export async function requestLoginCode(email: string): Promise<void> {
  await post("/api/auth/request-code", { email });
}

/** Step two — trade the emailed code for a session. */
export async function signIn(email: string, code: string): Promise<PostalUser> {
  const { user } = await post<{ user?: PostalUser }>("/api/auth/login", { email, code });
  if (!user) throw new Error("Postal returned no account for that code.");
  cachedUser = user;
  return user;
}

/** Reviewer door — a shared access code, no inbox required. */
export async function signInWithAccessCode(accessCode: string): Promise<PostalUser> {
  const { user } = await post<{ user?: PostalUser }>("/api/auth/demo", { accessCode });
  if (!user) throw new Error("That access code is not valid.");
  cachedUser = user;
  return user;
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
  cachedUser = null;
}
