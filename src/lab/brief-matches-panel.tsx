import { useEffect, useState } from "react";

import type { BriefMatch } from "@/capabilities/types";
import { CloseIcon, PauseIcon, PlayIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

import type { PageBriefMatch } from "./brief-matches";
import { subscribePlayback, togglePlayback } from "./player-controller";
import { displayTitle } from "./playlist-card";

/**
 * The agent's proposal for a brief, laid out for a human to judge by ear:
 * every pick plays inline, carries the ranker's reason, and can be unticked.
 * Nothing has been written yet — the shortlist becomes a playlist only when
 * the person presses the button (or the agent goes on to create_playlist
 * itself). The human validates the picks, not the agent's summary of them.
 */
export function BriefMatchesPanel({
  match,
  inPlaylist,
  busy,
  onCreatePlaylist,
  onKeptChange,
  onDismiss,
}: {
  match: PageBriefMatch;
  /** Ids already in the page's playlist, so they read as done rather than pending. */
  inPlaylist: Set<string>;
  busy: boolean;
  onCreatePlaylist: (trackIds: string[]) => Promise<void>;
  /** The kept picks, in rank order — the agent reads these through
   * create_playlist_from_shortlist, so the person's unticks reach it. */
  onKeptChange?: (kept: BriefMatch[]) => void;
  onDismiss: () => void;
}) {
  const [rejected, setRejected] = useState<Set<string>>(() => new Set());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribePlayback(setPlayingId), []);
  // A fresh match is a fresh shortlist — earlier rejections do not carry over.
  useEffect(() => {
    setRejected(new Set());
    setError(null);
  }, [match.executionId]);

  const kept = match.matches.filter((pick) => !rejected.has(pick.id));
  const pending = kept.filter((pick) => !inPlaylist.has(pick.id));
  const keptKey = kept.map((pick) => pick.id).join("|");
  useEffect(() => {
    onKeptChange?.(kept);
    // Keyed on membership (keptKey), not on the array's identity.
  }, [keptKey, match.executionId]);
  const { brief } = match;
  const heading = brief.source ? `Brief from ${brief.source}` : "Brief matches";

  const toggleRejected = (id: string) =>
    setRejected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const create = async () => {
    setError(null);
    try {
      await onCreatePlaylist(pending.map((pick) => pick.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the playlist.");
    }
  };

  return (
    <section
      aria-label="Brief matches"
      className="box-in mt-6 overflow-hidden rounded-[16px] bg-background-light ring-1 ring-accent/30"
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h2 className="text-sm font-semibold text-content">{heading}</h2>
            <span className="rounded-full bg-accent-muted px-2 py-0.5 text-[11px] font-medium text-accent">
              {match.matches.length} pick{match.matches.length === 1 ? "" : "s"}
              {typeof match.candidatePool === "number" && match.candidatePool > match.matches.length
                ? ` of ${match.candidatePool} considered`
                : ""}
            </span>
            {!brief.parsed && (
              <span className="text-[11px] text-content-subtle">
                ranked on the raw text — Postal could not parse this brief
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-content-subtle" title={brief.excerpt}>
            {brief.summary ?? brief.excerpt}
            {brief.artist ? ` · ref. ${brief.artist}` : ""}
          </p>
          {brief.applied && (brief.applied.bpmRange || brief.applied.instrumental !== undefined) && (
            <p className="mt-1 text-[11px] text-content-subtle">
              Filters{brief.applied.fromBriefText ? " read from the brief" : ""}:{" "}
              {[
                brief.applied.bpmRange ? `${brief.applied.bpmRange[0]}–${brief.applied.bpmRange[1]} BPM` : null,
                brief.applied.instrumental === true
                  ? "instrumental"
                  : brief.applied.instrumental === false
                    ? "with vocals"
                    : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss brief matches"
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-content-subtle transition hover:bg-neutral-100 hover:text-content"
        >
          <CloseIcon className="size-3" />
        </button>
      </div>

      {match.matches.length === 0 ? (
        <p className="border-t border-neutral-150 px-5 py-6 text-center text-xs text-content-subtle">
          Nothing in the catalogue fits this brief closely enough. Try loosening it, or upload
          more tracks.
        </p>
      ) : (
        <ol className="divide-y divide-neutral-100 border-t border-neutral-150">
          {match.matches.map((pick) => (
            <MatchRow
              key={pick.id}
              pick={pick}
              rejected={rejected.has(pick.id)}
              inPlaylist={inPlaylist.has(pick.id)}
              isPlaying={playingId === pick.id}
              onToggleRejected={() => toggleRejected(pick.id)}
              onTogglePlay={
                pick.playbackUrl
                  ? () => void Promise.resolve(togglePlayback(pick)).catch(() => {})
                  : undefined
              }
            />
          ))}
        </ol>
      )}

      {match.matches.length > 0 && match.playlistId && (
        <p className="border-t border-neutral-150 px-4 py-3 text-xs text-content-subtle sm:px-5">
          These picks are in your playlist. Listen there, drop what does not fit, and ask for more.
        </p>
      )}
      {match.matches.length > 0 && !match.playlistId && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-150 px-4 py-3 sm:px-5">
          <p className="text-xs text-content-subtle">
            {error ? (
              <span className="text-danger">{error}</span>
            ) : pending.length === 0 && kept.length > 0 ? (
              "All kept picks are in the playlist."
            ) : (
              "Listen, untick what does not fit, then make the playlist — or let your agent do it."
            )}
          </p>
          <Button
            size="compact"
            isLoading={busy}
            disabled={busy || pending.length === 0}
            onClick={() => void create()}
          >
            {inPlaylist.size > 0
              ? `Add ${pending.length} to playlist`
              : `Create playlist (${pending.length})`}
          </Button>
        </div>
      )}
    </section>
  );
}

function scoreLabel(score?: number): string | null {
  if (score === undefined) return null;
  return `${Math.round(score * 100)}%`;
}

function MatchRow({
  pick,
  rejected,
  inPlaylist,
  isPlaying,
  onToggleRejected,
  onTogglePlay,
}: {
  pick: BriefMatch;
  rejected: boolean;
  inPlaylist: boolean;
  isPlaying: boolean;
  onToggleRejected: () => void;
  onTogglePlay?: () => void;
}) {
  const score = scoreLabel(pick.score);
  return (
    <li
      data-track-id={pick.id}
      className={`grid grid-cols-[2rem_2.25rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 transition-opacity sm:px-4 ${
        rejected ? "opacity-45" : ""
      }`}
    >
      <div className="flex h-6 items-center justify-center">
        <input
          type="checkbox"
          aria-label={rejected ? `Keep ${pick.title}` : `Drop ${pick.title}`}
          checked={!rejected}
          onChange={onToggleRejected}
          className="size-3.5 cursor-pointer accent-[var(--color-accent)]"
        />
      </div>
      <button
        type="button"
        onClick={onTogglePlay}
        disabled={!onTogglePlay}
        aria-label={isPlaying ? `Pause ${pick.title}` : `Play ${pick.title}`}
        className="group/cover relative size-9 shrink-0 overflow-hidden rounded-[8px] bg-neutral-100 disabled:cursor-default"
      >
        {pick.coverUrl ? (
          <img src={pick.coverUrl} alt="" loading="lazy" className="size-9 object-cover" />
        ) : (
          <span
            aria-hidden="true"
            className="block size-9 bg-cover bg-center"
            style={{ backgroundImage: "url(/images/gradient_1.png)" }}
          />
        )}
        {onTogglePlay && (
          <span
            aria-hidden="true"
            className={`absolute inset-0 flex items-center justify-center bg-content/45 text-white transition-opacity ${
              isPlaying ? "opacity-100" : "opacity-0 group-hover/cover:opacity-100"
            }`}
          >
            {isPlaying ? <PauseIcon className="size-3" /> : <PlayIcon className="ml-0.5 size-3" />}
          </span>
        )}
      </button>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-[11px] tabular-nums text-content-subtle">{pick.rank}</span>
          <span
            className={`truncate text-sm font-medium ${isPlaying ? "text-accent" : "text-content"}`}
          >
            {displayTitle(pick.title)}
          </span>
          {pick.artist && (
            <span className="hidden truncate text-xs text-content-subtle sm:inline">{pick.artist}</span>
          )}
          {inPlaylist && (
            <span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-white">
              In playlist
            </span>
          )}
        </div>
        {pick.reason && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-content-subtle">{pick.reason}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 text-right">
        {score && (
          <>
            <span className="text-xs font-medium tabular-nums text-content">{score}</span>
            <span aria-hidden="true" className="block h-1 w-14 overflow-hidden rounded-full bg-neutral-100">
              <span
                className="block h-full rounded-full bg-accent"
                style={{ width: `${Math.round((pick.score ?? 0) * 100)}%` }}
              />
            </span>
          </>
        )}
        {(pick.bpm || pick.key) && (
          <span className="text-[11px] tabular-nums text-content-subtle">
            {[pick.bpm ? `${pick.bpm} BPM` : null, pick.key].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>
    </li>
  );
}
