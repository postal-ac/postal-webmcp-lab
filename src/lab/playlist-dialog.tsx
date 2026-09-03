import { useEffect, useMemo, useRef, useState } from "react";

import { getTrack } from "@/capabilities/tracks/get-track";
import type { AgentTrackSummary } from "@/capabilities/types";
import { CloseIcon, IconButton, LinkIcon, NoteIcon, StatusDot } from "@/components/icons";
import { Button } from "@/components/ui/button";

import type { AgentPlaylist } from "./agent-playlist";
import { PlayableTrackRows, ShareLinkRow, displayTitle } from "./playlist-card";
import { selectedTracks, subscribeSelection } from "./selection-store";

export type PlaylistPhase = "building" | "ready";

/** How many unknown track ids the dialog will resolve via get_track. */
const MAX_TRACK_LOOKUPS = 25;
/** How many catalogue candidates the add picker lists at once. */
const MAX_PICKER_ROWS = 40;

/**
 * Resolve playlist track ids to playable details: the catalogue already on
 * the page first, get_track for the rest. Ids that fail to resolve are not
 * retried — without that guard every new tool call would refetch them.
 */
function useResolvedTracks(
  trackIds: string[],
  libraryTracks: AgentTrackSummary[],
): AgentTrackSummary[] {
  const [fetched, setFetched] = useState<Map<string, AgentTrackSummary>>(new Map());
  const attempted = useRef(new Set<string>());

  const known = useMemo(() => {
    const map = new Map<string, AgentTrackSummary>();
    for (const track of libraryTracks) map.set(track.id, track);
    for (const [id, track] of fetched) map.set(id, track);
    return map;
  }, [libraryTracks, fetched]);

  useEffect(() => {
    const missing = trackIds
      .filter((id) => !known.has(id) && !attempted.current.has(id))
      .slice(0, MAX_TRACK_LOOKUPS);
    if (!missing.length) return;
    for (const id of missing) attempted.current.add(id);
    let cancelled = false;
    void Promise.allSettled(missing.map((id) => getTrack({ trackId: id }))).then(
      (settled) => {
        if (cancelled) return;
        setFetched((current) => {
          const next = new Map(current);
          for (const outcome of settled) {
            if (outcome.status === "fulfilled") next.set(outcome.value.id, outcome.value);
          }
          return next;
        });
      },
    );
    return () => {
      cancelled = true;
    };
    // Deliberately not keyed on `known` — it changes with every resolve.
  }, [trackIds, libraryTracks]);

  return trackIds.map((id) => known.get(id) ?? { id, title: "Unknown track" });
}

function matches(track: AgentTrackSummary, needle: string): boolean {
  if (!needle) return true;
  const haystack = [track.title, track.artist, ...(track.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  return needle
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/**
 * The playlist as a shared workspace: a dialog that opens the moment any
 * caller — outside agent, or the person — starts assembling a playlist,
 * shows it filling up, lets the person hear each pick and take tracks out
 * or add more from the catalogue, and ends on the deliverable: the share
 * link. Every edit made here runs through the same WebMCP tools the agent
 * uses, so the agent's next call sees exactly what the person sees.
 */
export function PlaylistDialog({
  playlist,
  libraryTracks,
  phase,
  approvalMessage,
  onApprove,
  onAlwaysApprove,
  onDeny,
  onAddTracks,
  onRemoveTrack,
  onRename,
  onReorder,
  onCreateShareLink,
  onDelete,
  onClose,
  bottomInset = 0,
}: {
  playlist: AgentPlaylist;
  libraryTracks: AgentTrackSummary[];
  phase: PlaylistPhase;
  /** A pending in-page approval — answered right here while the dialog owns
   * the screen. */
  approvalMessage: string | null;
  onApprove: () => void;
  onAlwaysApprove: () => void;
  onDeny: () => void;
  onAddTracks: (trackIds: string[]) => Promise<void>;
  onRemoveTrack: (trackId: string) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onReorder: (trackIds: string[]) => Promise<void>;
  onCreateShareLink: () => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
  /** Height of the bottom player, when showing: the dialog centres above it
   * and the backdrop stops there so the transport stays clickable. */
  bottomInset?: number;
}) {
  const tracks = useResolvedTracks(playlist.trackIds, libraryTracks);
  const count = tracks.length;
  const inPlaylist = useMemo(() => new Set(playlist.trackIds), [playlist.trackIds]);

  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<AgentTrackSummary[]>(() => selectedTracks());
  useEffect(() => subscribeSelection(setSelection), []);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Inline rename: the title turns into a field; Enter saves, Escape reverts.
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const startRename = () => {
    setDraftName(playlist.name ?? "");
    setEditingName(true);
  };
  const commitRename = async () => {
    const next = draftName.trim();
    setEditingName(false);
    if (!next || next === playlist.name) return;
    setError(null);
    setRenaming(true);
    try {
      await onRename(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Rename did not go through.");
    } finally {
      setRenaming(false);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || editingName) return;
      if (confirmingDelete) setConfirmingDelete(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editingName, confirmingDelete]);

  const run = async (ids: string[], action: () => Promise<void>) => {
    setError(null);
    setPending((current) => new Set([...current, ...ids]));
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That change did not go through.");
    } finally {
      setPending((current) => {
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  };

  const add = (ids: string[]) => {
    const fresh = ids.filter((id) => !inPlaylist.has(id) && !pending.has(id));
    if (!fresh.length) return;
    void run(fresh, () => onAddTracks(fresh));
  };
  const remove = (track: AgentTrackSummary) => {
    if (pending.has(track.id)) return;
    void run([track.id], () => onRemoveTrack(track.id));
  };
  const [reordering, setReordering] = useState(false);
  const reorder = async (trackIds: string[]) => {
    setError(null);
    setReordering(true);
    try {
      await onReorder(trackIds);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reorder did not go through.");
    } finally {
      setReordering(false);
    }
  };
  const confirmDelete = async () => {
    setError(null);
    setDeleting(true);
    try {
      await onDelete();
      // The derived playlist disappears with the success activity, which
      // unmounts this dialog — nothing more to do here.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Delete did not go through.");
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };
  const [linking, setLinking] = useState(false);
  const createLink = async () => {
    setError(null);
    setLinking(true);
    try {
      await onCreateShareLink();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a share link.");
    } finally {
      setLinking(false);
    }
  };

  const needle = query.trim().toLocaleLowerCase();
  const candidates = useMemo(
    () =>
      libraryTracks
        .filter((track) => !inPlaylist.has(track.id) && matches(track, needle))
        .slice(0, MAX_PICKER_ROWS),
    [libraryTracks, inPlaylist, needle],
  );
  const selectedToAdd = selection.filter((track) => !inPlaylist.has(track.id));

  return (
    <div
      className="fixed inset-x-0 top-0 z-30 flex items-center justify-center bg-content/20 p-4 backdrop-blur-[2px]"
      style={{ bottom: bottomInset }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-dialog-title"
        className="drawer-in flex w-[min(560px,100%)] flex-col overflow-hidden rounded-[20px] bg-background-light shadow-[0_24px_64px_rgba(24,24,24,0.18)] ring-1 ring-neutral-175"
        style={{ maxHeight: `min(calc(100vh - ${bottomInset + 32}px), 720px)` }}
      >
        <div className="shrink-0 px-5 pb-4 pt-4">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-xs font-medium text-content-subtle">
              {phase === "building" ? (
                <>
                  <StatusDot state="paused" />
                  Agent is building this playlist
                </>
              ) : (
                <>
                  <StatusDot state="success" />
                  Playlist
                </>
              )}
            </span>
            <IconButton label="Close" onClick={onClose}>
              <CloseIcon className="size-3.5" />
            </IconButton>
          </div>
          <div className="mt-3 flex items-end justify-between gap-4">
            <div className="min-w-0 flex-1">
              {editingName ? (
                <input
                  autoFocus
                  aria-label="Playlist name"
                  value={draftName}
                  maxLength={120}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={() => void commitRename()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void commitRename();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setEditingName(false);
                    }
                  }}
                  className="-mx-2 w-[calc(100%+1rem)] rounded-[10px] bg-neutral-50 px-2 py-0.5 text-xl font-semibold tracking-tight text-content outline-none ring-1 ring-neutral-200"
                />
              ) : (
                <button
                  type="button"
                  onClick={startRename}
                  disabled={renaming}
                  title="Rename playlist"
                  className="group/name -mx-2 flex max-w-[calc(100%+1rem)] items-center gap-2 rounded-[10px] px-2 py-0.5 text-left transition hover:bg-neutral-50 disabled:opacity-60"
                >
                  <h2
                    id="playlist-dialog-title"
                    className="truncate text-xl font-semibold tracking-tight text-content"
                  >
                    {playlist.name ?? "Untitled playlist"}
                  </h2>
                  {renaming ? (
                    <span className="size-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent text-content-subtle" />
                  ) : (
                    <PencilGlyph className="size-3.5 shrink-0 text-content-subtle opacity-0 transition group-hover/name:opacity-100" />
                  )}
                </button>
              )}
              <p className="mt-0.5 text-xs text-content-subtle">
                {count ? `${count} track${count === 1 ? "" : "s"}` : "No tracks yet"}
              </p>
            </div>
            <Button
              size="compact"
              variant={picking ? "primary" : "secondary"}
              className="shrink-0"
              onClick={() => {
                setPicking((current) => !current);
                setQuery("");
              }}
            >
              {picking ? "Done" : "Add tracks"}
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col border-t border-neutral-150">
          {picking ? (
            <>
              <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-2">
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search your catalogue"
                  aria-label="Search your catalogue"
                  className="h-9 min-w-0 flex-1 rounded-full bg-neutral-50 px-3.5 text-sm text-content outline-none ring-1 ring-neutral-175 transition placeholder:text-content-subtle/70 focus:bg-background-light focus:ring-neutral-200"
                />
                {selectedToAdd.length > 0 && (
                  <Button
                    size="compact"
                    variant="secondary"
                    className="shrink-0"
                    onClick={() => add(selectedToAdd.map((track) => track.id))}
                  >
                    Add {selectedToAdd.length} selected
                  </Button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
                {candidates.length ? (
                  candidates.map((track) => {
                    const busy = pending.has(track.id);
                    return (
                      <button
                        key={track.id}
                        type="button"
                        disabled={busy}
                        onClick={() => add([track.id])}
                        className="group flex w-full items-center gap-3 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-neutral-50 disabled:opacity-60"
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-content transition group-hover:bg-content group-hover:text-background-light">
                          {busy ? (
                            <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          ) : (
                            <PlusGlyph />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-content">
                            {displayTitle(track.title)}
                          </span>
                          {(track.artist || track.bpm) && (
                            <span className="block truncate text-xs text-content-subtle">
                              {track.artist ?? `${track.bpm} BPM`}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <p className="px-1 py-8 text-center text-xs text-content-subtle">
                    {needle ? "No matching tracks." : "Every track is already in this playlist."}
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {count ? (
                <PlayableTrackRows
                  tracks={tracks}
                  pendingIds={pending}
                  onRemove={remove}
                  onReorder={reordering ? undefined : (ids) => void reorder(ids)}
                />
              ) : (
                <p className="px-1 py-8 text-center text-xs text-content-subtle">
                  Tracks appear here as they are added. Ask your agent, or add some yourself.
                </p>
              )}
            </div>
          )}
          {error && <p className="shrink-0 px-5 pb-2 text-xs text-danger">{error}</p>}
        </div>

        <div className="shrink-0 border-t border-neutral-150 px-5 py-4">
          {confirmingDelete ? (
            <div className="rounded-[14px] bg-danger/8 px-4 py-3.5">
              <p className="text-xs font-medium text-danger">Delete this playlist?</p>
              <p className="mt-1 text-xs leading-relaxed text-content">
                “{playlist.name ?? "Untitled playlist"}” and its share link will be gone.
                The tracks stay in your library.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="compact"
                  className="bg-danger text-white hover:opacity-90"
                  isLoading={deleting}
                  loadingText="Deleting"
                  onClick={() => void confirmDelete()}
                >
                  Delete playlist
                </Button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setConfirmingDelete(false)}
                  className="px-2 text-xs font-medium text-content-subtle transition hover:text-content"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : approvalMessage ? (
            <div className="rounded-[14px] bg-accent-muted px-4 py-3.5">
              <p className="text-xs font-medium text-accent">Needs your approval</p>
              <p className="mt-1 text-xs leading-relaxed text-content">{approvalMessage}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="compact" onClick={onApprove}>
                  Approve
                </Button>
                <Button size="compact" variant="secondary" onClick={onAlwaysApprove}>
                  Always approve
                </Button>
                <button
                  type="button"
                  onClick={onDeny}
                  className="px-2 text-xs font-medium text-content-subtle transition hover:text-content"
                >
                  Deny
                </button>
              </div>
            </div>
          ) : playlist.shareUrl ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-content">Private share link</p>
                <DeleteLink onClick={() => setConfirmingDelete(true)} />
              </div>
              <ShareLinkRow shareUrl={playlist.shareUrl} />
            </>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs leading-relaxed text-content-subtle">
                {phase === "building"
                  ? "No share link yet. You will be asked before an agent creates one."
                  : "No share link yet."}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <DeleteLink onClick={() => setConfirmingDelete(true)} />
                <Button
                  size="compact"
                  className="gap-1.5"
                  disabled={count === 0}
                  isLoading={linking}
                  loadingText="Creating"
                  onClick={() => void createLink()}
                >
                  <LinkIcon className="size-3" />
                  Create share link
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DeleteLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2 text-xs font-medium text-content-subtle transition hover:text-danger"
    >
      Delete
    </button>
  );
}

function PencilGlyph({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8.3 1.9l1.8 1.8-5.9 5.9-2.4.6.6-2.4z" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M6 2.5v7M2.5 6h7" />
    </svg>
  );
}

/** Collapsed handle for a dismissed dialog — one click brings it back. */
export function PlaylistPill({
  playlist,
  onOpen,
}: {
  playlist: AgentPlaylist;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="drawer-in fixed right-4 top-[68px] z-20 flex max-w-[260px] items-center gap-2 rounded-full bg-background-light py-2 pl-3 pr-3.5 text-xs font-medium text-content shadow-[0_8px_24px_rgba(24,24,24,0.10)] ring-1 ring-neutral-175 transition hover:bg-neutral-50"
    >
      <NoteIcon className="size-3.5 text-content-subtle" />
      <span className="truncate">{playlist.name ?? "Playlist"}</span>
      {playlist.trackIds.length > 0 && (
        <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 py-px text-[11px] tabular-nums text-content-subtle">
          {playlist.trackIds.length}
        </span>
      )}
    </button>
  );
}
