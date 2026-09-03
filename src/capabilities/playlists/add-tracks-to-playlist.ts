import { z } from "zod";

import { apiGet, apiPost } from "@/postal/client";

import { requireAuthenticatedPostalSession } from "../auth";
import {
  PostalCapabilityError,
  toPostalCapabilityError,
  unwrapPostalResponse,
} from "../errors";
import type { AddTracksToPlaylistInput } from "../types";

const inputSchema = z.object({
  playlistId: z.string().trim().min(1).max(200),
  trackIds: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
});

export async function addTracksToPlaylist(input: AddTracksToPlaylistInput) {
  await requireAuthenticatedPostalSession();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PostalCapabilityError(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Invalid playlist track input.",
    );
  }
  const trackIds = Array.from(new Set(parsed.data.trackIds));

  try {
    unwrapPostalResponse(
      await apiPost(
        "/pack/add-tracks",
        JSON.stringify({ packId: parsed.data.playlistId, trackIds }),
      ),
    );

    // Read the playlist back so the tool reports Postal's own count rather
    // than assuming every requested ID landed.
    const playlistResponse = await apiGet("/pack/manage", {
      packId: parsed.data.playlistId,
    });
    if (playlistResponse?.statusCode === 206 || playlistResponse?.data?.requiresJoin) {
      throw new PostalCapabilityError(
        "ACCESS_DENIED",
        "The requested playlist is not writable by the current user.",
      );
    }
    const playlist = unwrapPostalResponse<{
      tracks?: unknown[];
      files?: unknown[];
      totalTracks?: number;
    }>(playlistResponse);
    const tracks = Array.isArray(playlist.tracks)
      ? playlist.tracks
      : Array.isArray(playlist.files)
        ? playlist.files
        : [];

    return {
      playlistId: parsed.data.playlistId,
      addedTrackIds: trackIds,
      trackCount: playlist.totalTracks ?? tracks.length,
    };
  } catch (error) {
    throw toPostalCapabilityError(error, "PLAYLIST_NOT_FOUND");
  }
}
