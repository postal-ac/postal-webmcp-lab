import { z } from "zod";

import { apiPost, PlaylistModeType } from "@/postal/client";

import { requireAuthenticatedPostalSession } from "../auth";
import {
  PostalCapabilityError,
  toPostalCapabilityError,
  unwrapPostalResponse,
} from "../errors";
import type { CreateShareLinkInput } from "../types";

const inputSchema = z.object({
  playlistId: z.string().trim().min(1).max(200),
});

/** Share links point at the real Postal app, not at the Lab. */
function postalAppOrigin(): string {
  return import.meta.env.VITE_POSTAL_APP_URL ?? "https://postal.music";
}

export async function createShareLink(input: CreateShareLinkInput) {
  await requireAuthenticatedPostalSession();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PostalCapabilityError("INVALID_INPUT", "A playlistId is required.");
  }

  try {
    const response = await apiPost(
      `/packs/${encodeURIComponent(parsed.data.playlistId)}/modes/${PlaylistModeType.PRIVATE}/link`,
    );
    const mode = unwrapPostalResponse<{ link?: string }>(response);
    if (!mode?.link) {
      throw new PostalCapabilityError(
        "API_ERROR",
        "Postal did not return a private playlist link.",
      );
    }

    const shareUrl = new URL(
      `/playlist/${encodeURIComponent(parsed.data.playlistId)}`,
      postalAppOrigin(),
    );
    shareUrl.searchParams.set("token", mode.link);
    return { playlistId: parsed.data.playlistId, shareUrl: shareUrl.toString() };
  } catch (error) {
    throw toPostalCapabilityError(error, "PLAYLIST_NOT_FOUND");
  }
}
