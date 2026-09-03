import { describe, expect, it } from "vitest";

import type { PostalWebMcpActivity } from "@/webmcp/types";

import { deriveBriefMatch, suggestedPitchName } from "./brief-matches";

let counter = 0;

function activity(
  tool: PostalWebMcpActivity["tool"],
  status: PostalWebMcpActivity["status"],
  result?: Record<string, unknown>,
  via?: PostalWebMcpActivity["via"],
): PostalWebMcpActivity {
  counter += 1;
  return {
    executionId: `exec-${counter}`,
    tool,
    status,
    startedAt: "2026-09-02T00:00:00.000Z",
    result,
    via,
  };
}

const matchResult = {
  matches: [{ id: "t1", title: "Sunrise", rank: 1, score: 0.9, reason: "Fits" }],
  brief: {
    summary: "Warm electronic",
    artist: null,
    parsed: true,
    source: "Gmail",
    excerpt: "…",
    characters: 120,
    applied: { fromBriefText: false },
  },
  candidatePool: 40,
  historyId: "h1",
};

describe("deriveBriefMatch", () => {
  it("returns null until a match_brief call has succeeded", () => {
    expect(
      deriveBriefMatch([
        activity("search_tracks", "success", { tracks: [] }),
        activity("match_brief", "running"),
        activity("match_brief", "error"),
      ]),
    ).toBeNull();
  });

  it("carries the playlist id when the match created a playlist in the same call", () => {
    const derived = deriveBriefMatch([
      activity("match_brief", "success", { ...matchResult, playlistId: "pl-9", name: "Pitch", addedTrackIds: ["t1"] }),
    ]);
    expect(derived?.playlistId).toBe("pl-9");
  });

  it("returns the latest successful match with its execution id and caller", () => {
    const first = activity("match_brief", "success", matchResult);
    const second = activity(
      "match_brief",
      "success",
      { ...matchResult, matches: [], historyId: null },
      "page",
    );
    const derived = deriveBriefMatch([first, second, activity("create_playlist", "success", {})]);

    expect(derived).toMatchObject({
      executionId: second.executionId,
      via: "page",
      matches: [],
      historyId: null,
      candidatePool: 40,
    });
  });
});

describe("suggestedPitchName", () => {
  it("prefers the source, then the summary, then a generic name", () => {
    expect(suggestedPitchName({ brief: { ...matchResult.brief, source: "netflix-brief.pdf" } })).toBe(
      "Pitch · netflix-brief",
    );
    expect(suggestedPitchName({ brief: { ...matchResult.brief, source: undefined } })).toBe(
      "Pitch · Warm electronic",
    );
    expect(
      suggestedPitchName({ brief: { ...matchResult.brief, source: undefined, summary: null } }),
    ).toBe("Pitch shortlist");
  });
});
