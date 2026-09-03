import { useEffect, useState } from "react";

import type { AgentTrackDetail } from "@/capabilities/types";
import { subscribePlayback, togglePlayback } from "./player-controller";
import { displayTitle } from "./playlist-card";
import {
  clearSelection,
  isSelected,
  subscribeSelection,
  toggleSelected,
} from "./selection-store";

export type LibraryStatus = "loading" | "ready" | "error";

/**
 * Cover fallback: Postal's own brand gradient (the product's DEFAULT_GRADIENT
 * asset) with a subtle per-track hue shift, for tracks without artwork.
 */
const HUE_STEPS = [0, -14, 14, 28] as const;

function hueFor(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return HUE_STEPS[Math.abs(hash) % HUE_STEPS.length];
}

function duration(seconds?: number): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

const ROW_GRID =
  "grid grid-cols-[2rem_2.25rem_minmax(0,1fr)_3.25rem_3.25rem] items-center gap-3 px-3 sm:grid-cols-[2rem_2.25rem_minmax(0,1fr)_3.25rem_minmax(0,13rem)_3.25rem] sm:px-4";

function Cover({
  track,
  isPlaying,
  onTogglePlay,
}: {
  track: AgentTrackDetail;
  isPlaying: boolean;
  onTogglePlay?: () => void;
}) {
  const art = track.coverUrl ? (
    <img
      src={track.coverUrl}
      alt=""
      loading="lazy"
      className="size-9 rounded-[8px] object-cover"
    />
  ) : (
    <div
      aria-hidden="true"
      className="size-9 rounded-[8px] bg-cover bg-center"
      style={{
        backgroundImage: "url(/images/gradient_1.png)",
        filter: `hue-rotate(${hueFor(track.id)}deg)`,
      }}
    />
  );

  if (!onTogglePlay) return <div className="relative shrink-0">{art}</div>;

  return (
    <button
      type="button"
      onClick={onTogglePlay}
      aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
      className="group/cover relative shrink-0 cursor-pointer"
    >
      {art}
      <span
        aria-hidden="true"
        className={`absolute inset-0 flex items-center justify-center rounded-[8px] bg-content/45 text-white transition-opacity ${
          isPlaying ? "opacity-100" : "opacity-0 group-hover/cover:opacity-100"
        }`}
      >
        {isPlaying ? (
          <svg viewBox="0 0 12 12" className="size-3" fill="currentColor">
            <rect x="2" y="1.5" width="3" height="9" rx="0.75" />
            <rect x="7" y="1.5" width="3" height="9" rx="0.75" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" className="ml-0.5 size-3" fill="currentColor">
            <path d="M3 1.8v8.4a.6.6 0 0 0 .9.52l7-4.2a.6.6 0 0 0 0-1.04l-7-4.2A.6.6 0 0 0 3 1.8z" />
          </svg>
        )}
      </span>
    </button>
  );
}

function TrackRow({
  track,
  index,
  isHighlighted,
  matchReason,
  isPlaying,
  onTogglePlay,
}: {
  track: AgentTrackDetail;
  index: number;
  isHighlighted: boolean;
  /** Set when the last brief match proposed this track; the ranker's reason. */
  matchReason?: string | null;
  isPlaying: boolean;
  onTogglePlay?: () => void;
}) {
  const tags = track.tags ?? [];
  const selected = isSelected(track.id);

  return (
    <div
      data-track-id={track.id}
      className={`group ${ROW_GRID} py-2 transition-colors ${
        isHighlighted ? "bg-accent-muted" : selected ? "bg-neutral-50" : "hover:bg-neutral-50"
      }`}
    >
      {/* Index by default; the checkbox takes its place on hover, focus, or once ticked. */}
      <div className="relative flex h-6 items-center justify-center">
        <span
          aria-hidden="true"
          className={`text-xs tabular-nums text-content-subtle transition-opacity group-focus-within:opacity-0 group-hover:opacity-0 ${
            selected ? "opacity-0" : ""
          }`}
        >
          {index + 1}
        </span>
        <input
          type="checkbox"
          aria-label={`Select ${track.title}`}
          checked={selected}
          onChange={() => toggleSelected(track)}
          className={`absolute size-3.5 cursor-pointer accent-[var(--color-accent)] transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${
            selected ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>
      <Cover track={track} isPlaying={isPlaying} onTogglePlay={onTogglePlay} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`truncate text-sm font-medium ${isPlaying ? "text-accent" : "text-content"}`}
          >
            {displayTitle(track.title)}
          </span>
          {isHighlighted ? (
            <span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-white">
              Picked
            </span>
          ) : matchReason !== undefined ? (
            <span
              title={matchReason ?? undefined}
              className="shrink-0 rounded-full bg-accent-muted px-1.5 py-px text-[10px] font-semibold text-accent"
            >
              Match
            </span>
          ) : null}
        </div>
        {track.artist && (
          <p className="truncate text-xs text-content-subtle">{track.artist}</p>
        )}
      </div>
      <span className="text-right text-sm tabular-nums text-content-subtle">
        {track.bpm ?? ""}
      </span>
      <div className="hidden min-w-0 items-center gap-1.5 sm:flex">
        {tags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="max-w-[7rem] truncate rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-content-subtle"
          >
            {tag}
          </span>
        ))}
        {tags.length > 2 && (
          <span className="shrink-0 text-[11px] text-content-subtle">+{tags.length - 2}</span>
        )}
      </div>
      <span className="text-right text-sm tabular-nums text-content-subtle">
        {duration(track.duration) ?? ""}
      </span>
    </div>
  );
}

function RefreshButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label="Refresh catalogue"
      title="Refresh"
      className="flex size-9 items-center justify-center rounded-full bg-background-light text-content-subtle ring-1 ring-neutral-175 transition hover:text-content disabled:opacity-50"
    >
      <svg
        viewBox="0 0 16 16"
        className={`size-4 ${busy ? "animate-spin" : ""}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
        <path d="M13.5 2.5v3h-3" />
      </svg>
    </button>
  );
}

/**
 * The catalogue the tools operate on, laid out like Postal's own library
 * table. Reads Postal directly rather than through `executeTool` — it is page
 * furniture, not agent activity. Tracks the last workflow selected are
 * marked, so a viewer can see the agent's choice against the library it chose
 * from.
 */
export function TrackLibrary({
  tracks,
  totalCount,
  status,
  error,
  highlighted,
  matched,
  onRefresh,
}: {
  tracks: AgentTrackDetail[];
  totalCount: number;
  status: LibraryStatus;
  error: string | null;
  highlighted: Set<string>;
  /** Track id → the ranker's reason, from the latest brief match on the page. */
  matched?: Map<string, string | null>;
  onRefresh: () => void;
}) {
  // Playback and selection live in module stores shared with the WebMCP
  // tools (control_playback, get_selected_tracks) — the UI subscribes.
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [selectionCount, setSelectionCount] = useState(0);
  const [, forceRender] = useState(0);

  useEffect(() => subscribePlayback(setPlayingId), []);
  useEffect(
    () =>
      subscribeSelection((tracks) => {
        setSelectionCount(tracks.length);
        forceRender((n) => n + 1);
      }),
    [],
  );

  const togglePlay = (track: AgentTrackDetail) => {
    void Promise.resolve(togglePlayback(track)).catch(() => {});
  };

  const countLabel =
    status === "loading" && !tracks.length
      ? "Loading…"
      : tracks.length < totalCount
        ? `${tracks.length} of ${totalCount}`
        : `${totalCount} track${totalCount === 1 ? "" : "s"}`;

  return (
    <section>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-[26px] font-semibold tracking-tight text-content sm:text-[30px]">
              Your catalogue
            </h1>
            <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs tabular-nums text-content-subtle">
              {countLabel}
            </span>
            {selectionCount > 0 && (
              <span className="flex items-center gap-2 text-xs">
                <span className="text-accent">{selectionCount} selected</span>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-content-subtle underline underline-offset-2 hover:text-content"
                >
                  Clear
                </button>
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-content-subtle">
            Ask your agent to search, play, and build playlists from these tracks.
          </p>
        </div>
        <RefreshButton onClick={onRefresh} busy={status === "loading"} />
      </div>

      {status === "error" && error && (
        <p className="mt-6 text-sm text-danger">{error}</p>
      )}

      {status === "ready" && !tracks.length && (
        <div className="mt-6 rounded-[16px] border border-dashed border-neutral-200 px-4 py-10 text-center text-sm text-content-subtle">
          No tracks yet. Upload a few in Postal and refresh.
        </div>
      )}

      {tracks.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-[16px] bg-background-light ring-1 ring-neutral-175">
          <div
            className={`${ROW_GRID} border-b border-neutral-150 py-2 text-[11px] font-medium uppercase tracking-wide text-content-subtle`}
          >
            <span className="text-center">#</span>
            <span />
            <span>Title</span>
            <span className="text-right">BPM</span>
            <span className="hidden sm:block">Tags</span>
            <span className="text-right">Time</span>
          </div>
          <div className="divide-y divide-neutral-100">
            {tracks.map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                index={index}
                isHighlighted={highlighted.has(track.id)}
                matchReason={matched?.has(track.id) ? matched.get(track.id) : undefined}
                isPlaying={playingId === track.id}
                onTogglePlay={track.playbackUrl ? () => togglePlay(track) : undefined}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
