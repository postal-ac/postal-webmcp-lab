import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetPageContext,
  setPagePlaylist,
  setPageShortlist,
} from "@/lab/page-context-store";
import { clearSelection, toggleSelected } from "@/lab/selection-store";

import {
  buildContextualTools,
  describeSelection,
  installContextualTools,
} from "./contextual-tools";
import type { WebMcpModelContext, WebMcpToolDefinition } from "./types";

vi.mock("@/capabilities/playlists/add-tracks-to-playlist", () => ({
  addTracksToPlaylist: vi.fn(async (input: { playlistId: string; trackIds: string[] }) => ({
    playlistId: input.playlistId,
    addedTrackIds: input.trackIds,
    trackCount: input.trackIds.length,
  })),
}));
vi.mock("@/capabilities/playlists/create-playlist", () => ({
  createPlaylist: vi.fn(async (input: { name: string }) => ({
    playlistId: "pl-new",
    name: input.name,
  })),
}));
vi.mock("@/capabilities/playlists/remove-tracks-from-playlist", () => ({
  removeTracksFromPlaylist: vi.fn(async (input: { playlistId: string; trackIds: string[] }) => ({
    playlistId: input.playlistId,
    removedTrackIds: input.trackIds,
    trackCount: 1,
  })),
}));
vi.mock("@/capabilities/playlists/reorder-playlist", () => ({
  reorderPlaylist: vi.fn(async (input: { playlistId: string; trackIds: string[] }) => input),
}));

// A controllable player: jsdom has no real audio, and the tools only need
// "what is playing" plus play/pause calls to observe.
const player = vi.hoisted(() => {
  let current: { id: string; title: string; positionSec: number; durationSec?: number } | null = null;
  const listeners = new Set<(id: string | null) => void>();
  return {
    set(next: typeof current) {
      current = next;
      for (const listener of listeners) listener(next?.id ?? null);
    },
    nowPlaying: () => current,
    subscribePlayback: (listener: (id: string | null) => void) => {
      listeners.add(listener);
      listener(current?.id ?? null);
      return () => listeners.delete(listener);
    },
    playTrack: vi.fn(async (track: { id: string; title: string }) => {
      current = { id: track.id, title: track.title, positionSec: 0 };
    }),
    pausePlayback: vi.fn(() => {
      current = null;
      return { wasPlaying: true };
    }),
  };
});
vi.mock("@/lab/waveform-cache", () => ({
  waveformFor: vi.fn(async () => ({
    trackId: "t2",
    status: "completed",
    durationSec: 190,
    peaks: [],
    sections: [{ label: "Verse", startSec: 30, endSec: 60 }],
    highlights: [{ label: "Best Hook", atSec: 72 }],
  })),
}));
vi.mock("@/lab/player-controller", () => ({
  nowPlaying: () => player.nowPlaying(),
  subscribePlayback: player.subscribePlayback,
  playTrack: player.playTrack,
  pausePlayback: player.pausePlayback,
}));

const track = (id: string, title: string) =>
  ({ id, title }) as unknown as Parameters<typeof toggleSelected>[0];

function fakeContext() {
  const registrations: { tool: WebMcpToolDefinition; signal: AbortSignal }[] = [];
  const modelContext = {
    registerTool: vi.fn(async (tool: WebMcpToolDefinition, options?: { signal?: AbortSignal }) => {
      registrations.push({ tool, signal: options!.signal! });
    }),
    getTools: vi.fn(async () => []),
    executeTool: vi.fn(),
  } as unknown as WebMcpModelContext;
  const live = () =>
    registrations.filter((entry) => !entry.signal.aborted).map((entry) => entry.tool);
  return { modelContext, registrations, live };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("contextual tools", () => {
  beforeEach(() => {
    clearSelection();
    resetPageContext();
    player.set(null);
    player.playTrack.mockClear();
    player.pausePlayback.mockClear();
  });
  afterEach(() => {
    clearSelection();
    resetPageContext();
  });

  it("always offers get_selected_tracks, with a description that names the selection", () => {
    expect(describeSelection([])).toContain("Nothing is selected right now.");
    expect(
      describeSelection([
        { id: "1", title: "Sunrise.wav" },
        { id: "2", title: "Ember" },
      ]),
    ).toContain("2 tracks are selected: “Sunrise”, “Ember”");

    const tools = buildContextualTools([], { playlist: null, shortlist: null });
    expect(tools.map((tool) => tool.name)).toEqual(["get_selected_tracks"]);
  });

  it("adds open-playlist tools only while the dialog is open, naming the playlist", () => {
    const playlist = {
      playlistId: "pl-1",
      name: "Night Circuit Pitch",
      tracks: [{ id: "t1", title: "Sunrise" }],
      open: true,
    };
    const open = buildContextualTools([], { playlist, shortlist: null });
    expect(open.map((tool) => tool.name)).toEqual([
      "get_selected_tracks",
      "remove_from_open_playlist",
      "reorder_open_playlist",
    ]);
    expect(open[1]!.description).toContain("“Night Circuit Pitch” (1 track: “Sunrise”)");
    expect(JSON.stringify(open.map((tool) => tool.inputSchema))).not.toContain("playlistId");

    const closed = buildContextualTools([], {
      playlist: { ...playlist, open: false },
      shortlist: null,
    });
    expect(closed.map((tool) => tool.name)).toEqual(["get_selected_tracks"]);
  });

  it("re-registers live as the selection and the page change, and aborts what leaves the screen", async () => {
    const { modelContext, registrations, live } = fakeContext();
    const cleanup = installContextualTools(modelContext);
    await flush();
    expect(live().map((tool) => tool.name)).toEqual(["get_selected_tracks"]);
    expect(live()[0]!.description).toContain("Nothing is selected");

    toggleSelected(track("t1", "Sunrise"));
    await flush();
    expect(live()).toHaveLength(1);
    expect(live()[0]!.description).toContain("1 track is selected: “Sunrise”");
    expect(registrations[0]!.signal.aborted).toBe(true);

    setPagePlaylist({ playlistId: "pl-1", name: "Pitch", tracks: [], open: true });
    await flush();
    expect(live().map((tool) => tool.name)).toEqual([
      "get_selected_tracks",
      "remove_from_open_playlist",
      "reorder_open_playlist",
    ]);

    setPagePlaylist({ playlistId: "pl-1", name: "Pitch", tracks: [], open: false });
    await flush();
    expect(live().map((tool) => tool.name)).toEqual(["get_selected_tracks"]);

    cleanup();
    expect(live()).toEqual([]);
  });

  it("create_playlist_from_shortlist uses only the picks the user kept", async () => {
    setPageShortlist({
      executionId: "exec-1",
      source: "Gmail",
      summary: "Warm electronic",
      kept: [
        { id: "a", title: "Sunrise" },
        { id: "c", title: "Drift" },
      ],
      total: 3,
    });
    const tools = buildContextualTools([], {
      playlist: null,
      shortlist: {
        executionId: "exec-1",
        source: "Gmail",
        summary: "Warm electronic",
        kept: [
          { id: "a", title: "Sunrise" },
          { id: "c", title: "Drift" },
        ],
        total: 3,
      },
    });
    const tool = tools.find((candidate) => candidate.name === "create_playlist_from_shortlist")!;
    expect(tool.description).toContain("2 of 3 picks kept after the user's unticks");

    const result = JSON.parse(String(await tool.execute({})));
    expect(result).toMatchObject({
      success: true,
      action: "created",
      playlistId: "pl-new",
      name: "Pitch · Gmail",
      addedTrackIds: ["a", "c"],
      keptTrackIds: ["a", "c"],
    });
  });

  it("remove_from_open_playlist fails typed once the dialog has closed", async () => {
    setPagePlaylist({ playlistId: "pl-1", name: "Pitch", tracks: [], open: true });
    const tool = buildContextualTools([], {
      playlist: { playlistId: "pl-1", name: "Pitch", tracks: [], open: true },
      shortlist: null,
    }).find((candidate) => candidate.name === "remove_from_open_playlist")!;

    setPagePlaylist({ playlistId: "pl-1", name: "Pitch", tracks: [], open: false });
    const result = JSON.parse(String(await tool.execute({ trackIds: ["t1"] })));
    expect(result).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  });

  it("offers get_now_playing only while audio plays, naming the track", () => {
    const silent = buildContextualTools([], { playlist: null, shortlist: null }, null);
    expect(silent.map((tool) => tool.name)).toEqual(["get_selected_tracks"]);

    const playing = buildContextualTools(
      [],
      { playlist: null, shortlist: null },
      { id: "t2", title: "Ember.wav" },
    );
    expect(playing.map((tool) => tool.name)).toEqual(["get_selected_tracks", "get_now_playing"]);
    expect(playing[1]!.description).toContain("playing “Ember” through the user's speakers");
  });

  it("adds remove_now_playing only when the playing track is in the current playlist, and moves on to the next", async () => {
    const playlist = {
      playlistId: "pl-1",
      name: "Pitch",
      tracks: [
        { id: "t1", title: "Sunrise", playbackUrl: "https://cdn/1.mp3" },
        { id: "t2", title: "Ember", playbackUrl: "https://cdn/2.mp3" },
        { id: "t3", title: "Drift", playbackUrl: "https://cdn/3.mp3" },
      ],
      open: false,
    };
    const elsewhere = buildContextualTools([], { playlist, shortlist: null }, { id: "zz", title: "Other" });
    expect(elsewhere.map((tool) => tool.name)).not.toContain("remove_now_playing");

    setPagePlaylist(playlist);
    player.set({ id: "t2", title: "Ember", positionSec: 42, durationSec: 190 });
    const tools = buildContextualTools([], { playlist, shortlist: null }, { id: "t2", title: "Ember" });
    expect(tools.map((tool) => tool.name)).toEqual([
      "get_selected_tracks",
      "get_now_playing",
      "remove_now_playing",
    ]);

    const now = JSON.parse(String(await tools[1]!.execute({})));
    expect(now).toMatchObject({
      success: true,
      track: { id: "t2", title: "Ember", positionSec: 42, durationSec: 190 },
      position: "0:42 of 3:10",
      currentSection: "Verse",
      highlights: [{ label: "Best Hook", atSec: 72 }],
      inCurrentPlaylist: true,
    });

    const removed = JSON.parse(String(await tools[2]!.execute({})));
    expect(removed).toMatchObject({
      success: true,
      playlistId: "pl-1",
      removedTrackIds: ["t2"],
      removedTrack: { id: "t2", title: "Ember" },
      nowPlaying: { id: "t3", title: "Drift" },
    });
    expect(player.playTrack).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t3", playbackUrl: "https://cdn/3.mp3" }),
    );
  });

  it("registers and drops the now-playing tools live as playback starts and stops", async () => {
    const { modelContext, live } = fakeContext();
    const cleanup = installContextualTools(modelContext);
    await flush();
    expect(live().map((tool) => tool.name)).toEqual(["get_selected_tracks"]);

    player.set({ id: "t1", title: "Sunrise", positionSec: 3 });
    await flush();
    expect(live().map((tool) => tool.name)).toEqual(["get_selected_tracks", "get_now_playing"]);

    player.set(null);
    await flush();
    expect(live().map((tool) => tool.name)).toEqual(["get_selected_tracks"]);
    cleanup();
  });
});
