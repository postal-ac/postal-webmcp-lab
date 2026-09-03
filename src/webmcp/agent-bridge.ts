import type { RegisteredWebMcpTool, WebMcpModelContext } from "./types";

/**
 * Two doors for agents that cannot reach `document.modelContext` directly.
 *
 * Extension- and automation-driven agents run their scripts in an isolated
 * JavaScript world: same DOM, separate `window` and `document` wrappers, and
 * no view of new web-platform APIs like WebMCP. Those agents see only what is
 * in the DOM and what crosses `postMessage`. So the page publishes both:
 *
 * 1. A **manifest** — a `<script type="application/json">` element listing
 *    every registered tool with its description and input schema, plus the
 *    exact calling instructions — and a visually-hidden note pointing at it,
 *    so an agent reading rendered text or the accessibility tree finds it.
 * 2. A **bridge** — a same-origin `window.postMessage` protocol that runs the
 *    named tool in the main world through the very same
 *    `document.modelContext.executeTool()` path a native agent would use, so
 *    the activity box, history and approval gate all behave identically.
 *
 * Security boundary: only messages from this window and this origin are
 * honoured. A cross-origin frame or opener could otherwise use the bridge to
 * bypass WebMCP's own `exposedTo` policy.
 */

export const AGENT_MANIFEST_ID = "postal-webmcp-manifest";
export const AGENT_NOTE_ID = "postal-webmcp-agent-note";
export const BRIDGE_REQUEST_TYPE = "postal:webmcp";
export const BRIDGE_RESPONSE_TYPE = "postal:webmcp:result";

export interface BridgeRequest {
  type: typeof BRIDGE_REQUEST_TYPE;
  /** Echoed back on the response so callers can match replies. */
  id: string;
  action: "list" | "call";
  /** For "call": the tool name from the manifest. */
  tool?: string;
  /** For "call": the tool's arguments — an object or a JSON string. */
  input?: unknown;
}

export interface BridgeResponse {
  type: typeof BRIDGE_RESPONSE_TYPE;
  id: string;
  ok: boolean;
  /** "list": the manifest tools. "call": the tool's parsed JSON result. */
  result?: unknown;
  error?: { code: string; message: string };
}

export interface AgentManifest {
  protocol: "webmcp";
  page: string;
  /** How to reach the tools, most direct first. */
  access: {
    native: string;
    bridge: {
      request: string;
      response: string;
      example: BridgeRequest;
    };
    /** For agents that can only open URLs and read page text. */
    url: {
      how: string;
      example: string;
    };
  };
  /** The tool list follows the screen; how to stay current. */
  dynamic: string;
  /** Multi-step jobs this page is built for, as ordered tool sequences. */
  recipes: { goal: string; steps: string[] }[];
  tools: {
    name: string;
    description: string;
    inputSchema: unknown;
  }[];
}

const RECIPES: AgentManifest["recipes"] = [
  {
    goal: "Pitch a brief (from an email, a document or another tab) with tracks from this catalogue",
    steps: [
      "match_brief with the brief's full text as `brief`, a short `source`, and `playlistName` (e.g. 'Night Circuit Pitch') — the matches become a playlist in one call and the page opens it with a player; pass bpmRange / instrumental when the brief states them",
      "control_playback {action:'play', playlistId} to audition from the top — the page auto-advances; the user can say 'not this one' and you call remove_now_playing",
      "refine while listening: remove_tracks_from_playlist / add_tracks_to_playlist (search_tracks for more), reorder_playlist",
      "create_share_link with the playlistId — the user approves in the page — then hand the link back where the brief came from",
    ],
  },
  {
    goal: "Playlist of the user's newest tracks with a private link",
    steps: [
      "search_tracks with no query and the wanted limit",
      "create_playlist with those ids in `trackIds`",
      "create_share_link with the playlistId",
    ],
  },
];

function pageOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

function manifestTools(tools: RegisteredWebMcpTool[]): AgentManifest["tools"] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema:
      typeof tool.inputSchema === "string"
        ? safeParse(tool.inputSchema)
        : (tool.inputSchema ?? {}),
  }));
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function buildAgentManifest(tools: RegisteredWebMcpTool[]): AgentManifest {
  return {
    protocol: "webmcp",
    page: "Postal WebMCP Lab — tools over the signed-in user's music catalogue",
    access: {
      native:
        "In the page's main JavaScript world: const tools = await document.modelContext.getTools(); const raw = await document.modelContext.executeTool(tools.find(t => t.name === NAME), JSON.stringify(input)); JSON.parse(raw). Input and result are JSON strings.",
      bridge: {
        request: `From any world sharing this window (extension content scripts, automation): window.postMessage({ type: "${BRIDGE_REQUEST_TYPE}", id, action: "call", tool: NAME, input: { ... } }, location.origin). Use action "list" to fetch this tool list.`,
        response: `A "message" event on window whose data is { type: "${BRIDGE_RESPONSE_TYPE}", id, ok, result | error }. result is the tool's parsed JSON, including success:false payloads for tool-level failures.`,
        example: {
          type: BRIDGE_REQUEST_TYPE,
          id: "req-1",
          action: "call",
          tool: "search_tracks",
          input: { limit: 5 },
        },
      },
      url: {
        how: `If you can only navigate and read text: open ${pageOrigin()}/#tool=NAME&input=URLENCODED_JSON (optional &id=…). The page runs the tool and renders the result as text in the section "Tool call from URL" (full JSON in <script id="postal-url-door-result">). Free read-only tools run on arrival; writes and match_brief wait for the user to click Run on the page — tell the user to press it. After a call the hash becomes #done=…; open a new #tool= URL for the next call. If you open the URL from a shell or another app it lands in a NEW tab; the page hands the call to the Lab tab that is already open and shows the result THERE — keep reading the tab you started from. On macOS use: open -a "Google Chrome" "URL" so it reaches the signed-in Chrome profile.`,
        example: `${pageOrigin()}/#tool=search_tracks&input=%7B%22limit%22%3A5%7D`,
      },
    },
    dynamic:
      "This tool list changes with what the user has on screen: get_selected_tracks' description names the current selection; remove_from_open_playlist and reorder_open_playlist exist only while a playlist dialog is open; create_playlist_from_shortlist exists only while a brief shortlist is showing and uses just the picks the user kept. get_now_playing exists only while audio is playing and names the track; remove_now_playing exists only while the playing track is in the current playlist — use them for 'this one', 'skip this', 'not that'. Re-read the tools (getTools, or bridge action \"list\") after your own calls and after the user acts — the browser fires toolchange.",
    recipes: RECIPES,
    tools: manifestTools(tools),
  };
}

function upsertManifest(manifest: AgentManifest): HTMLScriptElement {
  let element = document.getElementById(AGENT_MANIFEST_ID) as HTMLScriptElement | null;
  if (!element) {
    element = document.createElement("script");
    element.id = AGENT_MANIFEST_ID;
    element.type = "application/json";
    element.setAttribute("data-webmcp-manifest", "");
    document.head.appendChild(element);
  }
  element.textContent = JSON.stringify(manifest);
  document.documentElement.setAttribute("data-webmcp-tools", String(manifest.tools.length));
  return element;
}

function upsertNote(toolNames: string[]): HTMLElement {
  let note = document.getElementById(AGENT_NOTE_ID);
  if (!note) {
    note = document.createElement("section");
    note.id = AGENT_NOTE_ID;
    note.setAttribute("aria-label", "Instructions for AI agents");
    // Visually hidden, but present in rendered text and the accessibility
    // tree — the two things a DOM-reading agent actually looks at.
    note.style.cssText =
      "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;";
    document.body.appendChild(note);
  }
  note.textContent =
    `For AI agents: this page exposes ${toolNames.length} WebMCP tools (${toolNames.join(", ")}). ` +
    `They have no buttons — do not look for UI. Call them via document.modelContext in the page's main JavaScript world, ` +
    `or from an isolated world via window.postMessage with type "${BRIDGE_REQUEST_TYPE}", ` +
    `or, if you can only open URLs and read text, by navigating to ${pageOrigin()}/#tool=NAME&input=URLENCODED_JSON and reading the "Tool call from URL" section that appears. ` +
    `Full descriptions, input schemas and the exact calling protocol are in the JSON element #${AGENT_MANIFEST_ID} in <head>.`;
  return note;
}

function decode(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Publish the manifest and start answering bridge messages. Returns a
 * cleanup that removes both. Re-reads the tool list on `ontoolchange` when
 * the browser exposes it, so the manifest tracks registration.
 */
export function installAgentBridge(
  modelContext: WebMcpModelContext | undefined = document.modelContext,
): () => void {
  if (typeof window === "undefined" || !modelContext?.getTools || !modelContext.executeTool) {
    return () => {};
  }
  const context = modelContext;

  let tools: RegisteredWebMcpTool[] = [];
  const refresh = async () => {
    tools = await context.getTools();
    upsertManifest(buildAgentManifest(tools));
    upsertNote(tools.map((tool) => tool.name));
  };
  void refresh();

  const withToolChange = context as WebMcpModelContext & {
    ontoolchange?: ((event: Event) => void) | null;
  };
  const previousToolChange = "ontoolchange" in withToolChange ? withToolChange.ontoolchange : undefined;
  if ("ontoolchange" in withToolChange) {
    withToolChange.ontoolchange = (event) => {
      previousToolChange?.(event);
      void refresh();
    };
  }

  const reply = (response: BridgeResponse) => {
    window.postMessage(response, window.location.origin);
  };

  const onMessage = async (event: MessageEvent) => {
    const data = event.data as Partial<BridgeRequest> | null;
    if (!data || data.type !== BRIDGE_REQUEST_TYPE || typeof data.id !== "string") return;
    // Same window, same origin only. Browsers always populate both; the
    // guards tolerate test environments that leave them empty.
    if (event.source && event.source !== window) return;
    if (event.origin && event.origin !== window.location.origin) return;

    if (data.action === "list") {
      if (!tools.length) await refresh();
      reply({ type: BRIDGE_RESPONSE_TYPE, id: data.id, ok: true, result: manifestTools(tools) });
      return;
    }
    if (data.action !== "call" || typeof data.tool !== "string") {
      reply({
        type: BRIDGE_RESPONSE_TYPE,
        id: data.id,
        ok: false,
        error: { code: "INVALID_INPUT", message: 'action must be "list" or "call" with a tool name.' },
      });
      return;
    }
    if (!tools.length) await refresh();
    const tool = tools.find((candidate) => candidate.name === data.tool);
    if (!tool) {
      reply({
        type: BRIDGE_RESPONSE_TYPE,
        id: data.id,
        ok: false,
        error: {
          code: "TOOL_NOT_FOUND",
          message: `No tool named ${data.tool}. Available: ${tools.map((t) => t.name).join(", ")}.`,
        },
      });
      return;
    }
    try {
      const input = typeof data.input === "string" ? data.input : JSON.stringify(data.input ?? {});
      const raw = await context.executeTool(tool, input);
      reply({ type: BRIDGE_RESPONSE_TYPE, id: data.id, ok: true, result: decode(raw) });
    } catch (cause) {
      reply({
        type: BRIDGE_RESPONSE_TYPE,
        id: data.id,
        ok: false,
        error: {
          code: "EXECUTION_FAILED",
          message: cause instanceof Error ? cause.message : String(cause),
        },
      });
    }
  };

  const listener = (event: MessageEvent) => void onMessage(event);
  window.addEventListener("message", listener);

  return () => {
    window.removeEventListener("message", listener);
    if ("ontoolchange" in withToolChange) withToolChange.ontoolchange = previousToolChange ?? null;
    document.getElementById(AGENT_MANIFEST_ID)?.remove();
    document.getElementById(AGENT_NOTE_ID)?.remove();
    document.documentElement.removeAttribute("data-webmcp-tools");
  };
}
