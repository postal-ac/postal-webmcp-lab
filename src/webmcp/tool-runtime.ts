import {
  PostalCapabilityError,
  toPostalCapabilityError,
} from "@/capabilities/errors";

import {
  POSTAL_WEBMCP_ACTIVITY_EVENT,
  type PostalWebMcpActivity,
  type PostalWebMcpToolName,
  type WebMcpToolDefinition,
} from "./types";

/**
 * The execution wrapper every Lab tool shares — static or contextual. One
 * code path turns a capability into a WebMCP `execute`: input preview for the
 * audit trail, timing, a typed error envelope instead of a thrown exception,
 * and the `postal:webmcp-activity` event the page narrates from.
 */
export type ToolSuccess = Record<string, any>;

export interface CallContext {
  /** Who is calling — an outside agent, or the page's own controls. */
  via: NonNullable<PostalWebMcpActivity["via"]>;
}

export type Capability = (input: any, context: CallContext) => Promise<ToolSuccess>;

export function dispatchActivity(activity: PostalWebMcpActivity) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PostalWebMcpActivity>(POSTAL_WEBMCP_ACTIVITY_EVENT, {
      detail: activity,
    }),
  );
}

function errorPayload(error: PostalCapabilityError) {
  return {
    success: false as const,
    error: { code: error.code, message: error.message },
  };
}

function successPayload(result: ToolSuccess) {
  return { success: true as const, ...result };
}

/**
 * WebMCP tool results are JSON strings: the browser passes whatever `execute`
 * resolves to straight to the agent. Failures come back as a readable
 * `{ success: false, error: { code, message } }` rather than a thrown
 * exception, so an agent can reason about *why* something failed.
 */
export function webMcpResult(payload: Record<string, unknown>) {
  return JSON.stringify(payload);
}

function previewInput(input: unknown): string | undefined {
  try {
    const text = JSON.stringify(input);
    if (!text || text === "{}" || text === "null") return undefined;
    return text.length > 400 ? `${text.slice(0, 400)}…` : text;
  } catch {
    return undefined;
  }
}

/**
 * Set for the synchronous start of a call made by the page's own controls
 * (see `runAsPage`), so the activity stream can tell a human click from an
 * agent's call. Read once at the top of `instrumentedExecute` — concurrent
 * agent calls cannot observe it.
 */
let pendingVia: CallContext["via"] = "agent";

/** Start `execute` flagged as a page-originated call. */
export function runAsPage(execute: () => unknown): unknown {
  pendingVia = "page";
  try {
    return execute();
  } finally {
    pendingVia = "agent";
  }
}

export function instrumentedExecute(
  tool: PostalWebMcpToolName,
  capability: Capability,
  summarize: (result: ToolSuccess) => string,
) {
  return async (input: unknown) => {
    const executionId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const inputPreview = previewInput(input);
    const via = pendingVia;
    dispatchActivity({ executionId, tool, status: "running", startedAt, inputPreview, via });

    try {
      const result = await capability(input, { via });
      const durationMs = Math.round(performance.now() - started);
      const summary = summarize(result);
      dispatchActivity({
        executionId,
        tool,
        status: "success",
        startedAt,
        durationMs,
        summary,
        inputPreview,
        result,
        via,
      });
      return webMcpResult(successPayload(result));
    } catch (cause) {
      const error = toPostalCapabilityError(cause);
      const durationMs = Math.round(performance.now() - started);
      dispatchActivity({
        executionId,
        tool,
        status: "error",
        startedAt,
        durationMs,
        summary: error.message,
        errorCode: error.code,
        inputPreview,
        via,
      });
      return webMcpResult(errorPayload(error));
    }
  };
}

export const objectSchema = (properties: Record<string, unknown>, required?: string[]) => ({
  type: "object",
  properties,
  additionalProperties: false,
  ...(required?.length ? { required } : {}),
});

/**
 * Run a tool definition the way the page's own controls do and unwrap its
 * JSON-string result, rethrowing tool-level failures as typed errors.
 */
export async function executeDefinitionAsPage<T extends Record<string, unknown>>(
  definition: WebMcpToolDefinition,
  input: unknown,
): Promise<T> {
  const pending = runAsPage(() => definition.execute(input));
  const payload = JSON.parse(String(await pending)) as
    | ({ success: true } & T)
    | { success: false; error: { code: string; message: string } };
  if (!payload.success) {
    throw new PostalCapabilityError(
      payload.error.code as PostalCapabilityError["code"],
      payload.error.message,
    );
  }
  const { success: _success, ...result } = payload;
  return result as unknown as T;
}
