import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetPageContext, setPagePlaylist, setPageShortlist } from "./page-context-store";
import { installPlayQueue, neighboursOf, playNext, playPrevious, setCatalogueQueue } from "./play-queue";

const player = vi.hoisted(() => {
  let playingId: string | null = null;
  const ended = new Set<(id: string) => void>();
  return {
    set(id: string | null) {
      playingId = id;
    },
    state: () => ({ playingId, title: null }),
    details: () => null,
    playTrack: vi.fn(async (track: { id: string }) => {
      playingId = track.id;
    }),
    onPlaybackEnded: (listener: (id: string) => void) => {
      ended.add(listener);
      return () => ended.delete(listener);
    },
    end(id: string) {
      for (const listener of ended) listener(id);
    },
  };
});
vi.mock("./player-controller", () => ({
  playbackState: () => player.state(),
  playingTrackDetails: () => player.details(),
  playTrack: player.playTrack,
  onPlaybackEnded: player.onPlaybackEnded,
}));

const catalogue = [
  { id: "c1", title: "One", playbackUrl: "u1" },
  { id: "c2", title: "Two", playbackUrl: "u2" },
  { id: "c3", title: "Three" },
  { id: "c4", title: "Four", playbackUrl: "u4" },
];

describe("play queue", () => {
  beforeEach(() => {
    resetPageContext();
    setCatalogueQueue(catalogue);
    player.set(null);
    player.playTrack.mockClear();
  });

  it("falls back to catalogue order and skips unplayable tracks", () => {
    const around = neighboursOf("c2");
    expect(around.source).toBe("catalogue");
    expect(around.previous?.id).toBe("c1");
    expect(around.next?.id).toBe("c4");
    expect(around.position).toEqual({ index: 2, total: 4 });
    expect(neighboursOf("c1").previous).toBeNull();
    expect(neighboursOf("zz").source).toBeNull();
  });

  it("prefers the playlist, then the shortlist, over the catalogue", () => {
    setPageShortlist({
      executionId: "e",
      kept: [
        { id: "c2", title: "Two", playbackUrl: "u2" },
        { id: "c4", title: "Four", playbackUrl: "u4" },
      ],
      total: 2,
    });
    expect(neighboursOf("c2")).toMatchObject({ source: "shortlist", next: { id: "c4" }, previous: null });

    setPagePlaylist({
      playlistId: "p",
      tracks: [
        { id: "c4", title: "Four", playbackUrl: "u4" },
        { id: "c2", title: "Two", playbackUrl: "u2" },
      ],
      open: false,
    });
    expect(neighboursOf("c2")).toMatchObject({ source: "playlist", previous: { id: "c4" }, next: null });
  });

  it("playNext / playPrevious start the neighbour of the playing track", async () => {
    player.set("c1");
    await expect(playNext()).resolves.toMatchObject({ id: "c2" });
    await expect(playNext()).resolves.toMatchObject({ id: "c4" });
    await expect(playNext()).resolves.toBeNull();
    await expect(playPrevious()).resolves.toMatchObject({ id: "c2" });
    expect(player.playTrack).toHaveBeenCalledTimes(3);
  });

  it("auto-advances when a track ends", () => {
    const cleanup = installPlayQueue();
    player.end("c1");
    expect(player.playTrack).toHaveBeenCalledWith(expect.objectContaining({ id: "c2" }));
    cleanup();
  });
});
