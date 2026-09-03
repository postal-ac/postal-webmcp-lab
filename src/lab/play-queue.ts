import type { AgentTrackSummary } from "@/capabilities/types";

import { pageContext, type PageTrackRef } from "./page-context-store";
import {
  onPlaybackEnded,
  playbackState,
  playingTrackDetails,
  playTrack,
  type PlayableTrack,
} from "./player-controller";

/**
 * Where "next" and "previous" go. The page has three ordered lists a track
 * can belong to, and the most specific one wins: the playlist being built,
 * then the brief shortlist, then the catalogue as displayed. The queue is
 * the same for the bar's transport buttons, the agent's control_playback
 * next/previous, media keys, and auto-advance when a track ends — one
 * answer to "what comes after this?" wherever the question is asked.
 */
export type QueueSource = "playlist" | "shortlist" | "catalogue";

let libraryTracks: AgentTrackSummary[] = [];

/** The catalogue as the page currently shows it. */
export function setCatalogueQueue(tracks: AgentTrackSummary[]): void {
  libraryTracks = tracks;
}

function playable(ref: PageTrackRef | AgentTrackSummary | undefined): PlayableTrack | null {
  if (!ref?.playbackUrl) return null;
  return {
    id: ref.id,
    title: ref.title,
    playbackUrl: ref.playbackUrl,
    ...("artist" in ref && ref.artist ? { artist: ref.artist } : {}),
    ...("coverUrl" in ref && ref.coverUrl ? { coverUrl: ref.coverUrl } : {}),
    ...("duration" in ref && ref.duration ? { duration: ref.duration } : {}),
  };
}

function queueFor(trackId: string): { source: QueueSource; tracks: (PageTrackRef | AgentTrackSummary)[] } | null {
  const context = pageContext();
  const candidates: { source: QueueSource; tracks: (PageTrackRef | AgentTrackSummary)[] }[] = [
    { source: "playlist", tracks: context.playlist?.tracks ?? [] },
    { source: "shortlist", tracks: context.shortlist?.kept ?? [] },
    { source: "catalogue", tracks: libraryTracks },
  ];
  return candidates.find((candidate) => candidate.tracks.some((track) => track.id === trackId)) ?? null;
}

export interface QueueNeighbours {
  source: QueueSource | null;
  previous: PlayableTrack | null;
  next: PlayableTrack | null;
  /** 1-based position and length within the source list, for the bar. */
  position?: { index: number; total: number };
}

export function neighboursOf(trackId: string | null): QueueNeighbours {
  if (!trackId) return { source: null, previous: null, next: null };
  const queue = queueFor(trackId);
  if (!queue) return { source: null, previous: null, next: null };
  const index = queue.tracks.findIndex((track) => track.id === trackId);
  const before = queue.tracks.slice(0, index).reverse().find((track) => track.playbackUrl);
  const after = queue.tracks.slice(index + 1).find((track) => track.playbackUrl);
  return {
    source: queue.source,
    previous: playable(before),
    next: playable(after),
    position: { index: index + 1, total: queue.tracks.length },
  };
}

function currentId(): string | null {
  return playbackState().playingId ?? playingTrackDetails()?.id ?? null;
}

/** Start the next track in the current queue. Resolves to it, or null at the end. */
export async function playNext(): Promise<PlayableTrack | null> {
  const { next } = neighboursOf(currentId());
  if (!next) return null;
  await playTrack(next);
  return next;
}

export async function playPrevious(): Promise<PlayableTrack | null> {
  const { previous } = neighboursOf(currentId());
  if (!previous) return null;
  await playTrack(previous);
  return previous;
}

let installed = false;

/**
 * Auto-advance when a track ends, and wire the OS media keys. Idempotent;
 * the page calls it once on mount.
 */
export function installPlayQueue(): () => void {
  if (installed) return () => {};
  installed = true;
  const stopEnded = onPlaybackEnded((endedId) => {
    const { next } = neighboursOf(endedId);
    if (next) void playTrack(next).catch(() => {});
  });

  const session = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
  if (session) {
    try {
      session.setActionHandler("nexttrack", () => void playNext().catch(() => {}));
      session.setActionHandler("previoustrack", () => void playPrevious().catch(() => {}));
    } catch {
      /* unsupported action */
    }
  }

  return () => {
    installed = false;
    stopEnded();
    if (session) {
      try {
        session.setActionHandler("nexttrack", null);
        session.setActionHandler("previoustrack", null);
      } catch {
        /* unsupported action */
      }
    }
  };
}
