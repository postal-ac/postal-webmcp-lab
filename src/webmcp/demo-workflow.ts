import { PostalCapabilityError } from "@/capabilities/errors";
import type { AgentTrackSummary } from "@/capabilities/types";

import type {
  PostalWebMcpToolName,
  RegisteredWebMcpTool,
  WebMcpModelContext,
} from "./types";

export const PRIMARY_WEBMCP_PROMPT = `Find five melodic electronic tracks I uploaded recently,
create a playlist called Ibiza Shortlist,
add the tracks and create a private share link.`;

export interface DemoWorkflowResult {
  kind: "search" | "playlist" | "share" | "primary" | "agent";
  tracks?: AgentTrackSummary[];
  playlistId?: string;
  playlistName?: string;
  shareUrl?: string;
  /** Free-form summary, present when an on-device model ran the prompt. */
  message?: string;
}

/**
 * The prompts the deterministic runner owns. Everything else goes to the
 * built-in-model planner when the browser has one — this stays narrow so the
 * demo chips behave identically on camera while free-form prompts get the
 * real treatment.
 */
export function isScriptedLabPrompt(prompt: string): boolean {
  const normalized = prompt.toLocaleLowerCase();
  return (
    normalized.includes("ibiza shortlist") ||
    normalized.includes("melodic electronic") ||
    normalized.includes("pitch playlist") ||
    normalized.includes("uploaded recently") ||
    (normalized.includes("create a playlist called") &&
      normalized.includes("share link") &&
      !normalized.includes(" add "))
  );
}

function decodeToolResult(raw: unknown): Record<string, any> {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new PostalCapabilityError("API_ERROR", "WebMCP returned invalid JSON.");
    }
  }
  const result = value as Record<string, any>;
  let payload = result?.structuredContent;
  if (!payload && Array.isArray(result?.content)) {
    const text = result.content.find((item: any) => item?.type === "text")?.text;
    if (typeof text === "string") {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
  }
  payload ??= result;
  if (payload?.success === false) {
    throw new PostalCapabilityError(
      payload.error?.code ?? "API_ERROR",
      payload.error?.message ?? "The WebMCP tool failed.",
    );
  }
  return payload;
}

async function invokeTool(
  modelContext: WebMcpModelContext,
  tools: RegisteredWebMcpTool[],
  name: PostalWebMcpToolName,
  input: Record<string, unknown>,
) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new PostalCapabilityError(
      "WEBMCP_UNAVAILABLE",
      `${name} is not registered in this page.`,
    );
  }
  // The second argument is a JSON string, per the WebMCP imperative API.
  return decodeToolResult(await modelContext.executeTool(tool, JSON.stringify(input)));
}

export async function executeWebMcpLabPrompt(
  prompt: string,
  modelContext: WebMcpModelContext | undefined = document.modelContext,
): Promise<DemoWorkflowResult> {
  if (!modelContext?.getTools || !modelContext.executeTool) {
    throw new PostalCapabilityError(
      "WEBMCP_UNAVAILABLE",
      "This browser does not expose the WebMCP discovery and execution APIs.",
    );
  }
  const tools = await modelContext.getTools();
  const normalized = prompt.toLocaleLowerCase();
  const primary =
    normalized.includes("ibiza shortlist") ||
    normalized.includes("melodic electronic") ||
    normalized.includes("pitch playlist");

  if (primary) {
    const search = await invokeTool(modelContext, tools, "search_tracks", {
      query: "melodic electronic",
      limit: 5,
    });
    const tracks = (search.tracks ?? []) as AgentTrackSummary[];
    if (tracks.length < 5) {
      throw new PostalCapabilityError(
        "TRACK_NOT_FOUND",
        `Only ${tracks.length} matching tracks were found; five are required before creating the playlist.`,
      );
    }
    const playlist = await invokeTool(modelContext, tools, "create_playlist", {
      name: "Ibiza Shortlist",
      description: "Created through the Postal WebMCP Lab.",
    });
    await invokeTool(modelContext, tools, "add_tracks_to_playlist", {
      playlistId: playlist.playlistId,
      trackIds: tracks.map((track) => track.id),
    });
    const share = await invokeTool(modelContext, tools, "create_share_link", {
      playlistId: playlist.playlistId,
    });
    return {
      kind: "primary",
      tracks,
      playlistId: playlist.playlistId,
      playlistName: playlist.name,
      shareUrl: share.shareUrl,
    };
  }

  if (normalized.includes("recent track") || normalized.startsWith("find")) {
    const search = await invokeTool(modelContext, tools, "search_tracks", {
      limit: 5,
    });
    return { kind: "search", tracks: search.tracks ?? [] };
  }

  const playlistName =
    prompt.match(/playlist (?:called|named) ["“]?([^"”.,\n]+)/i)?.[1]?.trim() ??
    "Hackathon Test";
  if (!normalized.includes("create") || !normalized.includes("playlist")) {
    throw new PostalCapabilityError(
      "INVALID_INPUT",
      "This built-in runner only handles its documented demo scenarios. For custom selections, call the registered WebMCP tools directly: search_tracks resolves titles to track ids, and add_tracks_to_playlist accepts any ids.",
    );
  }
  const playlist = await invokeTool(modelContext, tools, "create_playlist", {
    name: playlistName,
  });
  if (normalized.includes("share link")) {
    const share = await invokeTool(modelContext, tools, "create_share_link", {
      playlistId: playlist.playlistId,
    });
    return {
      kind: "share",
      playlistId: playlist.playlistId,
      playlistName: playlist.name,
      shareUrl: share.shareUrl,
    };
  }
  return {
    kind: "playlist",
    playlistId: playlist.playlistId,
    playlistName: playlist.name,
  };
}
