import { z } from "zod";

import { apiPost, buildPlaylistFormData } from "@/postal/client";

import { requireAuthenticatedPostalSession } from "../auth";
import {
  PostalCapabilityError,
  toPostalCapabilityError,
  unwrapPostalResponse,
} from "../errors";
import type { CreatePlaylistInput } from "../types";

const inputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
});

export async function createPlaylist(input: CreatePlaylistInput) {
  await requireAuthenticatedPostalSession();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PostalCapabilityError(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Invalid playlist input.",
    );
  }

  try {
    const response = await apiPost(
      "/pack/create",
      buildPlaylistFormData(parsed.data.name, parsed.data.description ?? ""),
    );
    const playlist = unwrapPostalResponse<{ id?: string; name?: string }>(response);
    if (!playlist?.id) {
      throw new PostalCapabilityError("API_ERROR", "Postal created no playlist record.");
    }
    return { playlistId: playlist.id, name: playlist.name ?? parsed.data.name };
  } catch (error) {
    throw toPostalCapabilityError(error);
  }
}
