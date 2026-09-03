import { describe, expect, it } from "vitest";

import type { PostalWebMcpActivity } from "@/webmcp/types";

import { deriveAgentPlaylist } from "./agent-playlist";

let counter = 0;

function activity(
  tool: PostalWebMcpActivity["tool"],
  status: PostalWebMcpActivity["status"],
  result?: Record<string, unknown>,
): PostalWebMcpActivity {
  counter += 1;
  return {
    executionId: `exec-${counter}`,
    tool,
    status,
    startedAt: "2026-09-01T00:00:00.000Z",
    result,
  };
}

describe("deriveAgentPlaylist", () => {
  it("returns null when no playlist tool has succeeded", () => {
    expect(
      deriveAgentPlaylist([
        activity("search_tracks", "success", { tracks: [] }),
        activity("create_playlist", "running"),
        activity("create_playlist", "error"),
      ]),
    ).toBeNull();
  });

  it("drops tracks a later remove_tracks_from_playlist call took out", () => {
    const playlist = deriveAgentPlaylist([
      activity("create_playlist", "success", {
        playlistId: "p1",
        name: "Shortlist",
        addedTrackIds: ["t1", "t2", "t3"],
      }),
      activity("remove_tracks_from_playlist", "success", {
        playlistId: "p1",
        removedTrackIds: ["t2", "missing"],
        trackCount: 2,
      }),
      activity("add_tracks_to_playlist", "success", {
        playlistId: "p1",
        addedTrackIds: ["t2"],
        trackCount: 3,
      }),
    ]);

    expect(playlist?.trackIds).toEqual(["t1", "t3", "t2"]);
  });

  it("applies a reorder_playlist result, keeping unmentioned tracks at the end", () => {
    const playlist = deriveAgentPlaylist([
      activity("create_playlist", "success", {
        playlistId: "p1",
        name: "Set",
        addedTrackIds: ["t1", "t2", "t3", "t4"],
      }),
      activity("reorder_playlist", "success", {
        playlistId: "p1",
        trackIds: ["t3", "t1", "t2"],
      }),
    ]);

    expect(playlist?.trackIds).toEqual(["t3", "t1", "t2", "t4"]);
  });

  it("forgets a playlist once delete_playlist succeeds", () => {
    expect(
      deriveAgentPlaylist([
        activity("create_playlist", "success", {
          playlistId: "p1",
          name: "Gone",
          addedTrackIds: ["t1"],
        }),
        activity("create_share_link", "success", {
          playlistId: "p1",
          shareUrl: "https://postal.music/playlist/p1?token=x",
        }),
        activity("delete_playlist", "success", { playlistId: "p1", deleted: true }),
      ]),
    ).toBeNull();
  });

  it("takes the name from a later update_playlist call", () => {
    const playlist = deriveAgentPlaylist([
      activity("create_playlist", "success", { playlistId: "p1", name: "Draft" }),
      activity("update_playlist", "success", { playlistId: "p1", name: "Ibiza Shortlist" }),
    ]);

    expect(playlist?.name).toBe("Ibiza Shortlist");
  });

  it("assembles name, tracks and share link across the full sequence", () => {
    const playlist = deriveAgentPlaylist([
      activity("create_playlist", "success", { playlistId: "p1", name: "Night Circuit" }),
      activity("add_tracks_to_playlist", "success", {
        playlistId: "p1",
        addedTrackIds: ["t1", "t2"],
        trackCount: 2,
      }),
      activity("add_tracks_to_playlist", "success", {
        playlistId: "p1",
        addedTrackIds: ["t2", "t3"],
        trackCount: 3,
      }),
      activity("create_share_link", "success", {
        playlistId: "p1",
        shareUrl: "https://postal.music/playlist/p1?token=x",
      }),
    ]);

    expect(playlist).toEqual({
      playlistId: "p1",
      name: "Night Circuit",
      trackIds: ["t1", "t2", "t3"],
      shareUrl: "https://postal.music/playlist/p1?token=x",
    });
  });

  it("reads tracks added by create_playlist itself", () => {
    const playlist = deriveAgentPlaylist([
      activity("create_playlist", "success", {
        playlistId: "p1",
        name: "Latest Five",
        addedTrackIds: ["t1", "t2", "t3", "t4", "t5"],
        trackCount: 5,
      }),
    ]);

    expect(playlist).toEqual({
      playlistId: "p1",
      name: "Latest Five",
      trackIds: ["t1", "t2", "t3", "t4", "t5"],
    });
  });

  it("tracks additions to an existing playlist that was never created here", () => {
    const playlist = deriveAgentPlaylist([
      activity("add_tracks_to_playlist", "success", {
        playlistId: "existing",
        addedTrackIds: ["t9"],
        trackCount: 12,
      }),
    ]);

    expect(playlist).toMatchObject({ playlistId: "existing", trackIds: ["t9"] });
    expect(playlist?.name).toBeUndefined();
  });

  it("returns the playlist touched most recently when several are in play", () => {
    const playlist = deriveAgentPlaylist([
      activity("create_playlist", "success", { playlistId: "p1", name: "First" }),
      activity("create_playlist", "success", { playlistId: "p2", name: "Second" }),
      activity("add_tracks_to_playlist", "success", {
        playlistId: "p1",
        addedTrackIds: ["t1"],
        trackCount: 1,
      }),
    ]);

    expect(playlist).toMatchObject({ playlistId: "p1", name: "First" });
  });

  it("treats a match_brief that created a playlist like create_playlist", () => {
    const playlist = deriveAgentPlaylist([
      activity("match_brief", "success", {
        matches: [],
        brief: {},
        playlistId: "pl-m",
        name: "Night Circuit Pitch",
        addedTrackIds: ["a", "b"],
      }),
    ]);
    expect(playlist).toMatchObject({ playlistId: "pl-m", name: "Night Circuit Pitch", trackIds: ["a", "b"] });
    // A plain match (no playlist) leaves the page's playlist alone.
    expect(deriveAgentPlaylist([activity("match_brief", "success", { matches: [], brief: {} })])).toBeNull();
  });
});
