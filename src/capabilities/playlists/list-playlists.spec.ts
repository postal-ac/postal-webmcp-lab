import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet } from "@/postal/client";

import { listPlaylists } from "./list-playlists";

vi.mock("@/postal/client", () => ({ apiGet: vi.fn() }));
vi.mock("../auth", () => ({
  requireAuthenticatedPostalSession: vi.fn(async () => ({ id: "current-user" })),
}));

const packs = [
  {
    id: "pack-1",
    name: "Dua Lipa Pitch",
    playlistType: "PLAYLIST",
    tracks: [{ id: "a" }, { id: "b" }],
    createdAt: "2026-09-01T10:00:00.000Z",
  },
  { id: "pack-2", name: "Ibiza Shortlist", tracks: [] },
];

describe("listPlaylists", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists the signed-in user's playlists with ids and track counts", async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: packs });

    await expect(listPlaylists()).resolves.toEqual({
      playlists: [
        {
          playlistId: "pack-1",
          name: "Dua Lipa Pitch",
          playlistType: "PLAYLIST",
          trackCount: 2,
          createdAt: "2026-09-01T10:00:00.000Z",
        },
        { playlistId: "pack-2", name: "Ibiza Shortlist", trackCount: 0 },
      ],
    });
    expect(apiGet).toHaveBeenCalledWith("/pack", { limit: "100", sort: "newest" });
  });

  it("filters by name, case-insensitively", async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: packs });

    const result = await listPlaylists({ query: "dua lipa" });
    expect(result.playlists.map((playlist) => playlist.playlistId)).toEqual(["pack-1"]);
  });

  it("maps a backend failure to a typed error", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      statusCode: 500,
      messageCode: "error",
      message: "boom",
    });

    await expect(listPlaylists()).rejects.toMatchObject({ code: "API_ERROR" });
  });
});
