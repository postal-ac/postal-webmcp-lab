import { PostalCapabilityError } from "@/capabilities/errors";
import type { AgentTrackSummary } from "@/capabilities/types";

import type { DemoWorkflowResult } from "./demo-workflow";
import type { RegisteredWebMcpTool, WebMcpModelContext } from "./types";

/**
 * Free-form prompts, without a chat interface: Chrome's built-in Prompt API
 * (an on-device model, stable since Chrome 148) plans tool calls against the
 * page's own registered WebMCP tools. The loop below is the whole "agent" —
 * ask the model for the next step as constrained JSON, execute the tool it
 * names, feed the result back, stop when it says it is done.
 *
 * The model never sees credentials and cannot reach anything the six tools
 * cannot; a hallucinated step fails the same way any bad tool call fails.
 */

interface PromptApiSession {
  prompt(text: string, options?: { responseConstraint?: object }): Promise<string>;
  destroy?: () => void;
}

interface PromptApi {
  availability(): Promise<string>;
  create(options?: {
    initialPrompts?: { role: string; content: string }[];
    monitor?: (monitor: {
      addEventListener(type: "downloadprogress", listener: (event: { loaded: number }) => void): void;
    }) => void;
  }): Promise<PromptApiSession>;
}

/** Progress line for the run panel while the model downloads or thinks. */
export type PlannerProgress = (note: string) => void;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new PostalCapabilityError(
            "API_ERROR",
            `${what} took longer than ${Math.round(ms / 1000)}s. If Chrome is still downloading its on-device model, wait a moment and run again.`,
          ),
        ),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

function promptApi(): PromptApi | null {
  const api = (globalThis as { LanguageModel?: PromptApi }).LanguageModel;
  return api && typeof api.create === "function" ? api : null;
}

export async function isPromptApiAvailable(): Promise<boolean> {
  const api = promptApi();
  if (!api) return false;
  try {
    return (await api.availability()) !== "unavailable";
  } catch {
    return false;
  }
}

const MAX_STEPS = 10;

const STEP_SCHEMA = (toolNames: string[]) => ({
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: { type: "string", enum: ["call", "finish"] },
    tool: { type: "string", enum: toolNames },
    input: { type: "object" },
    message: { type: "string" },
  },
});

function systemPrompt(tools: RegisteredWebMcpTool[]): string {
  const toolList = tools
    .map(
      (tool) =>
        `- ${tool.name}: ${tool.description ?? ""}\n  input schema: ${
          typeof tool.inputSchema === "string"
            ? tool.inputSchema
            : JSON.stringify(tool.inputSchema)
        }`,
    )
    .join("\n");
  return [
    "You operate a music catalogue page by calling its tools. Work step by step.",
    "Respond with JSON only: {\"action\":\"call\",\"tool\":name,\"input\":{...}} to call a tool,",
    "or {\"action\":\"finish\",\"message\":short summary} when the user's request is complete.",
    "Track ids come from search_tracks results; playlist ids from create_playlist or list_playlists.",
    "Never invent ids. If a tool result shows success:false, adapt or finish with what went wrong.",
    "Tools:",
    toolList,
  ].join("\n");
}

function decodePayload(raw: unknown): Record<string, any> {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { raw: String(raw).slice(0, 400) };
    }
  }
  const result = value as Record<string, any>;
  return result?.structuredContent ?? result ?? {};
}

/** Keep tool results small enough for an on-device context window. */
function summarizeForModel(payload: Record<string, any>): string {
  const slim = { ...payload };
  if (Array.isArray(slim.tracks)) {
    slim.tracks = slim.tracks.slice(0, 10).map((track: AgentTrackSummary) => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      bpm: track.bpm,
      tags: track.tags?.slice(0, 5),
    }));
  }
  if (Array.isArray(slim.playlists)) slim.playlists = slim.playlists.slice(0, 15);
  const text = JSON.stringify(slim);
  return text.length > 2400 ? `${text.slice(0, 2400)}…` : text;
}

export async function executePromptWithBuiltInModel(
  userPrompt: string,
  modelContext: WebMcpModelContext | undefined = document.modelContext,
  onProgress: PlannerProgress = () => {},
): Promise<DemoWorkflowResult> {
  const api = promptApi();
  if (!api || !modelContext?.getTools || !modelContext.executeTool) {
    throw new PostalCapabilityError(
      "WEBMCP_UNAVAILABLE",
      "This browser has no built-in model to interpret free-form prompts.",
    );
  }

  const tools = await modelContext.getTools();
  const toolNames = tools.map((tool) => tool.name);

  onProgress("Preparing the on-device model…");
  let session: PromptApiSession;
  try {
    // First use can trigger a multi-minute model download; surface it rather
    // than sitting on a silent "waiting" state, and bound it so the panel can
    // never hang forever.
    session = await withTimeout(
      api.create({
        initialPrompts: [{ role: "system", content: systemPrompt(tools) }],
        monitor: (monitor) =>
          monitor.addEventListener("downloadprogress", (event) =>
            onProgress(
              `Downloading Chrome's on-device model… ${Math.round((event.loaded ?? 0) * 100)}%`,
            ),
          ),
      }),
      180_000,
      "Preparing the on-device model",
    );
  } catch (cause) {
    if (cause instanceof PostalCapabilityError) throw cause;
    // Chrome refuses to start the download without a user gesture; the click
    // that ran this prompt can expire across awaits.
    throw new PostalCapabilityError(
      "WEBMCP_UNAVAILABLE",
      "Chrome could not start its on-device model — it may need a fresh click to begin downloading. Run the prompt again.",
      cause,
    );
  }

  // Rolling outcome, so the run panel can show what the loop achieved.
  let lastTracks: AgentTrackSummary[] | undefined;
  let addedTrackIds: string[] | undefined;
  let playlistId: string | undefined;
  let playlistName: string | undefined;
  let shareUrl: string | undefined;

  try {
    let nextMessage = `User request: ${userPrompt}`;
    for (let step = 0; step < MAX_STEPS; step += 1) {
      onProgress(step === 0 ? "Planning tool calls…" : "Deciding the next step…");
      const response = await withTimeout(
        session.prompt(nextMessage, {
          responseConstraint: STEP_SCHEMA(toolNames),
        }),
        90_000,
        "The on-device model",
      );
      let plan: { action?: string; tool?: string; input?: object; message?: string };
      try {
        plan = JSON.parse(response);
      } catch {
        throw new PostalCapabilityError(
          "API_ERROR",
          "The built-in model returned an unreadable plan.",
        );
      }

      if (plan.action === "finish" || !plan.tool) {
        const tracks = addedTrackIds
          ? lastTracks?.filter((track) => addedTrackIds!.includes(track.id))
          : lastTracks;
        return {
          kind: "agent",
          message: plan.message,
          ...(tracks?.length ? { tracks } : {}),
          ...(playlistId ? { playlistId, playlistName } : {}),
          ...(shareUrl ? { shareUrl } : {}),
        };
      }

      const tool = tools.find((candidate) => candidate.name === plan.tool);
      if (!tool) {
        nextMessage = `There is no tool named ${plan.tool}. Choose one of: ${toolNames.join(", ")}.`;
        continue;
      }

      const payload = decodePayload(
        await modelContext.executeTool(tool, JSON.stringify(plan.input ?? {})),
      );
      if (Array.isArray(payload.tracks)) lastTracks = payload.tracks;
      if (Array.isArray(payload.addedTrackIds)) addedTrackIds = payload.addedTrackIds;
      if (typeof payload.playlistId === "string") playlistId = payload.playlistId;
      if (typeof payload.name === "string" && payload.playlistId) {
        playlistName = payload.name;
      }
      if (typeof payload.shareUrl === "string") shareUrl = payload.shareUrl;

      nextMessage = `Result of ${plan.tool}: ${summarizeForModel(payload)}`;
    }

    throw new PostalCapabilityError(
      "API_ERROR",
      `The built-in model did not finish within ${MAX_STEPS} tool calls.`,
    );
  } finally {
    session.destroy?.();
  }
}
