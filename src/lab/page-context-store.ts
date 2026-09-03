/**
 * What is on screen right now, for the tools that only make sense while it
 * is: the playlist the dialog is showing, and the brief shortlist with the
 * user's unticks applied. A module store like the selection, because the
 * contextual tool layer reads it from outside the component tree and
 * re-registers tools as it changes.
 */
export interface PageTrackRef {
  id: string;
  title: string;
  /** Present when the page can play it — lets "skip to the next" work. */
  playbackUrl?: string;
}

export interface PagePlaylistContext {
  playlistId: string;
  name?: string;
  tracks: PageTrackRef[];
  shareUrl?: string;
  /** The dialog is showing it; remove/reorder tools exist only then. */
  open: boolean;
}

export interface PageShortlistContext {
  /** The match_brief execution this shortlist came from. */
  executionId: string;
  source?: string;
  summary?: string | null;
  /** Picks the user has kept, in ranked order. */
  kept: PageTrackRef[];
  total: number;
}

export interface PageContext {
  playlist: PagePlaylistContext | null;
  shortlist: PageShortlistContext | null;
}

type Listener = (context: PageContext) => void;

let current: PageContext = { playlist: null, shortlist: null };
const listeners = new Set<Listener>();

function notify() {
  for (const listener of listeners) listener(current);
}

export function pageContext(): PageContext {
  return current;
}

export function setPagePlaylist(playlist: PagePlaylistContext | null): void {
  current = { ...current, playlist };
  notify();
}

export function setPageShortlist(shortlist: PageShortlistContext | null): void {
  current = { ...current, shortlist };
  notify();
}

export function subscribePageContext(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

/** Test helper: back to an empty page. */
export function resetPageContext(): void {
  current = { playlist: null, shortlist: null };
  notify();
}
