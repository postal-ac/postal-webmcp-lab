import { z } from "zod";

import { apiGet, apiPost } from "@/postal/client";

import { requireAuthenticatedPostalSession } from "../auth";
import {
  PostalCapabilityError,
  toPostalCapabilityError,
  unwrapPostalResponse,
} from "../errors";

const inputSchema = z.object({
  playlistId: z.string().trim().min(1).max(200),
  trackIds: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
});

export interface RemoveTracksFromPlaylistInput {
  playlistId: string;
  trackIds: string[];
}

/**
 * The inverse of add_tracks_to_playlist. Postal's endpoint takes one track
 * at a time, so the calls run sequentially — order matters to the backend's
 * position bookkeeping — and the playlist is read back afterwards so the
 * reported count is Postal's, not an assumption.
 */
export async function removeTracksFromPlaylist(input: RemoveTracksFromPlaylistInput) {
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
    for (const trackId of trackIds) {
      unwrapPostalResponse(
        await apiPost(
          "/pack/remove-track",
          JSON.stringify({ packId: parsed.data.playlistId, trackId }),
        ),
      );
    }

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
      removedTrackIds: trackIds,
      trackCount: playlist.totalTracks ?? tracks.length,
    };
  } catch (error) {
    throw toPostalCapabilityError(error, "PLAYLIST_NOT_FOUND");
  }
}
