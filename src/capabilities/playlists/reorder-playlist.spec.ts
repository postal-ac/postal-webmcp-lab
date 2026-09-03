import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiPatch } from "@/postal/client";

import { reorderPlaylist } from "./reorder-playlist";

vi.mock("@/postal/client", () => ({ apiPatch: vi.fn() }));
vi.mock("../auth", () => ({
  requireAuthenticatedPostalSession: vi.fn(async () => ({ id: "current-user" })),
}));

describe("reorderPlaylist", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the full de-duplicated order to Postal's reorder endpoint", async () => {
    vi.mocked(apiPatch).mockResolvedValue({ data: { ok: true } });

    await expect(
      reorderPlaylist({ playlistId: "playlist-1", trackIds: ["t2", "t1", "t2", "t3"] }),
    ).resolves.toEqual({ playlistId: "playlist-1", trackIds: ["t2", "t1", "t3"] });
    expect(apiPatch).toHaveBeenCalledWith(
      "/pack/reorder",
      JSON.stringify({ packId: "playlist-1", trackIds: ["t2", "t1", "t3"] }),
    );
  });

  it("rejects an empty order before touching the network", async () => {
    await expect(
      reorderPlaylist({ playlistId: "playlist-1", trackIds: [] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it("fails cleanly when the playlist is missing", async () => {
    vi.mocked(apiPatch).mockResolvedValue({
      statusCode: 404,
      messageCode: "pack_not_found",
      message: "Pack not found",
    });

    await expect(
      reorderPlaylist({ playlistId: "missing", trackIds: ["t1"] }),
    ).rejects.toMatchObject({ code: "PLAYLIST_NOT_FOUND" });
  });
});
