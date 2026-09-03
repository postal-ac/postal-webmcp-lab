import type { PostalCapabilityErrorCode } from "@/capabilities/errors";

/**
 * The tools an agent can always count on. Thirteen are registered once at
 * mount; `get_selected_tracks` is registered by the contextual layer so its
 * description can say what is selected — but it is never absent.
 */
export const POSTAL_WEBMCP_TOOL_NAMES = [
  "search_tracks",
  "get_track",
  "list_playlists",
  "get_selected_tracks",
  "get_brief",
  "match_brief",
  "control_playback",
  "create_playlist",
  "update_playlist",
  "add_tracks_to_playlist",
  "remove_tracks_from_playlist",
  "reorder_playlist",
  "delete_playlist",
  "create_share_link",
] as const;

/**
 * Tools that exist only while the thing they act on is on screen — the open
 * playlist dialog, the brief shortlist. Registered and aborted live as the
 * page changes, so the agent's tool list mirrors the user's view.
 */
export const POSTAL_WEBMCP_CONTEXT_TOOL_NAMES = [
  "remove_from_open_playlist",
  "reorder_open_playlist",
  "create_playlist_from_shortlist",
  "get_now_playing",
  "remove_now_playing",
] as const;

export type PostalWebMcpToolName =
  | (typeof POSTAL_WEBMCP_TOOL_NAMES)[number]
  | (typeof POSTAL_WEBMCP_CONTEXT_TOOL_NAMES)[number];

export interface PostalWebMcpActivity {
  executionId: string;
  tool: PostalWebMcpToolName;
  status: "running" | "success" | "error";
  startedAt: string;
  /** The call's arguments as compact JSON, truncated — the audit trail. */
  inputPreview?: string;
  durationMs?: number;
  summary?: string;
  errorCode?: PostalCapabilityErrorCode;
  result?: Record<string, unknown>;
  /** Who called: an outside agent (default) or the page's own controls. */
  via?: "agent" | "page";
}

export const POSTAL_WEBMCP_ACTIVITY_EVENT = "postal:webmcp-activity";

export interface WebMcpToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  /**
   * Receives the parsed input object and resolves to a JSON string — the
   * browser hands that string to the agent as the tool's result.
   */
  execute: (
    input: any,
    options?: { signal?: AbortSignal },
  ) => unknown | Promise<unknown>;
}

export interface RegisteredWebMcpTool {
  name: string;
  description?: string;
  inputSchema?: string | Record<string, unknown>;
  origin?: string;
  window?: Window;
}

export interface WebMcpModelContext {
  registerTool(
    tool: WebMcpToolDefinition,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ): Promise<void>;
  getTools(options?: { fromOrigins?: string[] }): Promise<RegisteredWebMcpTool[]>;
  /**
   * `input` is a JSON *string*, not an object — passing an object makes the
   * browser reject the call with "Failed to parse input arguments".
   */
  executeTool(
    tool: RegisteredWebMcpTool,
    input: string,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
}

declare global {
  interface Document {
    modelContext?: WebMcpModelContext;
  }
}
