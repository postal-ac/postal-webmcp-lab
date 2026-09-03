import { getWaveform, type TrackWaveform } from "@/capabilities/tracks/get-waveform";

/**
 * One fetch per track per page load. The player bar and the get_now_playing
 * tool both want the same waveform for the same track, often within a second
 * of each other; a failed fetch is cached too so a track without a waveform
 * does not trigger a request on every progress tick.
 */
const cache = new Map<string, Promise<TrackWaveform | null>>();

export function waveformFor(trackId: string): Promise<TrackWaveform | null> {
  let pending = cache.get(trackId);
  if (!pending) {
    pending = getWaveform({ trackId }).catch(() => null);
    cache.set(trackId, pending);
  }
  return pending;
}

/** Test helper. */
export function resetWaveformCache(): void {
  cache.clear();
}
