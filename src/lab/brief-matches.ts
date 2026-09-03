import type { BriefMatchResult } from "@/capabilities/types";
import type { PostalWebMcpActivity } from "@/webmcp/types";

/**
 * The most recent brief match on this page, reconstructed from the activity
 * stream the same way the agent's playlist is. A match_brief result is a
 * proposal, not a write: the page shows it as a shortlist the human can
 * audition and prune before anything is created, and `executionId` keys the
 * dismissal so a new call brings a fresh panel.
 */
export interface PageBriefMatch extends BriefMatchResult {
  executionId: string;
  via: "agent" | "page";
  /** Set when the match created a playlist in the same call. */
  playlistId?: string;
}

export function deriveBriefMatch(
  activities: PostalWebMcpActivity[],
): PageBriefMatch | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity.tool !== "match_brief" || activity.status !== "success" || !activity.result) {
      continue;
    }
    const result = activity.result as Partial<BriefMatchResult>;
    if (!Array.isArray(result.matches) || !result.brief) continue;
    const created = (activity.result as { playlistId?: unknown }).playlistId;
    return {
      executionId: activity.executionId,
      via: activity.via ?? "agent",
      ...(typeof created === "string" ? { playlistId: created } : {}),
      matches: result.matches,
      brief: result.brief,
      ...(typeof result.candidatePool === "number" ? { candidatePool: result.candidatePool } : {}),
      historyId: typeof result.historyId === "string" ? result.historyId : null,
    };
  }
  return null;
}

/** Playlist name for a shortlist made from a brief, when the user has not typed one. */
export function suggestedPitchName(match: Pick<PageBriefMatch, "brief">): string {
  const source = match.brief.source?.replace(/\.pdf$/i, "").trim();
  if (source) return `Pitch · ${source}`.slice(0, 120);
  const summary = match.brief.summary?.trim();
  if (summary) return `Pitch · ${summary}`.slice(0, 120);
  return "Pitch shortlist";
}
