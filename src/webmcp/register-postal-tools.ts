import { matchBrief } from "@/capabilities/briefs/match-brief";
import { addTracksToPlaylist } from "@/capabilities/playlists/add-tracks-to-playlist";
import { createPlaylist } from "@/capabilities/playlists/create-playlist";
import { deletePlaylist } from "@/capabilities/playlists/delete-playlist";
import { listPlaylists } from "@/capabilities/playlists/list-playlists";
import { removeTracksFromPlaylist } from "@/capabilities/playlists/remove-tracks-from-playlist";
import { reorderPlaylist } from "@/capabilities/playlists/reorder-playlist";
import { updatePlaylist } from "@/capabilities/playlists/update-playlist";
import { createShareLink } from "@/capabilities/sharing/create-share-link";
import { getTrack } from "@/capabilities/tracks/get-track";
import { nowPlaying, pausePlayback, playTrack, seekTo } from "@/lab/player-controller";
import { waveformFor } from "@/lab/waveform-cache";
import { neighboursOf, playNext, playPrevious } from "@/lab/play-queue";
import { pageContext } from "@/lab/page-context-store";
import { findSectionPosition } from "@/capabilities/tracks/get-waveform";
import { getBrief } from "@/lab/brief-store";
import { readLabSettings } from "@/lab/settings-store";
import { requestApproval } from "./approval";
import { contextualToolDefinitions } from "./contextual-tools";
import { searchTracks } from "@/capabilities/tracks/search-tracks";
import { PostalCapabilityError } from "@/capabilities/errors";
import { executeDefinitionAsPage, instrumentedExecute, objectSchema } from "./tool-runtime";

import {
  POSTAL_WEBMCP_TOOL_NAMES,
  type PostalWebMcpToolName,
  type WebMcpModelContext,
  type WebMcpToolDefinition,
} from "./types";

export type PostalWebMcpRegistrationStatus =
  | "disabled"
  | "unsupported"
  | "registered"
  | "partial"
  | "failed";

export interface PostalWebMcpRegistration {
  status: PostalWebMcpRegistrationStatus;
  registeredTools: PostalWebMcpToolName[];
  errors: string[];
  cleanup: () => void;
}

interface SharedRegistration {
  modelContext: WebMcpModelContext;
  controller: AbortController;
  refs: number;
  promise: Promise<{
    registeredTools: PostalWebMcpToolName[];
    errors: string[];
  }>;
}

let sharedRegistration: SharedRegistration | null = null;

// The Lab is the whole app here, so tools are on unless explicitly disabled.
export function isPostalWebMcpEnabled(): boolean {
  return import.meta.env.VITE_WEBMCP_ENABLED !== "false";
}

/**
 * Tools registered once at mount. `get_selected_tracks` is missing from this
 * list on purpose: it lives in the contextual layer (see contextual-tools.ts)
 * so its description can name what is selected right now.
 */
export const STATIC_TOOL_NAMES = POSTAL_WEBMCP_TOOL_NAMES.filter(
  (name) => name !== "get_selected_tracks",
);

function clockLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function postalToolDefinitions(): WebMcpToolDefinition[] {
  return [
    {
      name: "search_tracks",
      title: "Search Postal tracks",
      description:
        "Search the signed-in user's Postal music library by title, artist, genre, tags and other existing metadata. Omit query to get the most recent uploads, newest first — 'my latest 5 tracks' is search_tracks with no query and limit 5. Also the way to resolve a track title to its track id: search for the title, then use the id from the matching result.",
      inputSchema: objectSchema({
        query: { type: "string", description: "Words describing the desired tracks." },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        createdAfter: {
          type: "string",
          format: "date-time",
          description: "Only return tracks created after this ISO-8601 timestamp.",
        },
        tags: {
          type: "array",
          maxItems: 20,
          items: { type: "string" },
          description: "Postal tag or genre names to match.",
        },
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
      execute: instrumentedExecute(
        "search_tracks",
        searchTracks,
        (result) => `${(result.tracks as unknown[]).length} tracks found`,
      ),
    },
    {
      name: "get_track",
      title: "Get a Postal track",
      description:
        "Get structured metadata for one track accessible to the signed-in Postal user.",
      inputSchema: objectSchema(
        { trackId: { type: "string", description: "Postal track ID." } },
        ["trackId"],
      ),
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
      execute: instrumentedExecute(
        "get_track",
        getTrack,
        (result) => `Retrieved \"${String(result.title)}\"`,
      ),
    },
    {
      name: "list_playlists",
      title: "List Postal playlists",
      description:
        "List playlists owned by the signed-in Postal user, newest first, optionally filtered by name. Use this to rediscover the playlistId of an existing playlist — for example one created in an earlier conversation.",
      inputSchema: objectSchema({
        query: {
          type: "string",
          description: "Case-insensitive name filter.",
        },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
      execute: instrumentedExecute(
        "list_playlists",
        listPlaylists,
        (result) => `${(result.playlists as unknown[]).length} playlists found`,
      ),
    },
    {
      name: "get_brief",
      title: "Read the brief dropped on this page",
      description:
        "Read the text of the PDF brief the user dropped onto this page, if any. Use this when the user says things like 'handle the brief on the page'. Returns hasBrief:false when nothing has been dropped.",
      inputSchema: objectSchema({}),
      annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false },
      execute: instrumentedExecute(
        "get_brief",
        async () => {
          const brief = getBrief();
          return brief
            ? { hasBrief: true, ...brief }
            : { hasBrief: false as const };
        },
        (result) =>
          result.hasBrief
            ? `Read “${String(result.fileName)}”`
            : "No brief on the page",
      ),
    },
    {
      name: "match_brief",
      title: "Match a brief against the catalogue",
      description:
        "Find the tracks in the signed-in user's Postal library that best fit a music brief, ranked, each with a one-sentence reason. Pass the brief's full text wherever it lives — an email, a Disco or Notion page, a document in another tab — as `brief`; omit `brief` to use the PDF the user dropped on this page. Postal parses the prose (mood, energy, vocals, BPM, reference artists) and ranks by audio analysis, not by text search. Hard filters the brief states (a BPM range, 'instrumental only') are read from the text and enforced; pass bpmRange / instrumental yourself to be explicit or to override. PREFERRED FLOW: pass playlistName so the matches land in a new playlist in this same call — the page opens it with a player, the user auditions there, and you refine it with remove_now_playing / remove_tracks_from_playlist / add_tracks_to_playlist while listening. Then control_playback {action:'play', playlistId} plays it from the top. Metered: one Postal credit per call, so run it once per brief and refine the playlist rather than re-running.",
      inputSchema: objectSchema({
        brief: {
          type: "string",
          minLength: 20,
          maxLength: 20000,
          description:
            "The brief text itself, verbatim. Omit to use the brief dropped on this page.",
        },
        source: {
          type: "string",
          maxLength: 120,
          description:
            "Where the brief came from, shown to the user — e.g. 'Gmail: Netflix sync request'.",
        },
        limit: { type: "integer", minimum: 1, maximum: 25, default: 8 },
        excludeTrackIds: {
          type: "array",
          maxItems: 100,
          items: { type: "string" },
          description: "Track ids to leave out — e.g. picks the user has already rejected.",
        },
        bpmRange: {
          type: "array",
          minItems: 2,
          maxItems: 2,
          items: { type: "integer", minimum: 20, maximum: 300 },
          description: "Hard tempo filter [min, max]. Inferred from the brief when omitted.",
        },
        instrumental: {
          type: "boolean",
          description: "true = no vocals. Inferred from the brief when omitted.",
        },
        playlistName: {
          type: "string",
          minLength: 2,
          maxLength: 120,
          description:
            "Create a private playlist with this name from the matches, in the same call. Returns playlistId.",
        },
      }),
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
      execute: instrumentedExecute(
        "match_brief",
        async (input: {
          brief?: string;
          source?: string;
          limit?: number;
          excludeTrackIds?: string[];
          bpmRange?: [number, number];
          instrumental?: boolean;
          playlistName?: string;
        }) => {
          // The brief dropped on the page is the fallback, so "pitch the
          // brief on this page" is one call, not get_brief + match_brief.
          const pageBrief = input?.brief ? null : getBrief();
          if (!input?.brief && !pageBrief) {
            throw new PostalCapabilityError(
              "INVALID_INPUT",
              "No brief given and none dropped on this page. Pass the brief's text as `brief`.",
            );
          }
          const { playlistName, ...matchInput } = input ?? {};
          const matched = await matchBrief({
            ...matchInput,
            brief: input?.brief ?? pageBrief!.text,
            source: input?.source ?? (pageBrief ? pageBrief.fileName : undefined),
          });
          if (!playlistName?.trim()) return matched;
          // Playlist-first: the matches become a playlist right away, so the
          // dialog and the player are the workspace and the agent refines
          // by adding and removing while the user listens.
          const playlist = await createPlaylist({
            name: playlistName.trim(),
            description: matched.brief.summary ?? matched.brief.excerpt,
          });
          const trackIds = matched.matches.map((pick) => pick.id);
          const added = trackIds.length
            ? await addTracksToPlaylist({ playlistId: playlist.playlistId, trackIds })
            : { addedTrackIds: [] as string[], trackCount: 0 };
          return {
            ...matched,
            playlistId: playlist.playlistId,
            name: playlist.name,
            addedTrackIds: added.addedTrackIds,
            trackCount: added.trackCount,
          };
        },
        (result) => {
          const count = (result.matches as unknown[]).length;
          const base = `${count} match${count === 1 ? "" : "es"} for the brief`;
          return typeof result.playlistId === "string"
            ? `${base} → playlist “${String(result.name)}”`
            : base;
        },
      ),
    },
    {
      name: "control_playback",
      title: "Play, pause or seek audio on this page",
      description:
        "Drive the page's player (audible to the user). action 'play' starts a track (trackId from search results, matches or the selection), or a whole playlist from the top (playlistId — the page then auto-advances through it, so 'play me the top three' is one call after match_brief with playlistName) — pass positionSec or section to start at a point. 'pause' stops. 'seek' jumps within the track that is playing: give positionSec, or a section name such as 'drop', 'hook', 'chorus', 'first vocal', 'intro' — resolved against Postal's analysis markers for that track (get_now_playing lists them). 'next' and 'previous' move through the list the playing track belongs to: the playlist being built, else the brief shortlist, else the catalogue order.",
      inputSchema: objectSchema(
        {
          action: { type: "string", enum: ["play", "pause", "seek", "next", "previous"] },
          trackId: {
            type: "string",
            description: "For play: the track to start.",
          },
          playlistId: {
            type: "string",
            description: "For play: start this playlist from its first playable track instead of a single track.",
          },
          positionSec: {
            type: "number",
            minimum: 0,
            description: "Seconds into the track to start or jump to.",
          },
          section: {
            type: "string",
            maxLength: 60,
            description: "A section or highlight to jump to, e.g. 'drop', 'hook', 'chorus', 'first vocal'.",
          },
        },
        ["action"],
      ),
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
      execute: instrumentedExecute(
        "control_playback",
        async (input: {
          action?: string;
          trackId?: string;
          playlistId?: string;
          positionSec?: number;
          section?: string;
        }) => {
          if (input?.action === "pause") {
            const { wasPlaying } = pausePlayback();
            return { action: "pause", wasPlaying };
          }

          if (input?.action === "next" || input?.action === "previous") {
            const current = nowPlaying();
            const { source, next, previous } = neighboursOf(current?.id ?? null);
            const target = input.action === "next" ? next : previous;
            if (!current) {
              throw new PostalCapabilityError("INVALID_INPUT", "Nothing is playing; start a track with action 'play' first.");
            }
            if (!target) {
              throw new PostalCapabilityError(
                "INVALID_INPUT",
                source
                  ? `“${current.title}” is the ${input.action === "next" ? "last" : "first"} playable track in the ${source}.`
                  : "The playing track is not in any list on the page, so there is no next or previous.",
              );
            }
            const played = input.action === "next" ? await playNext() : await playPrevious();
            return {
              action: input.action,
              trackId: played?.id ?? target.id,
              title: played?.title ?? target.title,
              source,
            };
          }

          const resolveTarget = async (trackId: string) => {
            if (typeof input?.positionSec === "number") {
              return { positionSec: Math.max(0, input.positionSec), label: null as string | null };
            }
            if (input?.section) {
              const waveform = await waveformFor(trackId);
              const found = waveform ? findSectionPosition(waveform, input.section) : null;
              if (!found) {
                throw new PostalCapabilityError(
                  "INVALID_INPUT",
                  waveform?.sections.length || waveform?.highlights.length
                    ? `No section called “${input.section}” on this track. Available: ${[
                        ...waveform!.highlights.map((item) => item.label),
                        ...waveform!.sections.map((item) => item.label),
                      ].join(", ")}.`
                    : "This track has no section markers yet; pass positionSec instead.",
                );
              }
              return { positionSec: found.atSec, label: found.label };
            }
            return null;
          };

          if (input?.action === "seek") {
            const current = nowPlaying();
            if (!current) {
              throw new PostalCapabilityError("INVALID_INPUT", "Nothing is playing to seek within.");
            }
            const target = await resolveTarget(current.id);
            if (!target) {
              throw new PostalCapabilityError(
                "INVALID_INPUT",
                "Seeking needs positionSec or a section name.",
              );
            }
            const progress = seekTo(target.positionSec);
            return {
              action: "seek",
              trackId: current.id,
              title: current.title,
              positionSec: Math.round(progress.positionSec),
              ...(target.label ? { section: target.label } : {}),
            };
          }

          let startId = input?.trackId;
          if (!startId && input?.playlistId) {
            const page = pageContext().playlist;
            if (!page || page.playlistId !== input.playlistId) {
              throw new PostalCapabilityError(
                "INVALID_INPUT",
                "That playlist is not the one on this page. Play a trackId from it instead.",
              );
            }
            startId = page.tracks.find((track) => track.playbackUrl)?.id ?? page.tracks[0]?.id;
            if (!startId) {
              throw new PostalCapabilityError("INVALID_INPUT", "That playlist has no playable tracks yet.");
            }
          }
          if (!startId) {
            throw new PostalCapabilityError(
              "INVALID_INPUT",
              "Playing requires a trackId or a playlistId.",
            );
          }
          const track = await getTrack({ trackId: startId });
          await playTrack(track);
          const target = await resolveTarget(track.id);
          if (target) seekTo(target.positionSec);
          const queue = neighboursOf(track.id);
          return {
            action: "play",
            trackId: track.id,
            title: track.title,
            ...(input?.playlistId ? { playlistId: input.playlistId, autoAdvances: Boolean(queue.next) } : {}),
            ...(queue.position ? { queue: { source: queue.source, ...queue.position } } : {}),
            ...(target ? { positionSec: target.positionSec } : {}),
            ...(target?.label ? { section: target.label } : {}),
          };
        },
        (result) =>
          result.action === "pause"
            ? "Playback paused"
            : result.action === "next" || result.action === "previous"
              ? `${result.action === "next" ? "Next" : "Previous"}: “${String(result.title)}”`
            : result.action === "seek"
              ? `Jumped to ${result.section ? `${String(result.section).toLocaleLowerCase()} ` : ""}${clockLabel(Number(result.positionSec))} in “${String(result.title)}”`
              : `Playing “${String(result.title)}”${
                  result.section ? ` from the ${String(result.section).toLocaleLowerCase()}` : ""
                }`,
      ),
    },
    {
      name: "create_playlist",
      title: "Create a Postal playlist",
      description:
        "Create a private playlist owned by the signed-in Postal user. Pass trackIds (from search_tracks) to fill it in the same call; otherwise use add_tracks_to_playlist afterwards. Returns the playlistId that add_tracks_to_playlist and create_share_link take. This is a reversible write.",
      inputSchema: objectSchema(
        {
          name: { type: "string", minLength: 2, maxLength: 120 },
          description: { type: "string", maxLength: 2000 },
          trackIds: {
            type: "array",
            maxItems: 100,
            items: { type: "string" },
            description: "Optional track ids to add right away, in order.",
          },
        },
        ["name"],
      ),
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
      execute: instrumentedExecute(
        "create_playlist",
        async (input: { name?: string; description?: string; trackIds?: unknown }) => {
          // One call instead of two for the common "make me a playlist of
          // these" — each round trip through an agent costs seconds.
          const { trackIds, ...playlistInput } = input ?? {};
          const playlist = await createPlaylist(playlistInput as { name: string });
          if (!Array.isArray(trackIds) || trackIds.length === 0) return playlist;
          const added = await addTracksToPlaylist({
            playlistId: playlist.playlistId,
            trackIds: trackIds as string[],
          });
          return {
            ...playlist,
            addedTrackIds: added.addedTrackIds,
            trackCount: added.trackCount,
          };
        },
        (result) =>
          Array.isArray(result.addedTrackIds)
            ? `Created “${String(result.name)}” with ${result.addedTrackIds.length} tracks`
            : `Created “${String(result.name)}”`,
      ),
    },
    {
      name: "update_playlist",
      title: "Rename or describe a Postal playlist",
      description:
        "Change the name and/or description of a playlist owned by the signed-in user. Pass only the fields to change. Reversible.",
      inputSchema: objectSchema(
        {
          playlistId: { type: "string" },
          name: { type: "string", minLength: 2, maxLength: 120 },
          description: { type: "string", maxLength: 2000 },
        },
        ["playlistId"],
      ),
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
      execute: instrumentedExecute(
        "update_playlist",
        updatePlaylist,
        (result) =>
          typeof result.name === "string"
            ? `Renamed playlist to “${result.name}”`
            : "Updated playlist",
      ),
    },
    {
      name: "add_tracks_to_playlist",
      title: "Add tracks to a Postal playlist",
      description:
        "Add any chosen tracks to a playlist writable by the signed-in user — pass track ids (from search_tracks or get_track results), not titles. Works for arbitrary custom selections; invalid or inaccessible ids fail cleanly.",
      inputSchema: objectSchema(
        {
          playlistId: { type: "string" },
          trackIds: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            items: { type: "string" },
          },
        },
        ["playlistId", "trackIds"],
      ),
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
      execute: instrumentedExecute(
        "add_tracks_to_playlist",
        addTracksToPlaylist,
        (result) =>
          `Added ${(result.addedTrackIds as unknown[]).length} tracks (${String(result.trackCount)} total)`,
      ),
    },
    {
      name: "remove_tracks_from_playlist",
      title: "Remove tracks from a Postal playlist",
      description:
        "Remove tracks from a playlist writable by the signed-in user — pass track ids, not titles. The tracks stay in the library; only the playlist membership changes, so this is reversible with add_tracks_to_playlist.",
      inputSchema: objectSchema(
        {
          playlistId: { type: "string" },
          trackIds: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            items: { type: "string" },
          },
        },
        ["playlistId", "trackIds"],
      ),
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
      execute: instrumentedExecute(
        "remove_tracks_from_playlist",
        removeTracksFromPlaylist,
        (result) =>
          `Removed ${(result.removedTrackIds as unknown[]).length} track${
            (result.removedTrackIds as unknown[]).length === 1 ? "" : "s"
          } (${String(result.trackCount)} left)`,
      ),
    },
    {
      name: "reorder_playlist",
      title: "Reorder a Postal playlist",
      description:
        "Set the playing order of a playlist owned by the signed-in user. Pass every track id in the playlist, in the desired order — this replaces the whole sequence. Reversible.",
      inputSchema: objectSchema(
        {
          playlistId: { type: "string" },
          trackIds: {
            type: "array",
            minItems: 1,
            maxItems: 500,
            items: { type: "string" },
            description: "All track ids in the playlist, first to last.",
          },
        },
        ["playlistId", "trackIds"],
      ),
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
      execute: instrumentedExecute(
        "reorder_playlist",
        reorderPlaylist,
        (result) => `Reordered ${(result.trackIds as unknown[]).length} tracks`,
      ),
    },
    {
      name: "delete_playlist",
      title: "Delete a Postal playlist",
      description:
        "Delete a playlist owned by the signed-in user. The tracks stay in the library; the playlist, its order and its share link are gone for good. The page asks the user to approve every agent call.",
      inputSchema: objectSchema(
        { playlistId: { type: "string", description: "Postal playlist ID." } },
        ["playlistId"],
      ),
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true },
      execute: instrumentedExecute(
        "delete_playlist",
        async (input: { playlistId?: string }, { via }) => {
          // Destructive and not undoable: an agent always needs the human's
          // click, and auto-approve does not cover it — that setting lifts
          // the share-link gate only. The page's own Delete button confirms
          // in the dialog, so its call arrives already approved.
          if (via !== "page") {
            await requestApproval(
              "An agent wants to delete a playlist. The tracks stay in your library. Allow it?",
            );
          }
          return deletePlaylist(input as { playlistId: string });
        },
        () => "Playlist deleted",
      ),
    },
    {
      name: "create_share_link",
      title: "Create a private Postal share link",
      description:
        "Create or rotate an unlisted private share link for a playlist owned by the signed-in Postal user. Returns the link but never emails or sends it.",
      inputSchema: objectSchema(
        { playlistId: { type: "string", description: "Postal playlist ID." } },
        ["playlistId"],
      ),
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
      execute: instrumentedExecute(
        "create_share_link",
        async (input: { playlistId?: string }, { via }) => {
          // The page pauses the tool call and asks the human — every outside
          // caller needs this click. The user can lift the gate with the
          // page's auto-approve setting; that standing grant is theirs to
          // give and take, never the agent's. A click on the page's own
          // "Create share link" button *is* the human's decision, so it
          // skips the prompt.
          const autoApproved = readLabSettings().autoApprove;
          if (!autoApproved && via !== "page") {
            await requestApproval(
              "An agent wants to create a private share link for a playlist. Allow it?",
            );
          }
          const result = await createShareLink(input as { playlistId: string });
          return { ...result, autoApproved };
        },
        (result) =>
          result.autoApproved
            ? "Private link created (auto-approved)"
            : "Private link created",
      ),
    },
  ];
}

let cachedDefinitions: WebMcpToolDefinition[] | null = null;
function toolDefinitions(): WebMcpToolDefinition[] {
  cachedDefinitions ??= postalToolDefinitions();
  return cachedDefinitions;
}

/**
 * The page's own controls go through the very same instrumented tools an
 * agent calls — one code path, one activity stream, one history — so a
 * human removing a track in the playlist dialog and an agent doing it are
 * indistinguishable to Postal and visible side by side on the page. Works
 * without WebMCP too: the definitions exist whether or not the browser
 * accepted them.
 */
/** Every tool the page could run right now: the static set plus the contextual ones. */
export function allToolDefinitions(): WebMcpToolDefinition[] {
  return [...toolDefinitions(), ...contextualToolDefinitions()];
}

export function findToolDefinition(tool: string): WebMcpToolDefinition | undefined {
  return allToolDefinitions().find((candidate) => candidate.name === tool);
}

export async function executePostalTool<T extends Record<string, unknown> = Record<string, unknown>>(
  tool: PostalWebMcpToolName,
  input: unknown,
): Promise<T> {
  const definition = findToolDefinition(tool);
  if (!definition) {
    throw new PostalCapabilityError("INVALID_INPUT", `Unknown tool ${tool}.`);
  }
  return executeDefinitionAsPage<T>(definition, input);
}

function registrationResult(
  status: PostalWebMcpRegistrationStatus,
  registeredTools: PostalWebMcpToolName[] = [],
  errors: string[] = [],
  cleanup: () => void = () => {},
): PostalWebMcpRegistration {
  return { status, registeredTools, errors, cleanup };
}

export async function registerPostalWebMCPTools(): Promise<PostalWebMcpRegistration> {
  if (!isPostalWebMcpEnabled()) return registrationResult("disabled");
  if (typeof document === "undefined" || !document.modelContext?.registerTool) {
    return registrationResult("unsupported");
  }

  const modelContext = document.modelContext;
  if (!sharedRegistration || sharedRegistration.modelContext !== modelContext) {
    const controller = new AbortController();
    const promise = (async () => {
      const registeredTools: PostalWebMcpToolName[] = [];
      const errors: string[] = [];
      for (const tool of toolDefinitions()) {
        try {
          await modelContext.registerTool(tool, { signal: controller.signal });
          registeredTools.push(tool.name as PostalWebMcpToolName);
        } catch (error) {
          const message = `${tool.name}: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(message);
          console.warn(`[WebMCP] Could not register ${tool.name}`, error);
        }
      }
      return { registeredTools, errors };
    })();
    sharedRegistration = { modelContext, controller, refs: 0, promise };
  }

  const registration = sharedRegistration;
  registration.refs += 1;
  const result = await registration.promise;
  let released = false;
  const cleanup = () => {
    if (released) return;
    released = true;
    registration.refs -= 1;
    if (registration.refs <= 0) {
      registration.controller.abort();
      if (sharedRegistration === registration) sharedRegistration = null;
    }
  };
  const status =
    result.registeredTools.length === STATIC_TOOL_NAMES.length
      ? "registered"
      : result.registeredTools.length
        ? "partial"
        : "failed";
  return registrationResult(status, result.registeredTools, result.errors, cleanup);
}
