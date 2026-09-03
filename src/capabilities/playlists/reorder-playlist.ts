import { z } from "zod";

import { apiPatch } from "@/postal/client";

import { requireAuthenticatedPostalSession } from "../auth";
import {
  PostalCapabilityError,
  toPostalCapabilityError,
  unwrapPostalResponse,
} from "../errors";

const inputSchema = z.object({
  playlistId: z.string().trim().min(1).max(200),
  trackIds: z.array(z.string().trim().min(1).max(200)).min(1).max(500),
});

export interface ReorderPlaylistInput {
  playlistId: string;
  /** Every track in the playlist, in the desired order. */
  trackIds: string[];
}

/**
 * Set the playing order of a playlist. Postal takes the complete ordered id
 * list — the same call its own drag-to-reorder makes — so a caller sends
 * the whole sequence, not a move. Ownership is asserted server-side.
 */
export async function reorderPlaylist(input: ReorderPlaylistInput) {
  await requireAuthenticatedPostalSession();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PostalCapabilityError(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Invalid playlist order.",
    );
  }
  const trackIds = Array.from(new Set(parsed.data.trackIds));

  try {
    unwrapPostalResponse(
      await apiPatch(
        "/pack/reorder",
        JSON.stringify({ packId: parsed.data.playlistId, trackIds }),
      ),
    );
    return { playlistId: parsed.data.playlistId, trackIds };
  } catch (error) {
    throw toPostalCapabilityError(error, "PLAYLIST_NOT_FOUND");
  }
}
