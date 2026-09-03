import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiDelete } from "@/postal/client";

import { deletePlaylist } from "./delete-playlist";

vi.mock("@/postal/client", () => ({ apiDelete: vi.fn() }));
vi.mock("../auth", () => ({
  requireAuthenticatedPostalSession: vi.fn(async () => ({ id: "current-user" })),
}));

describe("deletePlaylist", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes through the body-addressed endpoint and confirms", async () => {
    vi.mocked(apiDelete).mockResolvedValue({ data: { id: "playlist-1" } });

    await expect(deletePlaylist({ playlistId: "playlist-1" })).resolves.toEqual({
      playlistId: "playlist-1",
      deleted: true,
    });
    expect(apiDelete).toHaveBeenCalledWith(
      "/pack/delete",
      JSON.stringify({ id: "playlist-1" }),
    );
  });

  it("rejects a missing id before touching the network", async () => {
    await expect(deletePlaylist({ playlistId: " " })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(apiDelete).not.toHaveBeenCalled();
  });

  it("fails cleanly when the playlist is missing or not owned", async () => {
    vi.mocked(apiDelete).mockResolvedValue({
      statusCode: 404,
      messageCode: "pack_not_found",
      message: "Pack not found",
    });

    await expect(deletePlaylist({ playlistId: "missing" })).rejects.toMatchObject({
      code: "PLAYLIST_NOT_FOUND",
    });
  });
});
