import { describe, expect, it, vi } from "vitest";

import type { WebMcpToolDefinition } from "./types";
import {
  buildUrlToolLink,
  describeOutcomeForText,
  gateFor,
  parseUrlToolRequest,
  runUrlToolRequest,
  unknownToolOutcome,
} from "./url-door";

const readOnly = (name: string): WebMcpToolDefinition => ({
  name,
  description: "",
  inputSchema: {},
  annotations: { readOnlyHint: true },
  execute: vi.fn(async (input) => JSON.stringify({ success: true, echoed: input })),
});

describe("parseUrlToolRequest", () => {
  it("reads tool, JSON input and id from the hash, and ignores unrelated hashes", () => {
    expect(parseUrlToolRequest("#tool=search_tracks&input=%7B%22limit%22%3A5%7D&id=r1")).toEqual({
      tool: "search_tracks",
      input: { limit: 5 },
      id: "r1",
    });
    expect(parseUrlToolRequest("#tool=list_playlists")).toEqual({ tool: "list_playlists", input: {} });
    expect(parseUrlToolRequest("#done=search_tracks")).toBeNull();
    expect(parseUrlToolRequest("")).toBeNull();
  });

  it("rejects malformed names and non-object input with readable errors", () => {
    expect(parseUrlToolRequest("#tool=")).toMatchObject({ error: expect.stringContaining("no tool") });
    expect(parseUrlToolRequest("#tool=DROP%20TABLE")).toMatchObject({ error: expect.stringContaining("not a valid") });
    expect(parseUrlToolRequest("#tool=search_tracks&input=%5B1%5D")).toMatchObject({
      error: expect.stringContaining("JSON object"),
    });
    expect(parseUrlToolRequest("#tool=search_tracks&input=nope")).toMatchObject({
      error: expect.stringContaining("not valid JSON"),
    });
  });
});

describe("gateFor", () => {
  it("auto-runs free read-only tools, confirms writes and metered reads, flags unknown tools", () => {
    expect(gateFor(readOnly("search_tracks"))).toBe("auto");
    expect(gateFor(readOnly("match_brief"))).toBe("confirm");
    expect(gateFor({ ...readOnly("create_playlist"), annotations: { readOnlyHint: false } })).toBe("confirm");
    expect(gateFor(undefined)).toBe("unknown");
  });
});

describe("runUrlToolRequest", () => {
  it("runs the definition and unwraps success and tool-level failure", async () => {
    const definition = readOnly("search_tracks");
    const ok = await runUrlToolRequest({ tool: "search_tracks", input: { limit: 2 } }, definition);
    expect(ok).toMatchObject({ status: "success", result: { echoed: { limit: 2 } } });
    expect(definition.execute).toHaveBeenCalledWith({ limit: 2 });

    const failing: WebMcpToolDefinition = {
      ...definition,
      execute: async () =>
        JSON.stringify({ success: false, error: { code: "UNAUTHENTICATED", message: "Sign in first." } }),
    };
    const bad = await runUrlToolRequest({ tool: "search_tracks", input: {} }, failing);
    expect(bad).toMatchObject({ status: "error", error: { code: "UNAUTHENTICATED" } });
  });

  it("describes an unknown tool with the list that exists right now", () => {
    const outcome = unknownToolOutcome({ tool: "nope", input: {} }, ["search_tracks", "get_track"]);
    expect(outcome.error?.message).toContain("Available right now: search_tracks, get_track");
  });
});

describe("text rendering", () => {
  it("builds links and describes outcomes as plain text an agent can read", () => {
    const link = buildUrlToolLink("https://lab.test", "/", "search_tracks", { limit: 5 });
    expect(link).toBe("https://lab.test/#tool=search_tracks&input=%7B%22limit%22%3A5%7D");
    const text = describeOutcomeForText(
      { request: { tool: "search_tracks", input: { limit: 1 }, id: "r9" }, status: "success", result: { tracks: [] }, durationMs: 3 },
      "https://lab.test",
      "/",
    );
    expect(text).toContain("Tool call from URL (id r9): search_tracks {\"limit\":1}");
    expect(text).toContain("Result: {\"tracks\":[]}");
    expect(text).toContain("To call another tool, open https://lab.test/#tool=TOOL_NAME");
  });
});
