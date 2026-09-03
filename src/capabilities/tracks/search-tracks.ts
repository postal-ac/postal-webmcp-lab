import { z } from "zod";

import { apiGet } from "@/postal/client";

import { requireAuthenticatedPostalSession } from "../auth";
import {
  PostalCapabilityError,
  toPostalCapabilityError,
  unwrapPostalResponse,
} from "../errors";
import type { AgentTrackDetail, SearchTracksInput } from "../types";
import { searchableTrackText, serializeAgentTrack } from "./track-serializer";

const inputSchema = z.object({
  query: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(50).default(20),
  createdAfter: z.string().datetime({ offset: true }).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
});

/**
 * Words that describe *how many* or *how recent*, not *which*. Agents relay
 * requests like "my latest 5 tracks" almost verbatim as the query; if
 * "latest" survived as a search term it would match nothing and the call
 * would come back empty. With every word filtered out, the search falls
 * through to newest-first — which is what those requests mean.
 */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "added",
  "find",
  "five",
  "for",
  "get",
  "give",
  "i",
  "in",
  "last",
  "latest",
  "list",
  "me",
  "most",
  "my",
  "new",
  "newest",
  "of",
  "please",
  "recent",
  "recently",
  "show",
  "ten",
  "the",
  "top",
  "track",
  "tracks",
  "upload",
  "uploaded",
  "uploads",
]);

function searchTerms(query?: string, tags?: string[]): string[] {
  const words = (query ?? "")
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}#&+.-]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
  return Array.from(new Set([...words, ...(tags ?? [])])).slice(0, 8);
}

function scoreTrack(track: AgentTrackDetail, terms: string[]): number {
  if (!terms.length) return 0;
  const haystack = searchableTrackText(track);
  return terms.reduce(
    (score, term) => score + (haystack.includes(term.toLocaleLowerCase()) ? 1 : 0),
    0,
  );
}

export async function searchTracks(input: SearchTracksInput = {}) {
  await requireAuthenticatedPostalSession();

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PostalCapabilityError(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Invalid track search input.",
    );
  }

  const { query, limit, createdAfter, tags } = parsed.data;
  const terms = searchTerms(query, tags);
  const fetchLimit = Math.min(Math.max(limit * 5, 50), 200);
  const requests = terms.length ? terms : [undefined];

  try {
    const responses = await Promise.all(
      requests.map((term) =>
        apiGet("/tracks/all", {
          ...(term ? { name: term } : {}),
          limit: String(fetchLimit),
          sort: "newest",
        }),
      ),
    );

    const rawTracks = responses.flatMap((response) => {
      const data = unwrapPostalResponse<{ items?: UnknownTrack[] }>(response);
      return Array.isArray(data?.items) ? data.items : [];
    });
    const uniqueTracks = Array.from(
      new Map(rawTracks.map((track) => [String(track.id), track])).values(),
    );
    const threshold = createdAfter ? new Date(createdAfter).getTime() : null;
    const ranked = uniqueTracks
      .map(serializeAgentTrack)
      .filter((track) => {
        if (!threshold) return true;
        const timestamp = track.createdAt ? new Date(track.createdAt).getTime() : 0;
        return timestamp >= threshold;
      })
      .map((track) => ({ track, score: scoreTrack(track, terms) }))
      .filter(({ score }) => !terms.length || score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          new Date(b.track.createdAt ?? 0).getTime() -
            new Date(a.track.createdAt ?? 0).getTime(),
      )
      .slice(0, limit)
      .map(({ track }) => track);

    return { tracks: ranked };
  } catch (error) {
    throw toPostalCapabilityError(error);
  }
}

type UnknownTrack = Record<string, unknown>;
