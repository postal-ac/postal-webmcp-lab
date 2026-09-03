import { useEffect, useMemo, useRef, useState } from "react";

import type { TrackWaveform } from "@/capabilities/tracks/get-waveform";
import { CloseIcon, PauseIcon, PlayIcon } from "@/components/icons";

import { subscribePageContext } from "./page-context-store";
import { neighboursOf, playNext, playPrevious } from "./play-queue";
import {
  pausePlayback,
  playingTrackDetails,
  playTrack,
  seekTo,
  subscribePlayback,
  subscribeProgress,
  type PlaybackProgress,
  type PlayableTrack,
} from "./player-controller";
import { displayTitle } from "./playlist-card";
import { waveformFor } from "./waveform-cache";

/**
 * A fixed player along the bottom of the page. The waveform is Postal's
 * precomputed one, with the analysis markers laid over it: sections as
 * shaded bands you can click into, point highlights ("Best hook", "Biggest
 * lift", "First vocal") as chips that jump straight there. Auditioning a
 * pitch means hearing the moment that matters, not the intro — and the same
 * markers are what the agent reads through get_now_playing, so "play me the
 * drop" lands on the same spot a click would.
 */
export const BOTTOM_PLAYER_HEIGHT = 88;
export const BOTTOM_PLAYER_HEIGHT_CLASS = "h-[88px]";

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

/** Section bands get a stable hue by label so a "Drop" reads the same on every track. */
const SECTION_TONE: Record<string, string> = {
  intro: "rgba(102,102,102,0.10)",
  verse: "rgba(0,122,255,0.10)",
  pre_chorus: "rgba(97,54,255,0.14)",
  "pre chorus": "rgba(97,54,255,0.14)",
  build: "rgba(97,54,255,0.14)",
  chorus: "rgba(97,54,255,0.22)",
  drop: "rgba(97,54,255,0.26)",
  hook: "rgba(97,54,255,0.22)",
  breakdown: "rgba(0,122,255,0.08)",
  bridge: "rgba(0,122,255,0.12)",
  outro: "rgba(102,102,102,0.10)",
};

function toneFor(label: string): string {
  return SECTION_TONE[label.toLocaleLowerCase()] ?? "rgba(102,102,102,0.08)";
}

export function BottomPlayer({ onClose }: { onClose: () => void }) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [track, setTrack] = useState<PlayableTrack | null>(null);
  const [progress, setProgress] = useState<PlaybackProgress>({
    positionSec: 0,
    durationSec: null,
    paused: true,
  });
  const [waveform, setWaveform] = useState<TrackWaveform | null>(null);
  // Re-derive neighbours when the page's lists change.
  const [contextVersion, setContextVersion] = useState(0);

  useEffect(
    () =>
      subscribePlayback((id) => {
        setPlayingId(id);
        // Keep the last track around while paused so the bar can resume it.
        const details = playingTrackDetails();
        if (details) setTrack(details);
      }),
    [],
  );
  useEffect(() => subscribeProgress(setProgress), []);
  useEffect(() => subscribePageContext(() => setContextVersion((n) => n + 1)), []);

  useEffect(() => {
    if (!track) {
      setWaveform(null);
      return;
    }
    let cancelled = false;
    setWaveform(null);
    void waveformFor(track.id).then((result) => {
      if (!cancelled) setWaveform(result);
    });
    return () => {
      cancelled = true;
    };
  }, [track?.id]);

  // Previous / next come from the play queue: the playlist being built, else
  // the brief shortlist, else the catalogue order.
  const neighbours = useMemo(
    () => neighboursOf(track?.id ?? null),
    // contextVersion is the invalidation signal for the page's lists
    [track?.id, contextVersion, playingId],
  );

  if (!track) return null;

  const isPlaying = playingId === track.id && !progress.paused;
  const durationSec = progress.durationSec ?? waveform?.durationSec ?? track.duration ?? 0;

  const toggle = () => {
    if (isPlaying) {
      // Clears the "now playing" state (so the now-playing tools retire) but
      // the bar keeps the track and playTrack resumes from the same spot.
      pausePlayback();
      return;
    }
    void playTrack(track).catch(() => {});
  };
  const jump = (seconds: number) => {
    if (playingId !== track.id) {
      void playTrack(track)
        .then(() => seekTo(seconds))
        .catch(() => {});
      return;
    }
    try {
      seekTo(seconds);
    } catch {
      /* nothing playing */
    }
  };
  const previous = () => void playPrevious().catch(() => {});
  const next = () => void playNext().catch(() => {});
  const close = () => {
    pausePlayback();
    setTrack(null);
    onClose();
  };

  return (
    <div
      role="region"
      aria-label="Player"
      className={`box-in fixed inset-x-0 bottom-0 z-40 ${BOTTOM_PLAYER_HEIGHT_CLASS} border-t border-neutral-175 bg-background-light/95 backdrop-blur-sm`}
    >
      <div className="mx-auto flex h-full w-full max-w-[1180px] items-center gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 shrink-0 items-center gap-3 sm:w-[240px]">
          <div className="size-11 shrink-0 overflow-hidden rounded-[10px] bg-neutral-100">
            {track.coverUrl ? (
              <img src={track.coverUrl} alt="" className="size-11 object-cover" />
            ) : (
              <div
                aria-hidden="true"
                className="size-11 bg-cover bg-center"
                style={{ backgroundImage: "url(/images/gradient_1.png)" }}
              />
            )}
          </div>
          <div className="hidden min-w-0 sm:block">
            <p className="truncate text-sm font-medium text-content">{displayTitle(track.title)}</p>
            <p className="truncate text-xs text-content-subtle">
              {[
                track.artist,
                neighbours.position
                  ? `${neighbours.position.index} / ${neighbours.position.total} in ${
                      neighbours.source === "playlist"
                        ? "playlist"
                        : neighbours.source === "shortlist"
                          ? "shortlist"
                          : "catalogue"
                    }`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <TransportButton
            label="Previous track"
            disabled={!neighbours.previous}
            onClick={previous}
          >
            <svg viewBox="0 0 12 12" className="size-3" fill="currentColor">
              <rect x="1.5" y="1.5" width="1.6" height="9" rx="0.6" />
              <path d="M10.5 1.9v8.2a.6.6 0 0 1-.93.5l-6-4.1a.6.6 0 0 1 0-1l6-4.1a.6.6 0 0 1 .93.5z" />
            </svg>
          </TransportButton>
          <button
            type="button"
            onClick={toggle}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="flex size-10 items-center justify-center rounded-full bg-content text-background-light transition hover:opacity-90"
          >
            {isPlaying ? <PauseIcon className="size-3.5" /> : <PlayIcon className="ml-0.5 size-3.5" />}
          </button>
          <TransportButton
            label="Next track"
            disabled={!neighbours.next}
            onClick={next}
          >
            <svg viewBox="0 0 12 12" className="size-3" fill="currentColor">
              <path d="M1.5 1.9v8.2a.6.6 0 0 0 .93.5l6-4.1a.6.6 0 0 0 0-1l-6-4.1a.6.6 0 0 0-.93.5z" />
              <rect x="8.9" y="1.5" width="1.6" height="9" rx="0.6" />
            </svg>
          </TransportButton>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <div className="flex items-center gap-3">
            <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-content-subtle">
              {clock(progress.positionSec)}
            </span>
            <Waveform
              waveform={waveform}
              positionSec={progress.positionSec}
              durationSec={durationSec}
              onSeek={jump}
            />
            <span className="w-9 shrink-0 text-[11px] tabular-nums text-content-subtle">
              {clock(durationSec)}
            </span>
          </div>
          {waveform && waveform.highlights.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pl-12 [scrollbar-width:none]">
              {waveform.highlights.slice(0, 6).map((highlight) => {
                const active =
                  progress.positionSec >= highlight.atSec &&
                  progress.positionSec < highlight.atSec + 8;
                return (
                  <button
                    key={`${highlight.label}-${highlight.atSec}`}
                    type="button"
                    onClick={() => jump(highlight.atSec)}
                    title={`Jump to ${highlight.label.toLocaleLowerCase()} at ${clock(highlight.atSec)}`}
                    className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition ${
                      active
                        ? "bg-accent text-white"
                        : "bg-accent-muted text-accent hover:bg-accent hover:text-white"
                    }`}
                  >
                    {highlight.label}
                    <span className="tabular-nums opacity-80">{clock(highlight.atSec)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={close}
          aria-label="Stop and close player"
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-content-subtle transition hover:bg-neutral-100 hover:text-content"
        >
          <CloseIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}

function TransportButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-full text-content-subtle transition hover:bg-neutral-100 hover:text-content disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

const BAR_COUNT = 160;

/**
 * Peaks drawn on a canvas so 160 bars re-render at 4 Hz without a DOM churn;
 * sections and the click target are DOM so they stay accessible.
 */
function Waveform({
  waveform,
  positionSec,
  durationSec,
  onSeek,
}: {
  waveform: TrackWaveform | null;
  positionSec: number;
  durationSec: number;
  onSeek: (seconds: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bars = useMemo(() => downsample(waveform?.peaks ?? [], BAR_COUNT), [waveform]);
  const fraction = durationSec > 0 ? Math.min(1, positionSec / durationSec) : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, width, height);
    const count = bars.length || BAR_COUNT;
    const step = width / count;
    const barWidth = Math.max(1, step * 0.6);
    const playedUntil = fraction * width;
    for (let index = 0; index < count; index += 1) {
      const amplitude = bars.length ? bars[index]! : 0.15;
      const barHeight = Math.max(2, amplitude * (height - 4));
      const x = index * step + (step - barWidth) / 2;
      const y = (height - barHeight) / 2;
      ctx.fillStyle = x + barWidth <= playedUntil ? "#181818" : "#d9d9d9";
      ctx.fillRect(x, y, barWidth, barHeight);
    }
  }, [bars, fraction]);

  const seekFromPointer = (event: React.MouseEvent<HTMLDivElement>) => {
    if (durationSec <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    onSeek(ratio * durationSec);
  };

  return (
    <div
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(durationSec)}
      aria-valuenow={Math.round(positionSec)}
      tabIndex={0}
      onClick={seekFromPointer}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") onSeek(Math.min(durationSec, positionSec + 5));
        if (event.key === "ArrowLeft") onSeek(Math.max(0, positionSec - 5));
      }}
      className="relative h-11 min-w-0 flex-1 cursor-pointer select-none rounded-[8px] outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {/* Section bands sit under the bars; a hover shows the label. */}
      {waveform && durationSec > 0 &&
        waveform.sections.map((section) => {
          const left = (section.startSec / durationSec) * 100;
          const width = ((section.endSec - section.startSec) / durationSec) * 100;
          return (
            <button
              key={`${section.label}-${section.startSec}`}
              type="button"
              tabIndex={-1}
              title={`${section.label} · ${clock(section.startSec)}–${clock(section.endSec)}`}
              onClick={(event) => {
                event.stopPropagation();
                onSeek(section.startSec);
              }}
              className="group/section absolute inset-y-0 rounded-[4px] transition hover:brightness-95"
              style={{ left: `${left}%`, width: `${Math.max(0.5, width)}%`, background: toneFor(section.label) }}
            >
              <span className="pointer-events-none absolute left-1 top-0.5 truncate text-[9px] font-medium uppercase tracking-wide text-content-subtle opacity-0 transition group-hover/section:opacity-100">
                {section.label}
              </span>
            </button>
          );
        })}
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" />
      {durationSec > 0 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-px bg-accent"
          style={{ left: `${fraction * 100}%` }}
        />
      )}
      {!waveform?.peaks.length && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-content-subtle/70">
          {waveform && waveform.status !== "completed" ? "Waveform not generated yet" : ""}
        </span>
      )}
    </div>
  );
}

function downsample(peaks: number[], target: number): number[] {
  if (!peaks.length) return [];
  if (peaks.length <= target) return peaks;
  const out: number[] = [];
  const step = peaks.length / target;
  for (let index = 0; index < target; index += 1) {
    const start = Math.floor(index * step);
    const end = Math.max(start + 1, Math.floor((index + 1) * step));
    let max = 0;
    for (let cursor = start; cursor < end && cursor < peaks.length; cursor += 1) {
      if (peaks[cursor]! > max) max = peaks[cursor]!;
    }
    out.push(max);
  }
  return out;
}
