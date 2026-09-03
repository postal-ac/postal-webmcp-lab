import type { PostalWebMcpActivity } from "@/webmcp/types";

/**
 * The playlist an agent has been assembling on this page, reconstructed from
 * the tool-call activity stream. An outside agent talks to the tools, not to
 * the page's runner, so there is no workflow result to render — but every
 * successful create_playlist / add_tracks_to_playlist / create_share_link
 * call carries its result in the activity event, which is enough to rebuild
 * the deliverable and let the human play it back to validate it. Removals
 * (remove_tracks_from_playlist) are applied the same way, whether the agent
 * or the page's own dialog made them.
 */
export interface AgentPlaylist {
  playlistId: string;
  name?: string;
  trackIds: string[];
  shareUrl?: string;
}

export function deriveAgentPlaylist(
  activities: PostalWebMcpActivity[],
): AgentPlaylist | null {
  const playlists = new Map<string, AgentPlaylist>();
  let lastTouched: AgentPlaylist | null = null;

  const touch = (playlistId: string): AgentPlaylist => {
    let playlist = playlists.get(playlistId);
    if (!playlist) {
      playlist = { playlistId, trackIds: [] };
      playlists.set(playlistId, playlist);
    }
    lastTouched = playlist;
    return playlist;
  };

  for (const activity of activities) {
    if (activity.status !== "success" || !activity.result) continue;
    const result = activity.result as Record<string, unknown>;
    const playlistId = typeof result.playlistId === "string" ? result.playlistId : null;
    if (!playlistId) continue;

    if (
      activity.tool === "create_playlist" ||
      activity.tool === "add_tracks_to_playlist" ||
      activity.tool === "create_playlist_from_shortlist" ||
      activity.tool === "match_brief"
    ) {
      // create_playlist may fill the playlist in the same call, in which
      // case its result carries addedTrackIds just like add_tracks does; the
      // shortlist tool always does, whether it created or added.
      const playlist = touch(playlistId);
      if (activity.tool !== "add_tracks_to_playlist" && typeof result.name === "string") {
        playlist.name = result.name;
      }
      const added = Array.isArray(result.addedTrackIds) ? result.addedTrackIds : [];
      for (const id of added) {
        if (typeof id === "string" && !playlist.trackIds.includes(id)) {
          playlist.trackIds.push(id);
        }
      }
    } else if (activity.tool === "update_playlist") {
      const playlist = touch(playlistId);
      if (typeof result.name === "string") playlist.name = result.name;
    } else if (
      activity.tool === "reorder_playlist" ||
      activity.tool === "reorder_open_playlist"
    ) {
      // The result is the full order Postal accepted; anything this page
      // knew about that the caller left out keeps its place at the end.
      const playlist = touch(playlistId);
      const ordered = (Array.isArray(result.trackIds) ? result.trackIds : []).filter(
        (id): id is string => typeof id === "string",
      );
      const seen = new Set(ordered);
      playlist.trackIds = [...ordered, ...playlist.trackIds.filter((id) => !seen.has(id))];
    } else if (
      activity.tool === "remove_tracks_from_playlist" ||
      activity.tool === "remove_from_open_playlist" ||
      activity.tool === "remove_now_playing"
    ) {
      const playlist = touch(playlistId);
      const removed = new Set(
        (Array.isArray(result.removedTrackIds) ? result.removedTrackIds : []).filter(
          (id): id is string => typeof id === "string",
        ),
      );
      playlist.trackIds = playlist.trackIds.filter((id) => !removed.has(id));
    } else if (activity.tool === "delete_playlist") {
      // Gone from Postal, so gone from the page: no card, no picks, and
      // nothing for later calls to attach to.
      const deleted = playlists.get(playlistId);
      playlists.delete(playlistId);
      if (deleted && lastTouched === deleted) lastTouched = null;
    } else if (activity.tool === "create_share_link") {
      const playlist = touch(playlistId);
      if (typeof result.shareUrl === "string") playlist.shareUrl = result.shareUrl;
    }
  }

  return lastTouched;
}
