import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet, apiPost } from "@/postal/client";

import { addTracksToPlaylist } from "./add-tracks-to-playlist";

vi.mock("@/postal/client", () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock("../auth", () => ({
  requireAuthenticatedPostalSession: vi.fn(async () => ({ id: "current-user" })),
}));

describe("addTracksToPlaylist", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the existing bulk-add endpoint and returns the resulting track count", async () => {
    vi.mocked(apiPost).mockResolvedValue({ data: { count: 2 } });
    vi.mocked(apiGet).mockResolvedValue({
      data: { id: "playlist-1", tracks: [{ id: "track-1" }, { id: "track-2" }] },
    });

    await expect(
      addTracksToPlaylist({
        playlistId: "playlist-1",
        trackIds: ["track-1", "track-1", "track-2"],
      }),
    ).resolves.toEqual({
      playlistId: "playlist-1",
      addedTrackIds: ["track-1", "track-2"],
      trackCount: 2,
    });
    expect(apiPost).toHaveBeenCalledWith(
      "/pack/add-tracks",
      JSON.stringify({ packId: "playlist-1", trackIds: ["track-1", "track-2"] }),
    );
  });

  it("fails cleanly when any track ID is invalid or inaccessible", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      statusCode: 400,
      messageCode: "invalid_tracks",
      message: "Some tracks do not belong to the user.",
    });

    await expect(
      addTracksToPlaylist({ playlistId: "playlist-1", trackIds: ["invalid"] }),
    ).rejects.toMatchObject({ code: "TRACK_NOT_FOUND" });
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("fails cleanly when the playlist is missing", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      statusCode: 404,
      messageCode: "pack_not_found",
      message: "Pack not found",
    });

    await expect(
      addTracksToPlaylist({ playlistId: "missing", trackIds: ["track-1"] }),
    ).rejects.toMatchObject({ code: "PLAYLIST_NOT_FOUND" });
  });

  it("refuses a playlist the signed-in user cannot write to", async () => {
    vi.mocked(apiPost).mockResolvedValue({ data: { count: 1 } });
    vi.mocked(apiGet).mockResolvedValue({
      statusCode: 206,
      data: { requiresJoin: true },
    });

    await expect(
      addTracksToPlaylist({ playlistId: "someone-elses", trackIds: ["track-1"] }),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
});
