import { z } from "zod";

import { apiPost } from "@/postal/client";

import { requireAuthenticatedPostalSession } from "../auth";
import {
  PostalCapabilityError,
  toPostalCapabilityError,
  unwrapPostalResponse,
} from "../errors";
import type { BriefMatch, BriefMatchResult, MatchBriefInput } from "../types";

/**
 * Brief → ranked tracks, through Postal's Co-Work brief funnel
 * (`POST /smart-playlists/generate-from-brief`). Postal parses the prose into
 * its A&R vocabulary (energy, mood, groove, vocals, BPM range…), retrieves
 * candidates from the audio-intelligence index and ranks them, returning a
 * one-sentence reason per pick. The agent brings the brief — from an email,
 * a Disco page, a PDF dropped on this page — and gets back track ids it can
 * hand straight to create_playlist.
 *
 * Metered: one Postal credit per call. An empty balance comes back as a typed
 * INSUFFICIENT_CREDITS error rather than a retry-able failure.
 */
const MIN_BRIEF_CHARS = 20;
const MAX_BRIEF_CHARS = 20_000;
const EXCERPT_CHARS = 160;

const inputSchema = z.object({
  brief: z.string().trim().min(MIN_BRIEF_CHARS).max(MAX_BRIEF_CHARS),
  source: z.string().trim().min(1).max(120).optional(),
  limit: z.number().int().min(1).max(25).default(8),
  excludeTrackIds: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  bpmRange: z.tuple([z.number().int().min(20).max(300), z.number().int().min(20).max(300)]).optional(),
  instrumental: z.boolean().optional(),
});

/**
 * Hard filters read off the brief text itself, so a stated "100–115 BPM,
 * instrumental only" holds even when Postal's brief parser is unavailable
 * and the ranker would otherwise score on prose alone. Caller-supplied
 * values win; these fill the gaps.
 */
export function inferBriefConstraints(text: string): { bpmRange?: [number, number]; instrumental?: boolean } {
  const lower = text.toLocaleLowerCase();
  const out: { bpmRange?: [number, number]; instrumental?: boolean } = {};

  const range = lower.match(/(\d{2,3})\s*(?:-|–|—|to)\s*(\d{2,3})\s*bpm/);
  const around = lower.match(/(?:around|about|approx(?:imately)?|~|circa)\s*(\d{2,3})\s*bpm/);
  const single = lower.match(/(\d{2,3})\s*bpm/);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    if (low < high && low >= 40 && high <= 250) out.bpmRange = [low, high];
  } else if (around) {
    const centre = Number(around[1]);
    if (centre >= 40 && centre <= 250) out.bpmRange = [centre - 5, centre + 5];
  } else if (single) {
    const centre = Number(single[1]);
    if (centre >= 40 && centre <= 250) out.bpmRange = [centre - 5, centre + 5];
  }

  if (
    /\b(instrumental(?:s| only)?|no vocals?|without vocals?|non-vocal|no lyrics|no singing)\b/.test(lower)
  ) {
    out.instrumental = true;
  } else if (/\b(with vocals?|vocal(?:s)? (?:needed|required|please)|female vocal|male vocal|sung)\b/.test(lower)) {
    out.instrumental = false;
  }
  return out;
}

type UnknownRecord = Record<string, any>;

interface BriefFunnelResponse {
  orderedTracks?: UnknownRecord[];
  candidatePoolSize?: number;
  historyId?: string | null;
  briefParsed?: boolean;
  brief?: {
    artist?: string | null;
    summary?: string | null;
  };
}

function optionalNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/** The ranker's reason is a sentence now, but older paths still send arrays. */
function reasonText(reason: unknown): string | undefined {
  if (typeof reason === "string") return reason.trim() || undefined;
  if (Array.isArray(reason)) {
    const joined = reason
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .map((part) => part.trim())
      .join("; ");
    return joined || undefined;
  }
  return undefined;
}

function clampScore(value: unknown): number | undefined {
  const score = optionalNumber(value);
  if (score === undefined) return undefined;
  return Math.min(1, Math.max(0, score));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item : String(item?.name ?? "")))
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Preview tracks are a flatter shape than the library rows `serializeAgentTrack`
 * reads (string arrays for artists/genres/moods, match data alongside), so
 * they get their own mapping rather than a lossy trip through that one.
 */
export function serializeBriefMatch(raw: UnknownRecord, rank: number): BriefMatch {
  const profile = raw?.audio_profile ?? {};
  const match = raw?.match ?? {};
  const artist = stringList(raw?.artists).join(", ") || undefined;
  const tags = Array.from(
    new Set([...stringList(raw?.genres), ...stringList(raw?.moods), ...stringList(match.top_tags)]),
  );
  const score = clampScore(match.score);
  const reason = reasonText(match.reason);

  return {
    id: String(raw.id),
    title: String(raw.name ?? "Untitled track"),
    rank,
    ...(profile.cover ? { coverUrl: String(profile.cover) } : {}),
    ...(raw.playbackLink || raw.downloadLink
      ? { playbackUrl: String(raw.playbackLink ?? raw.downloadLink) }
      : {}),
    ...(artist ? { artist } : {}),
    ...(optionalNumber(profile.bpm) !== undefined ? { bpm: optionalNumber(profile.bpm) } : {}),
    ...(profile.key ? { key: String(profile.key) } : {}),
    ...(tags.length ? { tags } : {}),
    ...(optionalNumber(raw.duration) !== undefined
      ? { duration: optionalNumber(raw.duration) }
      : {}),
    ...(score !== undefined ? { score } : {}),
    ...(reason ? { reason } : {}),
  };
}

export async function matchBrief(input: MatchBriefInput): Promise<BriefMatchResult> {
  await requireAuthenticatedPostalSession();

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new PostalCapabilityError(
      "INVALID_INPUT",
      issue?.path[0] === "brief"
        ? `A brief of ${MIN_BRIEF_CHARS}–${MAX_BRIEF_CHARS} characters is required — paste the text of the brief itself.`
        : (issue?.message ?? "Invalid brief input."),
    );
  }

  const { brief, source, limit, excludeTrackIds } = parsed.data;
  const inferred = inferBriefConstraints(brief);
  const bpmRange = parsed.data.bpmRange ?? inferred.bpmRange;
  const instrumental = parsed.data.instrumental ?? inferred.instrumental;
  const constraints = {
    ...(bpmRange ? { bpmRange } : {}),
    ...(instrumental !== undefined ? { hasVocals: !instrumental } : {}),
  };
  const tuning = instrumental ? { vocalPreference: "instrumental" } : {};

  try {
    const response = await apiPost(
      "/smart-playlists/generate-from-brief",
      JSON.stringify({
        brief,
        limit,
        ...(excludeTrackIds?.length ? { excludedIds: excludeTrackIds } : {}),
        ...(Object.keys(constraints).length ? { constraints } : {}),
        ...(Object.keys(tuning).length ? { tuning } : {}),
      }),
    );
    const data = unwrapPostalResponse<BriefFunnelResponse>(response);
    const ordered = Array.isArray(data?.orderedTracks) ? data.orderedTracks : [];
    const matches = ordered
      .filter((row) => row && row.id != null)
      .slice(0, limit)
      .map((row, index) => serializeBriefMatch(row, index + 1));

    return {
      matches,
      brief: {
        summary: data?.brief?.summary?.trim() || null,
        artist: data?.brief?.artist?.trim() || null,
        parsed: data?.briefParsed === true,
        ...(source ? { source } : {}),
        excerpt:
          brief.length > EXCERPT_CHARS ? `${brief.slice(0, EXCERPT_CHARS).trimEnd()}…` : brief,
        characters: brief.length,
        applied: {
          ...(bpmRange ? { bpmRange } : {}),
          ...(instrumental !== undefined ? { instrumental } : {}),
          fromBriefText: Boolean(
            (bpmRange && !parsed.data.bpmRange) || (instrumental !== undefined && parsed.data.instrumental === undefined),
          ),
        },
      },
      ...(typeof data?.candidatePoolSize === "number"
        ? { candidatePool: data.candidatePoolSize }
        : {}),
      historyId: typeof data?.historyId === "string" ? data.historyId : null,
    };
  } catch (error) {
    throw toPostalCapabilityError(error);
  }
}
