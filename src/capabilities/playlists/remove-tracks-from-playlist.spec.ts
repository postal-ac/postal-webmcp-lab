import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet, apiPost } from "@/postal/client";

import { removeTracksFromPlaylist } from "./remove-tracks-from-playlist";

vi.mock("@/postal/client", () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock("../auth", () => ({
  requireAuthenticatedPostalSession: vi.fn(async () => ({ id: "current-user" })),
}));

describe("removeTracksFromPlaylist", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes each track through the single-track endpoint and reports Postal's count", async () => {
    vi.mocked(apiPost).mockResolvedValue({ data: { ok: true } });
    vi.mocked(apiGet).mockResolvedValue({
      data: { id: "playlist-1", tracks: [{ id: "track-3" }] },
    });

    await expect(
      removeTracksFromPlaylist({
        playlistId: "playlist-1",
        trackIds: ["track-1", "track-1", "track-2"],
      }),
    ).resolves.toEqual({
      playlistId: "playlist-1",
      removedTrackIds: ["track-1", "track-2"],
      trackCount: 1,
    });
    expect(apiPost).toHaveBeenCalledTimes(2);
    expect(apiPost).toHaveBeenNthCalledWith(
      1,
      "/pack/remove-track",
      JSON.stringify({ packId: "playlist-1", trackId: "track-1" }),
    );
    expect(apiPost).toHaveBeenNthCalledWith(
      2,
      "/pack/remove-track",
      JSON.stringify({ packId: "playlist-1", trackId: "track-2" }),
    );
  });

  it("rejects an empty track list before touching the network", async () => {
    await expect(
      removeTracksFromPlaylist({ playlistId: "playlist-1", trackIds: [] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("fails cleanly when the playlist is missing", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      statusCode: 404,
      messageCode: "pack_not_found",
      message: "Pack not found",
    });

    await expect(
      removeTracksFromPlaylist({ playlistId: "missing", trackIds: ["track-1"] }),
    ).rejects.toMatchObject({ code: "PLAYLIST_NOT_FOUND" });
    expect(apiGet).not.toHaveBeenCalled();
  });
});
