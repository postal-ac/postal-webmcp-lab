import { z } from "zod";

import { apiGet } from "@/postal/client";

import { requireAuthenticatedPostalSession } from "../auth";
import {
  PostalCapabilityError,
  toPostalCapabilityError,
  unwrapPostalResponse,
} from "../errors";

/**
 * A track's precomputed waveform and the parts of it worth jumping to.
 * Postal stores peaks at three resolutions plus markers derived from the
 * audio analysis: sections with a start and end (intro, verse, chorus, drop,
 * build…) and point markers ("Best hook", "Biggest lift", "First vocal").
 * The Lab's player draws the peaks and turns the markers into clickable
 * chips; the agent gets the same list from get_now_playing, so "play me the
 * drop" resolves to a position without either side guessing.
 */
export interface WaveformSection {
  label: string;
  startSec: number;
  endSec: number;
}

export interface WaveformHighlight {
  label: string;
  atSec: number;
}

export interface TrackWaveform {
  trackId: string;
  /** Postal's generation status; peaks are empty unless "completed". */
  status: string;
  durationSec: number;
  /** 0–1 amplitude per bar, ~1024 bars across the track. */
  peaks: number[];
  sections: WaveformSection[];
  highlights: WaveformHighlight[];
}

const inputSchema = z.object({ trackId: z.string().trim().min(1).max(200) });

type UnknownRecord = Record<string, any>;

const PEAK_SCALE = 1000;

function toNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function titleCase(label: string): string {
  return label
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Normalise Postal's waveform payload. Exported for the player, which reads
 * the same endpoint as page furniture rather than through a tool.
 */
export function serializeWaveform(trackId: string, raw: UnknownRecord | null, status: string): TrackWaveform {
  const durationSec = toNumber(raw?.durationSec) ?? 0;
  const pairs: unknown[] = Array.isArray(raw?.resolutions?.["1024"]) ? raw.resolutions["1024"] : [];
  const peaks = pairs.map((pair) => {
    if (!Array.isArray(pair)) return 0;
    const low = Math.abs(toNumber(pair[0]) ?? 0);
    const high = Math.abs(toNumber(pair[1]) ?? 0);
    return Math.min(1, Math.max(low, high) / PEAK_SCALE);
  });

  const sections: WaveformSection[] = [];
  const highlights: WaveformHighlight[] = [];
  const markers: unknown[] = Array.isArray(raw?.markers) ? raw.markers : [];
  for (const marker of markers as UnknownRecord[]) {
    if (!marker || marker.type === "lyric" || marker.type === "transient") continue;
    const startSec = toNumber(marker.startSec);
    if (startSec === null || startSec < 0) continue;
    const endSec = toNumber(marker.endSec);
    const label = typeof marker.label === "string" && marker.label.trim() ? marker.label.trim() : null;
    if (marker.type === "silence") continue;
    if (endSec !== null && endSec > startSec) {
      sections.push({ label: titleCase(label ?? "section"), startSec, endSec });
    } else if (label) {
      highlights.push({ label: titleCase(label), atSec: startSec });
    }
  }
  sections.sort((a, b) => a.startSec - b.startSec);
  highlights.sort((a, b) => a.atSec - b.atSec);

  // No analysis markers yet? The loudest stretch is still a useful place to
  // jump to — derived from the RMS series Postal stores alongside the peaks.
  if (!highlights.length && durationSec > 0) {
    const rms: unknown[] = Array.isArray(raw?.rms?.["1024"]) ? raw.rms["1024"] : [];
    if (rms.length > 8) {
      const window = Math.max(4, Math.floor(rms.length / 32));
      let best = -1;
      let bestIndex = 0;
      for (let index = 0; index + window <= rms.length; index += 1) {
        let sum = 0;
        for (let offset = 0; offset < window; offset += 1) {
          sum += toNumber(rms[index + offset]) ?? 0;
        }
        if (sum > best) {
          best = sum;
          bestIndex = index;
        }
      }
      highlights.push({
        label: "Loudest stretch",
        atSec: Math.round((bestIndex / rms.length) * durationSec),
      });
    }
  }

  return { trackId, status, durationSec, peaks, sections, highlights };
}

export async function getWaveform(input: { trackId: string }): Promise<TrackWaveform> {
  await requireAuthenticatedPostalSession();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PostalCapabilityError("INVALID_INPUT", "A trackId is required.");
  }
  try {
    const response = await apiGet(
      `/tracks/${encodeURIComponent(parsed.data.trackId)}/waveform`,
    );
    const data = unwrapPostalResponse<{
      trackId?: string;
      waveformStatus?: string;
      waveform?: UnknownRecord | null;
    }>(response);
    return serializeWaveform(
      String(data?.trackId ?? parsed.data.trackId),
      data?.waveform ?? null,
      String(data?.waveformStatus ?? "not_started"),
    );
  } catch (error) {
    throw toPostalCapabilityError(error, "TRACK_NOT_FOUND");
  }
}

/** Resolve a spoken section name ("the drop", "hook", "chorus") to a position. */
export function findSectionPosition(
  waveform: Pick<TrackWaveform, "sections" | "highlights">,
  wanted: string,
): { label: string; atSec: number } | null {
  const needle = wanted.trim().toLocaleLowerCase().replace(/^the\s+/, "");
  if (!needle) return null;
  const highlight = waveform.highlights.find((item) =>
    item.label.toLocaleLowerCase().includes(needle),
  );
  if (highlight) return highlight;
  const aliases: Record<string, string[]> = {
    drop: ["drop", "biggest lift", "lift"],
    hook: ["hook", "chorus"],
    chorus: ["chorus", "hook"],
    vocal: ["first vocal", "vocal", "verse"],
    build: ["build", "pre chorus", "pre_chorus"],
  };
  const candidates = aliases[needle] ?? [needle];
  for (const candidate of candidates) {
    const fromHighlights = waveform.highlights.find((item) =>
      item.label.toLocaleLowerCase().includes(candidate),
    );
    if (fromHighlights) return fromHighlights;
    const section = waveform.sections.find((item) =>
      item.label.toLocaleLowerCase().includes(candidate),
    );
    if (section) return { label: section.label, atSec: section.startSec };
  }
  return null;
}
