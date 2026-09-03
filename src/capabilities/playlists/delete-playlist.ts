import { z } from "zod";

import { apiDelete } from "@/postal/client";

import { requireAuthenticatedPostalSession } from "../auth";
import {
  PostalCapabilityError,
  toPostalCapabilityError,
  unwrapPostalResponse,
} from "../errors";

const inputSchema = z.object({
  playlistId: z.string().trim().min(1).max(200),
});

export interface DeletePlaylistInput {
  playlistId: string;
}

/**
 * Delete a playlist the signed-in user owns. The tracks stay in the library
 * — only the playlist, its order and its share link go. Ownership is
 * asserted server-side; the Lab's tool layer adds the human approval gate.
 */
export async function deletePlaylist(input: DeletePlaylistInput) {
  await requireAuthenticatedPostalSession();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PostalCapabilityError("INVALID_INPUT", "A playlistId is required.");
  }

  try {
    unwrapPostalResponse(
      await apiDelete("/pack/delete", JSON.stringify({ id: parsed.data.playlistId })),
    );
    return { playlistId: parsed.data.playlistId, deleted: true as const };
  } catch (error) {
    throw toPostalCapabilityError(error, "PLAYLIST_NOT_FOUND");
  }
}
