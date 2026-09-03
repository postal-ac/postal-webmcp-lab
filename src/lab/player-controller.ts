import type { AgentTrackSummary } from "@/capabilities/types";

/**
 * The page's single audio element, owned outside React so that both the
 * catalogue UI and the `control_playback` WebMCP tool can drive it. Playing
 * through the page is a capability only WebMCP can offer an agent — the
 * sound comes out of the user's actual speakers, in the tab they're watching.
 */
type Listener = (playingId: string | null) => void;

export type PlayableTrack = Pick<AgentTrackSummary, "id" | "title" | "playbackUrl"> &
  Partial<Pick<AgentTrackSummary, "artist" | "coverUrl" | "duration">>;

export interface PlaybackProgress {
  positionSec: number;
  durationSec: number | null;
  paused: boolean;
}

type ProgressListener = (progress: PlaybackProgress) => void;

let audio: HTMLAudioElement | null = null;
let playingId: string | null = null;
let playingTitle: string | null = null;
let playingTrack: PlayableTrack | null = null;
const listeners = new Set<Listener>();
const progressListeners = new Set<ProgressListener>();
const endedListeners = new Set<(trackId: string) => void>();

/** Called with the id of the track that just played to its end. */
export function onPlaybackEnded(listener: (trackId: string) => void): () => void {
  endedListeners.add(listener);
  return () => endedListeners.delete(listener);
}

function readProgress(): PlaybackProgress {
  const duration =
    audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null;
  return {
    positionSec: audio?.currentTime ?? 0,
    durationSec: duration,
    paused: !audio || audio.paused,
  };
}

function notifyProgress() {
  if (!progressListeners.size) return;
  const progress = readProgress();
  for (const listener of progressListeners) listener(progress);
}

function ensureAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = "none";
    const stop = () => setPlaying(null, null);
    audio.addEventListener("ended", () => {
      const endedId = playingId;
      stop();
      if (endedId) for (const listener of endedListeners) listener(endedId);
    });
    audio.addEventListener("error", stop);
    for (const event of ["timeupdate", "durationchange", "play", "pause", "seeked"]) {
      audio.addEventListener(event, notifyProgress);
    }
  }
  return audio;
}

function setPlaying(id: string | null, title: string | null) {
  playingId = id;
  playingTitle = title;
  if (!id) playingTrack = null;
  for (const listener of listeners) listener(id);
  notifyProgress();
}

/** Live position updates for the player UI, roughly 4× a second while playing. */
export function subscribeProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  listener(readProgress());
  return () => progressListeners.delete(listener);
}

/** The track behind the current playback, with cover and artist for display. */
export function playingTrackDetails(): PlayableTrack | null {
  return playingTrack;
}

/** Jump within the playing track. Clamped to the known duration. */
export function seekTo(positionSec: number): PlaybackProgress {
  if (!audio || !playingId) {
    throw new Error("Nothing is playing to seek within.");
  }
  const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null;
  const clamped = Math.max(0, duration ? Math.min(positionSec, Math.max(0, duration - 0.5)) : positionSec);
  audio.currentTime = clamped;
  if (audio.paused) void audio.play().catch(() => {});
  notifyProgress();
  return readProgress();
}

export function subscribePlayback(listener: Listener): () => void {
  listeners.add(listener);
  listener(playingId);
  return () => listeners.delete(listener);
}

export function playbackState(): { playingId: string | null; title: string | null } {
  return { playingId, title: playingTitle };
}

export interface NowPlaying {
  id: string;
  title: string;
  /** Seconds into the track, rounded. */
  positionSec: number;
  /** Track length in seconds when the browser knows it. */
  durationSec?: number;
}

/**
 * What the user's ears are on right now — the one piece of context an agent
 * can get from nowhere else. Read live from the audio element, so the
 * position is current at call time rather than at the last event.
 */
export function nowPlaying(): NowPlaying | null {
  if (!playingId || !audio) return null;
  const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined;
  return {
    id: playingId,
    title: playingTitle ?? "Untitled track",
    positionSec: Math.round(audio.currentTime || 0),
    ...(duration !== undefined ? { durationSec: Math.round(duration) } : {}),
  };
}

export async function playTrack(track: PlayableTrack): Promise<void> {
  if (!track.playbackUrl) throw new Error("This track has no playable rendition.");
  const element = ensureAudio();
  if (element.src === track.playbackUrl && !element.ended && element.currentTime > 0) {
    // The same rendition is loaded and was paused part-way: resume there
    // rather than restarting, whichever control paused it.
    playingTrack = { ...playingTrack, ...track };
    await element.play();
    setPlaying(track.id, track.title);
    return;
  }
  element.src = track.playbackUrl;
  await element.play();
  playingTrack = track;
  setPlaying(track.id, track.title);
}

export function pausePlayback(): { wasPlaying: boolean } {
  const wasPlaying = playingId !== null;
  audio?.pause();
  setPlaying(null, null);
  return { wasPlaying };
}

export function togglePlayback(track: PlayableTrack): Promise<void> | void {
  if (playingId === track.id) {
    pausePlayback();
    return;
  }
  return playTrack(track);
}
