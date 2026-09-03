import { StatusDot } from "@/components/icons";
import type { PostalWebMcpActivity, PostalWebMcpToolName } from "@/webmcp/types";

/**
 * Tool calls, described the way a person would narrate them. The tool name
 * and the raw arguments are the agent's vocabulary; the person watching wants
 * "Creating playlist “Ibiza Shortlist”…", not `create_playlist {"name":…}`.
 * The exact call stays one hover away (title) and in full in the history.
 */
function parseInput(preview?: string): Record<string, any> | null {
  if (!preview) return null;
  try {
    return JSON.parse(preview);
  } catch {
    return null;
  }
}

const RUNNING_LABEL: Record<PostalWebMcpToolName, (input: Record<string, any> | null) => string> = {
  search_tracks: (input) =>
    input?.query ? `Searching for “${String(input.query)}”…` : "Finding your newest tracks…",
  get_track: () => "Reading a track…",
  list_playlists: () => "Looking up your playlists…",
  get_selected_tracks: () => "Reading your selection…",
  get_brief: () => "Reading the brief…",
  match_brief: (input) =>
    input?.source ? `Matching the brief from ${String(input.source)}…` : "Matching the brief against your catalogue…",
  control_playback: (input) =>
    input?.action === "pause"
      ? "Pausing playback…"
      : input?.action === "next"
        ? "Skipping to the next track…"
      : input?.action === "previous"
        ? "Going back a track…"
      : input?.action === "seek"
        ? input?.section
          ? `Jumping to the ${String(input.section)}…`
          : "Seeking…"
        : input?.section
          ? `Starting playback from the ${String(input.section)}…`
          : "Starting playback…",
  create_playlist: (input) =>
    input?.name ? `Creating playlist “${String(input.name)}”…` : "Creating a playlist…",
  update_playlist: (input) =>
    input?.name ? `Renaming playlist to “${String(input.name)}”…` : "Updating the playlist…",
  add_tracks_to_playlist: (input) =>
    Array.isArray(input?.trackIds)
      ? `Adding ${input.trackIds.length} track${input.trackIds.length === 1 ? "" : "s"}…`
      : "Adding tracks…",
  remove_tracks_from_playlist: (input) =>
    Array.isArray(input?.trackIds)
      ? `Removing ${input.trackIds.length} track${input.trackIds.length === 1 ? "" : "s"}…`
      : "Removing tracks…",
  reorder_playlist: () => "Reordering the playlist…",
  delete_playlist: () => "Deleting the playlist…",
  create_share_link: () => "Creating a private share link…",
  remove_from_open_playlist: (input) =>
    Array.isArray(input?.trackIds)
      ? `Removing ${input.trackIds.length} track${input.trackIds.length === 1 ? "" : "s"} from the open playlist…`
      : "Removing tracks from the open playlist…",
  reorder_open_playlist: () => "Reordering the open playlist…",
  create_playlist_from_shortlist: (input) =>
    input?.name
      ? `Creating “${String(input.name)}” from the kept picks…`
      : "Turning the kept picks into a playlist…",
  get_now_playing: () => "Checking what is playing…",
  remove_now_playing: () => "Removing the track that is playing…",
};

/** One line for a step, whatever its state. */
export function describeStep(
  activity: PostalWebMcpActivity,
  options: { awaitingApproval?: boolean } = {},
): string {
  if (activity.status === "running") {
    if (activity.tool === "create_share_link" && options.awaitingApproval) {
      return "Waiting for your approval…";
    }
    return RUNNING_LABEL[activity.tool]?.(parseInput(activity.inputPreview)) ?? "Working…";
  }
  return activity.summary ?? (activity.status === "success" ? "Done" : "Failed");
}

/** Chrome-less rows — the activity box supplies the card around them. */
export function ActivityLog({
  activities,
  awaitingApproval = false,
  emptyText = "Waiting for the first tool call…",
}: {
  activities: PostalWebMcpActivity[];
  /** True while a share-link call is paused on the approval gate. */
  awaitingApproval?: boolean;
  emptyText?: string;
}) {
  if (!activities.length) {
    return (
      <p className="px-6 py-8 text-center text-xs leading-relaxed text-content-subtle">{emptyText}</p>
    );
  }

  return (
    <ol className="divide-y divide-neutral-100">
      {activities.map((activity) => {
        const paused =
          awaitingApproval &&
          activity.status === "running" &&
          activity.tool === "create_share_link";
        return (
          <li
            key={activity.executionId}
            title={`${activity.tool}${activity.inputPreview ? ` ${activity.inputPreview}` : ""}`}
            className="flex items-center gap-3 px-4 py-2.5"
          >
            <StatusDot
              state={
                activity.status === "success"
                  ? "success"
                  : activity.status === "error"
                    ? "error"
                    : paused
                      ? "paused"
                      : "busy"
              }
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={`truncate text-xs ${
                    activity.status === "error"
                      ? "text-danger"
                      : paused
                        ? "font-medium text-accent"
                        : "text-content"
                  }`}
                >
                  {describeStep(activity, { awaitingApproval })}
                </span>
                {activity.durationMs !== undefined && (
                  <span className="shrink-0 text-[11px] tabular-nums text-content-subtle">
                    {activity.durationMs < 1000
                      ? `${activity.durationMs} ms`
                      : `${(activity.durationMs / 1000).toFixed(1)} s`}
                  </span>
                )}
              </div>
              {activity.status === "error" && activity.errorCode && (
                <span className="block truncate text-[11px] text-content-subtle">
                  {activity.errorCode}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
