import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  executePromptWithBuiltInModel,
  isPromptApiAvailable,
} from "./prompt-planner";
import type { WebMcpModelContext } from "./types";

function stubLanguageModel(responses: string[]) {
  const prompt = vi.fn(async () => responses.shift() ?? '{"action":"finish"}');
  const destroy = vi.fn();
  (globalThis as any).LanguageModel = {
    availability: vi.fn(async () => "available"),
    create: vi.fn(async () => ({ prompt, destroy })),
  };
  return { prompt, destroy };
}

describe("prompt planner", () => {
  beforeEach(() => {
    delete (globalThis as any).LanguageModel;
  });
  afterEach(() => {
    delete (globalThis as any).LanguageModel;
  });

  it("reports unavailability without a built-in model", async () => {
    await expect(isPromptApiAvailable()).resolves.toBe(false);
  });

  it("plans, executes and finishes against the registered tools", async () => {
    const { destroy } = stubLanguageModel([
      JSON.stringify({
        action: "call",
        tool: "search_tracks",
        input: { query: "disco", limit: 2 },
      }),
      JSON.stringify({ action: "finish", message: "Found two disco tracks." }),
    ]);
    const executeTool = vi.fn(async () =>
      JSON.stringify({
        structuredContent: {
          success: true,
          tracks: [
            { id: "t1", title: "Solo 1" },
            { id: "t2", title: "BALLET" },
          ],
        },
      }),
    );
    const modelContext = {
      getTools: vi.fn(async () => [
        { name: "search_tracks", description: "search", inputSchema: {} },
      ]),
      executeTool,
    } as unknown as WebMcpModelContext;

    const result = await executePromptWithBuiltInModel("find disco tracks", modelContext);

    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "search_tracks" }),
      JSON.stringify({ query: "disco", limit: 2 }),
    );
    expect(result).toMatchObject({
      kind: "agent",
      message: "Found two disco tracks.",
      tracks: [expect.objectContaining({ id: "t1" }), expect.objectContaining({ id: "t2" })],
    });
    expect(destroy).toHaveBeenCalled();
  });

  it("narrows highlighted tracks to the ids actually added", async () => {
    stubLanguageModel([
      JSON.stringify({ action: "call", tool: "search_tracks", input: {} }),
      JSON.stringify({
        action: "call",
        tool: "add_tracks_to_playlist",
        input: { playlistId: "p1", trackIds: ["t2"] },
      }),
      JSON.stringify({ action: "finish", message: "Added." }),
    ]);
    const responses = [
      { success: true, tracks: [{ id: "t1", title: "A" }, { id: "t2", title: "B" }] },
      { success: true, playlistId: "p1", addedTrackIds: ["t2"], trackCount: 1 },
    ];
    const modelContext = {
      getTools: vi.fn(async () => [
        { name: "search_tracks", inputSchema: {} },
        { name: "add_tracks_to_playlist", inputSchema: {} },
      ]),
      executeTool: vi.fn(async () =>
        JSON.stringify({ structuredContent: responses.shift() }),
      ),
    } as unknown as WebMcpModelContext;

    const result = await executePromptWithBuiltInModel("add B to p1", modelContext);
    expect(result.tracks).toEqual([expect.objectContaining({ id: "t2" })]);
  });
});
