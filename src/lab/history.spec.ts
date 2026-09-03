import { beforeEach, describe, expect, it } from "vitest";

import { appendHistory, clearHistory, readHistory } from "./history";

describe("history", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips entries through localStorage", () => {
    appendHistory({
      kind: "tool",
      at: "2026-09-01T12:00:00.000Z",
      tool: "search_tracks",
      status: "success",
      durationMs: 120,
      summary: "5 tracks found",
      via: "agent",
    });
    appendHistory({
      kind: "run",
      at: "2026-09-01T12:01:00.000Z",
      prompt: "make a disco playlist",
      ok: true,
      playlistName: "Disco Test",
    });

    const entries = readHistory();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: "tool", tool: "search_tracks" });
    expect(entries[1]).toMatchObject({ kind: "run", ok: true });
  });

  it("caps the stored trail", () => {
    for (let index = 0; index < 320; index += 1) {
      appendHistory({
        kind: "tool",
        at: new Date(0).toISOString(),
        tool: `tool-${index}`,
        status: "success",
        via: "page",
      });
    }
    const entries = readHistory();
    expect(entries).toHaveLength(300);
    expect(entries[0]).toMatchObject({ tool: "tool-20" });
  });

  it("survives corrupt storage and clears cleanly", () => {
    localStorage.setItem("postal-webmcp-history-v1", "{not json");
    expect(readHistory()).toEqual([]);
    appendHistory({
      kind: "tool",
      at: new Date(0).toISOString(),
      tool: "get_track",
      status: "error",
      errorCode: "TRACK_NOT_FOUND",
      via: "page",
    });
    expect(readHistory()).toHaveLength(1);
    clearHistory();
    expect(readHistory()).toEqual([]);
  });
});
