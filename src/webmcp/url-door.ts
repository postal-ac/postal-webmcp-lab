import { PostalCapabilityError, toPostalCapabilityError } from "@/capabilities/errors";

import type { WebMcpToolDefinition } from "./types";

/**
 * The third door: a tool call carried in the page URL.
 *
 * Some agents can do exactly two things with a browser — open a URL and read
 * the page's text. They cannot run JavaScript, click, or see
 * `document.modelContext`, so neither WebMCP nor the postMessage bridge
 * reaches them. This module lets such an agent act anyway: it opens
 *
 *   https://lab.example/#tool=search_tracks&input=%7B%22limit%22%3A5%7D
 *
 * and the page runs that tool through the very same instrumented definition
 * a WebMCP agent would call, then renders the result as readable text (and
 * as JSON in a `<script>` element). The agent reads the page, decides, and
 * opens the next URL.
 *
 * A URL is also something anyone can put in front of a signed-in user, so
 * the door is gated. Free, read-only tools run on arrival. Anything that
 * writes, or costs Postal credits, waits for the person to press Run on the
 * page — the same authorization-by-presence the share-link gate gives WebMCP
 * callers, applied to links. Once a call has run, the hash is replaced so a
 * reload does not run it twice.
 */
export const URL_DOOR_RESULT_ID = "postal-url-door-result";

export interface UrlToolRequest {
  tool: string;
  input: Record<string, unknown>;
  /** Echoed into the result so an agent can match reply to request. */
  id?: string;
}

export type UrlDoorGate = "auto" | "confirm" | "unknown";

export interface UrlDoorOutcome {
  request: UrlToolRequest;
  status: "success" | "error";
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
  durationMs: number;
}

/** Tools that cost Postal credits; read-only but not free, so they confirm. */
const METERED_TOOLS = new Set(["match_brief"]);

export function parseUrlToolRequest(hash: string): UrlToolRequest | { error: string } | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.includes("tool=")) return null;
  const params = new URLSearchParams(raw);
  const tool = params.get("tool")?.trim();
  if (!tool) return { error: "The URL names no tool (`tool=` is empty)." };
  if (!/^[a-z][a-z0-9_]{1,60}$/.test(tool)) {
    return { error: `“${tool}” is not a valid tool name.` };
  }
  let input: Record<string, unknown> = {};
  const rawInput = params.get("input");
  if (rawInput && rawInput.trim()) {
    try {
      const parsed = JSON.parse(rawInput);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { error: "`input` must be a JSON object." };
      }
      input = parsed as Record<string, unknown>;
    } catch {
      return { error: "`input` is not valid JSON. URL-encode a JSON object, e.g. input=%7B%22limit%22%3A5%7D." };
    }
  }
  const id = params.get("id")?.trim() || undefined;
  return { tool, input, ...(id ? { id } : {}) };
}

export function gateFor(definition: WebMcpToolDefinition | undefined): UrlDoorGate {
  if (!definition) return "unknown";
  const readOnly = definition.annotations?.readOnlyHint === true;
  if (readOnly && !METERED_TOOLS.has(definition.name)) return "auto";
  return "confirm";
}

export function buildUrlToolLink(origin: string, pathname: string, tool: string, input?: Record<string, unknown>): string {
  const params = new URLSearchParams({ tool });
  if (input && Object.keys(input).length) params.set("input", JSON.stringify(input));
  return `${origin}${pathname}#${params.toString()}`;
}

/**
 * Run a request against a definition, as an agent call (approval gates for
 * share links and deletes still apply). Resolves to a structured outcome
 * rather than throwing, so the panel can always render something readable.
 */
export async function runUrlToolRequest(
  request: UrlToolRequest,
  definition: WebMcpToolDefinition,
): Promise<UrlDoorOutcome> {
  const started = performance.now();
  try {
    const raw = await definition.execute(request.input);
    const payload = JSON.parse(String(raw)) as
      | ({ success: true } & Record<string, unknown>)
      | { success: false; error: { code: string; message: string } };
    const durationMs = Math.round(performance.now() - started);
    if (!payload.success) {
      return { request, status: "error", error: payload.error, durationMs };
    }
    const { success: _success, ...result } = payload;
    return { request, status: "success", result, durationMs };
  } catch (cause) {
    const error = toPostalCapabilityError(cause);
    return {
      request,
      status: "error",
      error: { code: error.code, message: error.message },
      durationMs: Math.round(performance.now() - started),
    };
  }
}

export function unknownToolOutcome(request: UrlToolRequest, known: string[]): UrlDoorOutcome {
  const error = new PostalCapabilityError(
    "INVALID_INPUT",
    `Unknown tool “${request.tool}”. Available right now: ${known.join(", ")}.`,
  );
  return { request, status: "error", error: { code: error.code, message: error.message }, durationMs: 0 };
}

/** Replace the hash so a reload does not re-run the call. */
export function markUrlRequestHandled(request: UrlToolRequest): void {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  const marker = `#done=${encodeURIComponent(request.id ?? request.tool)}`;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${marker}`);
}

/** Plain-text rendering for agents that read the page as text. */
export function describeOutcomeForText(outcome: UrlDoorOutcome, origin: string, pathname: string): string {
  const head = `Tool call from URL${outcome.request.id ? ` (id ${outcome.request.id})` : ""}: ${outcome.request.tool} ${JSON.stringify(outcome.request.input)}`;
  const body =
    outcome.status === "success"
      ? `Result: ${JSON.stringify(outcome.result)}`
      : `Error ${outcome.error?.code}: ${outcome.error?.message}`;
  const next = `To call another tool, open ${buildUrlToolLink(origin, pathname, "TOOL_NAME", { example: true })} with your tool name and URL-encoded JSON input.`;
  return `${head}\n${body}\n${next}`;
}
