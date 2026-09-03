import { describe, expect, it, vi } from "vitest";

import { executeWebMcpLabPrompt, PRIMARY_WEBMCP_PROMPT } from "./demo-workflow";
import type { WebMcpModelContext } from "./types";

function success(payload: Record<string, unknown>) {
  return JSON.stringify({ structuredContent: { success: true, ...payload } });
}

describe("executeWebMcpLabPrompt", () => {
  it("composes the primary four-tool workflow through WebMCP execution", async () => {
    const toolNames = [
      "search_tracks",
      "create_playlist",
      "add_tracks_to_playlist",
      "create_share_link",
    ];
    const tracks = Array.from({ length: 5 }, (_, index) => ({
      id: `track-${index + 1}`,
      title: `Track ${index + 1}`,
    }));
    const responses = [
      success({ tracks }),
      success({ playlistId: "playlist-1", name: "Ibiza Shortlist" }),
      success({ playlistId: "playlist-1", addedTrackIds: tracks.map((t) => t.id), trackCount: 5 }),
      success({ playlistId: "playlist-1", shareUrl: "https://postal.music/private" }),
    ];
    const executeTool = vi.fn(
      async (_tool: { name: string }, _input: string) => responses.shift(),
    );
    const modelContext = {
      getTools: vi.fn(async () => toolNames.map((name) => ({ name }))),
      executeTool,
    } as unknown as WebMcpModelContext;

    const result = await executeWebMcpLabPrompt(PRIMARY_WEBMCP_PROMPT, modelContext);

    expect(executeTool.mock.calls.map(([tool]) => tool.name)).toEqual(toolNames);
    expect(JSON.parse(executeTool.mock.calls[2][1])).toEqual({
      playlistId: "playlist-1",
      trackIds: tracks.map((track) => track.id),
    });
    expect(result).toMatchObject({
      kind: "primary",
      playlistId: "playlist-1",
      shareUrl: "https://postal.music/private",
    });
  });

  it("does not create a partial playlist when fewer than five tracks match", async () => {
    const executeTool = vi.fn(
      async (_tool: { name: string }, _input: string) => success({ tracks: [] }),
    );
    const modelContext = {
      getTools: vi.fn(async () => [{ name: "search_tracks" }]),
      executeTool,
    } as unknown as WebMcpModelContext;

    await expect(
      executeWebMcpLabPrompt(PRIMARY_WEBMCP_PROMPT, modelContext),
    ).rejects.toMatchObject({ code: "TRACK_NOT_FOUND" });
    expect(executeTool).toHaveBeenCalledOnce();
  });
});
