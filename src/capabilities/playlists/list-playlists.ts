import { z } from "zod";

import { apiGet } from "@/postal/client";

import { requireAuthenticatedPostalSession } from "../auth";
import {
  PostalCapabilityError,
  toPostalCapabilityError,
  unwrapPostalResponse,
} from "../errors";

const inputSchema = z.object({
  query: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export interface ListPlaylistsInput {
  query?: string;
  limit?: number;
}

type RawPack = Record<string, any>;

/**
 * How an agent rediscovers a playlist it no longer holds the id for — e.g.
 * one created in an earlier conversation. Read-only; the backend already
 * scopes `/pack` to the signed-in user.
 */
export async function listPlaylists(input: ListPlaylistsInput = {}) {
  await requireAuthenticatedPostalSession();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PostalCapabilityError(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Invalid playlist listing input.",
    );
  }
  const { query, limit } = parsed.data;

  try {
    // Fetch generously, filter locally: the endpoint has no name filter.
    const response = await apiGet("/pack", { limit: "100", sort: "newest" });
    const packs = unwrapPostalResponse<RawPack[]>(response);
    const rows = Array.isArray(packs) ? packs : [];
    const needle = query?.toLocaleLowerCase();

    const playlists = rows
      .filter((pack) =>
        needle ? String(pack.name ?? "").toLocaleLowerCase().includes(needle) : true,
      )
      .slice(0, limit)
      .map((pack) => ({
        playlistId: String(pack.id),
        name: String(pack.name ?? "Untitled playlist"),
        ...(pack.playlistType ? { playlistType: String(pack.playlistType) } : {}),
        trackCount: Array.isArray(pack.tracks) ? pack.tracks.length : 0,
        ...(pack.createdAt ? { createdAt: String(pack.createdAt) } : {}),
      }));

    return { playlists };
  } catch (error) {
    throw toPostalCapabilityError(error);
  }
}
