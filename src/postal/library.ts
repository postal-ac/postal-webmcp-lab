import { serializeAgentTrack } from "@/capabilities/tracks/track-serializer";
import type { AgentTrackDetail } from "@/capabilities/types";
import { apiGet } from "@/postal/client";

/**
 * The catalogue panel's own loader, distinct from the `search_tracks` tool on
 * purpose: the tool is an agent contract with a deliberate 50-result cap,
 * while this panel is page furniture that should show the library as it is.
 * `/tracks/all` paginates with `limit` + `cursor` (an offset) and reports
 * `totalCount`/`hasMore`, so page through until done — bounded, because a
 * grid of thousands of cards helps nobody.
 *
 * Pages are handed to `onPage` as they arrive so the first hundred tracks
 * render while the rest load, instead of the page sitting on "Reading…"
 * for four round trips.
 */
const PAGE_SIZE = 100;
const MAX_TRACKS = 400;

export interface LibrarySnapshot {
  tracks: AgentTrackDetail[];
  totalCount: number;
  /** False while further pages are still loading. */
  complete: boolean;
}

export async function fetchLibrary(
  onPage?: (snapshot: LibrarySnapshot) => void,
): Promise<LibrarySnapshot> {
  const tracks: AgentTrackDetail[] = [];
  let totalCount = 0;

  for (let cursor = 0; tracks.length < MAX_TRACKS; cursor += PAGE_SIZE) {
    const response = await apiGet("/tracks/all", {
      limit: String(PAGE_SIZE),
      cursor: String(cursor),
      sort: "newest",
    });
    const data = (response?.data ?? response) as {
      items?: unknown[];
      totalCount?: number;
      hasMore?: boolean;
    };
    const items = Array.isArray(data?.items) ? data.items : [];
    tracks.push(...items.map((item) => serializeAgentTrack(item as never)));
    totalCount = data?.totalCount ?? tracks.length;
    const done = !data?.hasMore || items.length === 0 || tracks.length >= MAX_TRACKS;
    onPage?.({ tracks: tracks.slice(0, MAX_TRACKS), totalCount, complete: done });
    if (done) break;
  }

  return { tracks: tracks.slice(0, MAX_TRACKS), totalCount, complete: true };
}
