import { useEffect, useRef, useState } from "react";

import { getTrack } from "@/capabilities/tracks/get-track";
import type { AgentTrackSummary } from "@/capabilities/types";
import { CloseIcon, CopyIcon, ExternalIcon, PauseIcon, PlayIcon } from "@/components/icons";

import { playTrack, subscribePlayback, togglePlayback } from "./player-controller";

/** Shared playlist UI primitives — used by the activity box and the drawer. */

/** Titles arrive as stored — often a filename. The extension is noise here. */
export function displayTitle(title: string): string {
  return title.replace(/\.(mp3|wav|flac|aiff?|m4a|ogg)$/i, "");
}

function hostAndPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export function ShareLinkRow({ shareUrl }: { shareUrl: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="mt-2.5 flex items-center gap-1.5 rounded-full bg-neutral-50 py-1 pl-3.5 pr-1 ring-1 ring-neutral-150">
      <span className="min-w-0 flex-1 truncate text-xs text-content-subtle" title={shareUrl}>
        {hostAndPath(shareUrl)}
      </span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(shareUrl)
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
        }}
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-content px-3 text-[11px] font-medium text-background-light transition hover:opacity-90"
      >
        <CopyIcon className="size-3" />
        {copied ? "Copied" : "Copy"}
      </button>
      <a
        href={shareUrl}
        target="_blank"
        rel="noreferrer"
        aria-label="Open share link"
        title="Open"
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-content-subtle transition hover:bg-neutral-100 hover:text-content"
      >
        <ExternalIcon className="size-3.5" />
      </a>
    </div>
  );
}

/**
 * Track rows with inline play buttons — the validation loop. Whatever an
 * agent claims it put in the playlist, the human can hear each pick right
 * here. Playback URLs are presigned with ~1h expiry, so a failed play
 * refetches the track once for a fresh URL before giving up.
 */
function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

function GripGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3" fill="currentColor">
      <circle cx="4" cy="2.5" r="1" />
      <circle cx="8" cy="2.5" r="1" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="8" cy="6" r="1" />
      <circle cx="4" cy="9.5" r="1" />
      <circle cx="8" cy="9.5" r="1" />
    </svg>
  );
}

export function PlayableTrackRows({
  tracks,
  pendingIds,
  onRemove,
  onReorder,
}: {
  tracks: AgentTrackSummary[];
  /** Tracks with an edit in flight — shown dimmed with a spinner. */
  pendingIds?: Set<string>;
  /** When given, each row gets a remove control. */
  onRemove?: (track: AgentTrackSummary) => void;
  /** When given, rows can be dragged (or nudged with Alt+arrows on the grip)
   * into a new order; called with the complete new id sequence. */
  onReorder?: (trackIds: string[]) => void;
}) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  useEffect(() => subscribePlayback(setPlayingId), []);

  // Drag state: the index being dragged and where it would land. The order
  // shown while dragging is a preview; the real order is committed on drop.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dragging = useRef(false);

  const previewTracks =
    dragFrom !== null && dragOver !== null && dragFrom !== dragOver
      ? moveItem(tracks, dragFrom, dragOver)
      : tracks;

  const endDrag = () => {
    dragging.current = false;
    setDragFrom(null);
    setDragOver(null);
  };
  const commit = (from: number, to: number) => {
    if (from === to || !onReorder) return;
    onReorder(moveItem(tracks, from, to).map((track) => track.id));
  };

  const toggle = async (track: AgentTrackSummary) => {
    setFailedId(null);
    try {
      await togglePlayback(track);
    } catch {
      try {
        const fresh = await getTrack({ trackId: track.id });
        await playTrack(fresh);
      } catch {
        setFailedId(track.id);
      }
    }
  };

  return (
    <div className="flex flex-col" onDragLeave={(event) => {
      if (event.currentTarget === event.target) setDragOver(null);
    }}>
      {previewTracks.map((track, index) => {
        const isPlaying = playingId === track.id;
        const busy = pendingIds?.has(track.id) ?? false;
        const originalIndex = tracks.indexOf(track);
        const isDragged = dragFrom !== null && originalIndex === dragFrom;
        const meta =
          failedId === track.id
            ? "Playback failed"
            : (track.artist ??
              [track.bpm && `${track.bpm} BPM`, track.key].filter(Boolean).join(" · "));
        return (
          <div
            key={track.id}
            draggable={Boolean(onReorder) && !busy}
            onDragStart={(event) => {
              if (!onReorder) return;
              dragging.current = true;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", track.id);
              setDragFrom(originalIndex);
              setDragOver(originalIndex);
            }}
            onDragOver={(event) => {
              if (!dragging.current) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (dragOver !== index) setDragOver(index);
            }}
            onDrop={(event) => {
              if (!dragging.current) return;
              event.preventDefault();
              const from = dragFrom;
              const to = dragOver ?? index;
              endDrag();
              if (from !== null) commit(from, to);
            }}
            onDragEnd={endDrag}
            className={`group flex items-center gap-3 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-neutral-50 ${
              busy ? "opacity-60" : ""
            } ${isDragged ? "bg-accent-muted opacity-70 ring-1 ring-accent/30" : ""}`}
          >
            {onReorder && (
              <button
                type="button"
                aria-label={`Reorder ${track.title}. Hold Alt and press an arrow key to move.`}
                title="Drag to reorder"
                disabled={busy}
                onKeyDown={(event) => {
                  if (!event.altKey) return;
                  if (event.key === "ArrowUp" && originalIndex > 0) {
                    event.preventDefault();
                    commit(originalIndex, originalIndex - 1);
                  } else if (event.key === "ArrowDown" && originalIndex < tracks.length - 1) {
                    event.preventDefault();
                    commit(originalIndex, originalIndex + 1);
                  }
                }}
                className="-ml-1 flex size-6 shrink-0 cursor-grab items-center justify-center rounded-full text-content-subtle/60 transition hover:bg-neutral-150 hover:text-content active:cursor-grabbing"
              >
                <GripGlyph />
              </button>
            )}
            {track.playbackUrl ? (
              <button
                type="button"
                onClick={() => void toggle(track)}
                aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
                className={`flex size-7 shrink-0 items-center justify-center rounded-full transition ${
                  isPlaying
                    ? "bg-accent text-white"
                    : "bg-neutral-100 text-content group-hover:bg-neutral-150"
                }`}
              >
                {isPlaying ? (
                  <PauseIcon className="size-2.5" />
                ) : (
                  <PlayIcon className="ml-px size-2.5" />
                )}
              </button>
            ) : (
              <span className="flex size-7 shrink-0 items-center justify-center text-xs tabular-nums text-content-subtle">
                {index + 1}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p
                className={`truncate text-sm font-medium ${isPlaying ? "text-accent" : "text-content"}`}
              >
                {displayTitle(track.title)}
              </p>
              {meta && (
                <p
                  className={`truncate text-xs ${
                    failedId === track.id ? "text-danger" : "text-content-subtle"
                  }`}
                >
                  {meta}
                </p>
              )}
            </div>
            {onRemove && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemove(track)}
                aria-label={`Remove ${track.title} from playlist`}
                title="Remove from playlist"
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-content-subtle opacity-0 transition hover:bg-neutral-150 hover:text-content focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-100"
              >
                {busy ? (
                  <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <CloseIcon className="size-3" />
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
