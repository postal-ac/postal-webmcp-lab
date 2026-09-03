import { PostalCapabilityError } from "@/capabilities/errors";
import { addTracksToPlaylist } from "@/capabilities/playlists/add-tracks-to-playlist";
import { createPlaylist } from "@/capabilities/playlists/create-playlist";
import { removeTracksFromPlaylist } from "@/capabilities/playlists/remove-tracks-from-playlist";
import { reorderPlaylist } from "@/capabilities/playlists/reorder-playlist";
import type { AgentTrackDetail } from "@/capabilities/types";
import {
  pageContext,
  subscribePageContext,
  type PageContext,
  type PageTrackRef,
} from "@/lab/page-context-store";
import {
  nowPlaying,
  pausePlayback,
  playTrack,
  subscribePlayback,
  type NowPlaying,
} from "@/lab/player-controller";
import { displayTitle } from "@/lab/playlist-card";
import { selectedTracks, subscribeSelection } from "@/lab/selection-store";
import { waveformFor } from "@/lab/waveform-cache";

import { DynamicToolRegistry } from "./dynamic-tools";
import { instrumentedExecute, objectSchema } from "./tool-runtime";
import type { WebMcpModelContext, WebMcpToolDefinition } from "./types";

/**
 * Tools whose existence and wording follow the screen.
 *
 * A server-side integration describes its tools once. A page can do better:
 * it knows what the person is looking at, so it can register
 * `remove_from_open_playlist` only while a playlist dialog is open, name the
 * playlist and its tracks in the description, and drop the tool the moment
 * the dialog closes. `get_selected_tracks` is always there, but its
 * description says "3 tracks selected right now: …", so an agent can decide
 * whether to call it without calling it. Every change goes through
 * `DynamicToolRegistry`, which aborts and re-registers so the browser fires
 * `toolchange` and agents re-read the list.
 */
const MAX_NAMED_TRACKS = 5;

function namedList(tracks: PageTrackRef[], max = MAX_NAMED_TRACKS): string {
  const names = tracks.slice(0, max).map((track) => `“${displayTitle(track.title)}”`);
  const rest = tracks.length - names.length;
  return rest > 0 ? `${names.join(", ")} and ${rest} more` : names.join(", ");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function describeSelection(selected: PageTrackRef[]): string {
  const base =
    "Read the tracks the user has ticked in the catalogue on this page — the shared workspace between the person and the agent. Use it for 'the ones I selected'.";
  if (!selected.length) return `${base} Nothing is selected right now.`;
  return `${base} Right now ${plural(selected.length, "track")} ${
    selected.length === 1 ? "is" : "are"
  } selected: ${namedList(selected)}. Returns them with ids.`;
}

export function describeOpenPlaylist(playlist: NonNullable<PageContext["playlist"]>): string {
  const name = playlist.name ? `“${playlist.name}”` : "an untitled playlist";
  const tracks = playlist.tracks.length
    ? `${plural(playlist.tracks.length, "track")}: ${namedList(playlist.tracks)}`
    : "no tracks yet";
  return `${name} (${tracks})${playlist.shareUrl ? ", already shared" : ""}`;
}

export function describeShortlist(shortlist: NonNullable<PageContext["shortlist"]>): string {
  const origin = shortlist.source ? ` from ${shortlist.source}` : "";
  const kept =
    shortlist.kept.length === shortlist.total
      ? `all ${plural(shortlist.total, "pick")} kept`
      : `${shortlist.kept.length} of ${plural(shortlist.total, "pick")} kept after the user's unticks`;
  return `the brief shortlist${origin} on screen (${kept}${
    shortlist.kept.length ? `: ${namedList(shortlist.kept)}` : ""
  })`;
}

function toRef(track: AgentTrackDetail): PageTrackRef {
  return { id: track.id, title: track.title };
}

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

/** The tool set that matches the given page state. Pure, so it is testable. */
export function buildContextualTools(
  selected: PageTrackRef[],
  context: PageContext,
  playing: Pick<NowPlaying, "id" | "title"> | null = null,
): WebMcpToolDefinition[] {
  const tools: WebMcpToolDefinition[] = [
    {
      name: "get_selected_tracks",
      title: "Read the user's selection",
      description: describeSelection(selected),
      inputSchema: objectSchema({}),
      annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false },
      execute: instrumentedExecute(
        "get_selected_tracks",
        async () => ({ tracks: selectedTracks() }),
        (result) => `${(result.tracks as unknown[]).length} tracks selected`,
      ),
    },
  ];

  const playlist = context.playlist;
  if (playlist?.open) {
    const shown = describeOpenPlaylist(playlist);
    tools.push(
      {
        name: "remove_from_open_playlist",
        title: "Remove tracks from the playlist on screen",
        description: `Remove tracks from the playlist the user has open in the dialog right now: ${shown}. No playlistId needed — this tool exists only while that dialog is open. Pass track ids; the tracks stay in the library. Reversible.`,
        inputSchema: objectSchema(
          {
            trackIds: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: { type: "string" },
              description: "Ids of tracks currently in the open playlist.",
            },
          },
          ["trackIds"],
        ),
        annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
        execute: instrumentedExecute(
          "remove_from_open_playlist",
          async (input: { trackIds?: string[] }) => {
            const open = requireOpenPlaylist();
            return removeTracksFromPlaylist({
              playlistId: open.playlistId,
              trackIds: (input?.trackIds ?? []) as string[],
            });
          },
          (result) =>
            `Removed ${plural((result.removedTrackIds as unknown[]).length, "track")} from the open playlist`,
        ),
      },
      {
        name: "reorder_open_playlist",
        title: "Reorder the playlist on screen",
        description: `Set the playing order of the playlist the user has open in the dialog right now: ${shown}. Pass every track id in the desired order — the list replaces the whole sequence. No playlistId needed; this tool exists only while that dialog is open. Reversible.`,
        inputSchema: objectSchema(
          {
            trackIds: {
              type: "array",
              minItems: 1,
              maxItems: 500,
              items: { type: "string" },
              description: "All track ids in the open playlist, first to last.",
            },
          },
          ["trackIds"],
        ),
        annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
        execute: instrumentedExecute(
          "reorder_open_playlist",
          async (input: { trackIds?: string[] }) => {
            const open = requireOpenPlaylist();
            return reorderPlaylist({
              playlistId: open.playlistId,
              trackIds: (input?.trackIds ?? []) as string[],
            });
          },
          (result) => `Reordered ${plural((result.trackIds as unknown[]).length, "track")}`,
        ),
      },
    );
  }

  const shortlist = context.shortlist;
  if (shortlist) {
    const target = context.playlist
      ? `Adds them to the page's current playlist ${describeOpenPlaylist(context.playlist)}.`
      : "Creates a new private playlist for them.";
    tools.push({
      name: "create_playlist_from_shortlist",
      title: "Turn the brief shortlist on screen into a playlist",
      description: `Use ${describeShortlist(shortlist)}. Only the picks the user kept are used — the agent cannot see unticks any other way. ${target} Exists only while the shortlist is on screen. Returns the playlistId for create_share_link.`,
      inputSchema: objectSchema({
        name: {
          type: "string",
          minLength: 2,
          maxLength: 120,
          description: "Playlist name when creating a new one. Defaults to a name derived from the brief.",
        },
      }),
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
      execute: instrumentedExecute(
        "create_playlist_from_shortlist",
        async (input: { name?: string }) => {
          const current = pageContext().shortlist;
          if (!current) {
            throw new PostalCapabilityError(
              "INVALID_INPUT",
              "The brief shortlist is no longer on screen. Run match_brief again.",
            );
          }
          const keptTrackIds = current.kept.map((track) => track.id);
          if (!keptTrackIds.length) {
            throw new PostalCapabilityError(
              "INVALID_INPUT",
              "The user has unticked every pick — nothing to add.",
            );
          }
          const existing = pageContext().playlist;
          if (existing) {
            const added = await addTracksToPlaylist({
              playlistId: existing.playlistId,
              trackIds: keptTrackIds,
            });
            return {
              action: "added" as const,
              playlistId: existing.playlistId,
              ...(existing.name ? { name: existing.name } : {}),
              addedTrackIds: added.addedTrackIds,
              trackCount: added.trackCount,
              keptTrackIds,
            };
          }
          const name = input?.name?.trim() || defaultShortlistName(current);
          const playlist = await createPlaylist({
            name,
            description: current.summary ?? undefined,
          });
          const added = await addTracksToPlaylist({
            playlistId: playlist.playlistId,
            trackIds: keptTrackIds,
          });
          return {
            action: "created" as const,
            ...playlist,
            addedTrackIds: added.addedTrackIds,
            trackCount: added.trackCount,
            keptTrackIds,
          };
        },
        (result) =>
          result.action === "added"
            ? `Added ${plural((result.addedTrackIds as unknown[]).length, "kept pick")} to “${String(result.name ?? "the playlist")}”`
            : `Created “${String(result.name)}” from ${plural((result.addedTrackIds as unknown[]).length, "kept pick")}`,
      ),
    });
  }

  // What the user is hearing is context an agent can get from nowhere else.
  // The tool exists only while audio plays; its description names the track
  // (not the position — that would re-register every second) and the result
  // carries the live position.
  if (playing) {
    const title = `“${displayTitle(playing.title)}”`;
    tools.push({
      name: "get_now_playing",
      title: "What the user is listening to",
      description: `The page is playing ${title} through the user's speakers right now. Returns that track's id, title, current position, and the sections and highlights of the track (intro, drop, hook, first vocal…) with their times — resolve 'this one', 'the one playing', 'skip this', 'play me the drop' (then control_playback seek) with it. Exists only while something is playing.`,
      inputSchema: objectSchema({}),
      annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false },
      execute: instrumentedExecute(
        "get_now_playing",
        async () => {
          const current = nowPlaying();
          if (!current) {
            throw new PostalCapabilityError("INVALID_INPUT", "Nothing is playing any more.");
          }
          const playlist = pageContext().playlist;
          const waveform = await waveformFor(current.id);
          const sectionNow = waveform?.sections.find(
            (section) => current.positionSec >= section.startSec && current.positionSec < section.endSec,
          );
          return {
            track: current,
            position: `${clock(current.positionSec)}${
              current.durationSec ? ` of ${clock(current.durationSec)}` : ""
            }`,
            ...(sectionNow ? { currentSection: sectionNow.label } : {}),
            sections: waveform?.sections ?? [],
            highlights: waveform?.highlights ?? [],
            inCurrentPlaylist: Boolean(
              playlist?.tracks.some((track) => track.id === current.id),
            ),
          };
        },
        (result) => `Playing “${displayTitle(String((result.track as NowPlaying).title))}” at ${String(result.position)}`,
      ),
    });

    const playlist = context.playlist;
    const member = playlist?.tracks.find((track) => track.id === playing.id);
    if (playlist && member) {
      const name = playlist.name ? `“${playlist.name}”` : "the current playlist";
      tools.push({
        name: "remove_now_playing",
        title: "Drop the track that is playing from the playlist",
        description: `Remove ${title} — the track playing right now — from ${name}, then move on to the next track in the playlist so the user keeps listening. For 'not this one', 'skip it', 'drop this'. No ids needed. Exists only while a track from the current playlist is playing. The track stays in the library; reversible with add_tracks_to_playlist.`,
        inputSchema: objectSchema({}),
        annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
        execute: instrumentedExecute(
          "remove_now_playing",
          async () => {
            const current = nowPlaying();
            const live = pageContext().playlist;
            const index = live?.tracks.findIndex((track) => track.id === current?.id) ?? -1;
            if (!current || !live || index === -1) {
              throw new PostalCapabilityError(
                "INVALID_INPUT",
                "The track that was playing is no longer part of the current playlist. Use remove_tracks_from_playlist with ids instead.",
              );
            }
            const removed = await removeTracksFromPlaylist({
              playlistId: live.playlistId,
              trackIds: [current.id],
            });
            // Keep the listening session going: the next playable track, if
            // any, starts; otherwise the player stops cleanly.
            const next = live.tracks.slice(index + 1).find((track) => track.playbackUrl);
            let nowPlayingAfter: { id: string; title: string } | null = null;
            if (next?.playbackUrl) {
              try {
                await playTrack({ id: next.id, title: next.title, playbackUrl: next.playbackUrl });
                nowPlayingAfter = { id: next.id, title: next.title };
              } catch {
                pausePlayback();
              }
            } else {
              pausePlayback();
            }
            return {
              ...removed,
              removedTrack: { id: current.id, title: current.title },
              nowPlaying: nowPlayingAfter,
            };
          },
          (result) => {
            const removed = result.removedTrack as { title: string };
            const next = result.nowPlaying as { title: string } | null;
            return next
              ? `Dropped “${displayTitle(removed.title)}”, now playing “${displayTitle(next.title)}”`
              : `Dropped “${displayTitle(removed.title)}”`;
          },
        ),
      });
    }
  }

  return tools;
}

function defaultShortlistName(shortlist: NonNullable<PageContext["shortlist"]>): string {
  const source = shortlist.source?.replace(/\.pdf$/i, "").trim();
  if (source) return `Pitch · ${source}`.slice(0, 120);
  if (shortlist.summary) return `Pitch · ${shortlist.summary}`.slice(0, 120);
  return "Pitch shortlist";
}

function requireOpenPlaylist() {
  const playlist = pageContext().playlist;
  if (!playlist?.open) {
    throw new PostalCapabilityError(
      "INVALID_INPUT",
      "No playlist is open on the page any more. Use remove_tracks_from_playlist / reorder_playlist with a playlistId instead.",
    );
  }
  return playlist;
}

let currentDefinitions: WebMcpToolDefinition[] = buildContextualTools([], pageContext(), null);

/** The contextual tools as they stand — for the page's own `executePostalTool`. */
export function contextualToolDefinitions(): WebMcpToolDefinition[] {
  return currentDefinitions;
}

type NamesListener = (names: string[]) => void;
const nameListeners = new Set<NamesListener>();
let registeredNames: string[] = [];

/** Which contextual tools the browser currently has, for the tool status UI. */
export function subscribeContextualTools(listener: NamesListener): () => void {
  nameListeners.add(listener);
  listener(registeredNames);
  return () => nameListeners.delete(listener);
}

/**
 * Start mirroring the page into the browser's tool list. Returns a cleanup
 * that aborts every contextual registration.
 */
export function installContextualTools(
  modelContext: WebMcpModelContext | undefined = document.modelContext,
): () => void {
  if (!modelContext?.registerTool) return () => {};
  const registry = new DynamicToolRegistry(modelContext);
  const unsubscribeRegistry = registry.subscribe(({ names }) => {
    registeredNames = names;
    for (const listener of nameListeners) listener(names);
  });

  let selected: PageTrackRef[] = selectedTracks().map(toRef);
  let context: PageContext = pageContext();
  let playing: Pick<NowPlaying, "id" | "title"> | null = null;
  const sync = () => {
    currentDefinitions = buildContextualTools(selected, context, playing);
    void registry.sync(currentDefinitions);
  };

  const unsubscribeSelection = subscribeSelection((tracks) => {
    selected = tracks.map(toRef);
    sync();
  });
  const unsubscribeContext = subscribePageContext((next) => {
    context = next;
    sync();
  });
  // Track identity only: the position lives in the result, not the
  // description, so playback progress does not churn registrations.
  const unsubscribePlayback = subscribePlayback((playingId) => {
    const current = playingId ? nowPlaying() : null;
    playing = current ? { id: current.id, title: current.title } : null;
    sync();
  });

  return () => {
    unsubscribeSelection();
    unsubscribeContext();
    unsubscribePlayback();
    unsubscribeRegistry();
    registry.dispose();
    registeredNames = [];
    for (const listener of nameListeners) listener([]);
  };
}
