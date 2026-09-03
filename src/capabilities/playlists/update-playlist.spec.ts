import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiPatch } from "@/postal/client";

import { updatePlaylist } from "./update-playlist";

vi.mock("@/postal/client", () => ({ apiPatch: vi.fn() }));
vi.mock("../auth", () => ({
  requireAuthenticatedPostalSession: vi.fn(async () => ({ id: "current-user" })),
}));

describe("updatePlaylist", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renames through the multipart update endpoint, sending only the changed field", async () => {
    vi.mocked(apiPatch).mockResolvedValue({
      data: { id: "playlist-1", name: "Ibiza Shortlist", description: "old" },
    });

    await expect(
      updatePlaylist({ playlistId: "playlist-1", name: "  Ibiza Shortlist " }),
    ).resolves.toEqual({ playlistId: "playlist-1", name: "Ibiza Shortlist" });

    const [path, body] = vi.mocked(apiPatch).mock.calls[0]!;
    expect(path).toBe("/pack/update");
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect(form.get("packId")).toBe("playlist-1");
    expect(form.get("name")).toBe("Ibiza Shortlist");
    expect(form.has("description")).toBe(false);
  });

  it("rejects a call that changes nothing", async () => {
    await expect(updatePlaylist({ playlistId: "playlist-1" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it("fails cleanly when the playlist is missing", async () => {
    vi.mocked(apiPatch).mockResolvedValue({
      statusCode: 404,
      messageCode: "pack_not_found",
      message: "Pack not found",
    });

    await expect(
      updatePlaylist({ playlistId: "missing", name: "Anything" }),
    ).rejects.toMatchObject({ code: "PLAYLIST_NOT_FOUND" });
  });
});
