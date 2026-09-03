import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet } from "@/postal/client";

import { searchTracks } from "./search-tracks";

vi.mock("@/postal/client", () => ({ apiGet: vi.fn() }));
vi.mock("../auth", () => ({
  requireAuthenticatedPostalSession: vi.fn(async () => ({ id: "current-user" })),
}));

const electronic = {
  id: "track-electronic",
  name: "Sunrise",
  createdAt: "2026-08-20T10:00:00.000Z",
  audio_profile: {
    title: "Sunrise",
    artist: "Postal Artist",
    bpm: 122,
    genres: [{ genre: { name: "Electronic" } }],
    moods: [{ mood: { name: "Melodic" } }],
  },
};

describe("searchTracks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses Postal's existing metadata search and never sends a user ID", async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { items: [electronic] } });

    const result = await searchTracks({ query: "melodic electronic", limit: 5 });

    expect(result.tracks).toEqual([
      expect.objectContaining({
        id: "track-electronic",
        title: "Sunrise",
        bpm: 122,
        tags: expect.arrayContaining(["Electronic", "Melodic"]),
      }),
    ]);
    expect(apiGet).toHaveBeenCalledTimes(2);
    for (const [, params] of vi.mocked(apiGet).mock.calls) {
      expect(params).not.toHaveProperty("userId");
      expect(params).not.toHaveProperty("user");
      expect(params).toMatchObject({ sort: "newest" });
    }
  });

  it("applies createdAfter after authenticated Postal results are returned", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      data: {
        items: [
          electronic,
          { ...electronic, id: "old", createdAt: "2025-01-01T00:00:00.000Z" },
        ],
      },
    });

    const result = await searchTracks({
      query: "electronic",
      createdAfter: "2026-01-01T00:00:00.000Z",
    });

    expect(result.tracks.map((track) => track.id)).toEqual(["track-electronic"]);
  });

  it("treats 'my latest 5 tracks' as newest-first, not as words to match", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      data: {
        items: [
          { ...electronic, id: "newer", createdAt: "2026-08-30T10:00:00.000Z" },
          electronic,
        ],
      },
    });

    const result = await searchTracks({ query: "my latest 5 tracks", limit: 5 });

    // Every word is a quantity/recency word, so no name filter is sent and
    // nothing is scored out — the newest uploads come back in order.
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiGet).mock.calls[0][1]).not.toHaveProperty("name");
    expect(result.tracks.map((track) => track.id)).toEqual(["newer", "track-electronic"]);
  });

  it("returns an actionable validation error", async () => {
    await expect(searchTracks({ limit: 0 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(apiGet).not.toHaveBeenCalled();
  });
});
