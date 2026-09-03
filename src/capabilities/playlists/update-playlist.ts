import { z } from "zod";

import { apiPatch } from "@/postal/client";

import { requireAuthenticatedPostalSession } from "../auth";
import {
  PostalCapabilityError,
  toPostalCapabilityError,
  unwrapPostalResponse,
} from "../errors";

const inputSchema = z
  .object({
    playlistId: z.string().trim().min(1).max(200),
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(2000).optional(),
  })
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: "Pass a name or a description to change.",
  });

export interface UpdatePlaylistInput {
  playlistId: string;
  name?: string;
  description?: string;
}

/**
 * Rename or re-describe a playlist. `PATCH /pack/update` is the multipart
 * endpoint Postal's own pack dialog uses; it applies only the fields sent,
 * so a rename leaves description, artwork and modes untouched. Ownership is
 * asserted server-side.
 */
export async function updatePlaylist(input: UpdatePlaylistInput) {
  await requireAuthenticatedPostalSession();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PostalCapabilityError(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Invalid playlist update.",
    );
  }
  const { playlistId, name, description } = parsed.data;

  const formData = new FormData();
  formData.append("packId", playlistId);
  if (name !== undefined) formData.append("name", name);
  if (description !== undefined) formData.append("description", description);

  try {
    const playlist = unwrapPostalResponse<{ id?: string; name?: string; description?: string }>(
      await apiPatch("/pack/update", formData),
    );
    return {
      playlistId,
      ...(name !== undefined ? { name: playlist?.name ?? name } : {}),
      ...(description !== undefined
        ? { description: playlist?.description ?? description }
        : {}),
    };
  } catch (error) {
    throw toPostalCapabilityError(error, "PLAYLIST_NOT_FOUND");
  }
}
