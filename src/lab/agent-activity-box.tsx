import { useEffect, useState } from "react";

import { ChevronIcon, CopyIcon, IconButton, NoteIcon, StatusDot } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { PostalWebMcpRegistrationStatus } from "@/webmcp/register-postal-tools";
import type { PostalWebMcpActivity, PostalWebMcpToolName } from "@/webmcp/types";
import type { ApprovalRequest } from "@/webmcp/approval";

import { ActivityLog, describeStep } from "./activity-log";
import type { AgentPlaylist } from "./agent-playlist";
import type { HistoryEntry } from "./history";
import { HistoryList } from "./history-panel";
import { ShareLinkRow } from "./playlist-card";
import { ToolStatus } from "./tool-status";

const EXAMPLE_ASK =
  "Build a playlist of my latest 5 tracks and give me the link so I can send it to my manager.";

/**
 * The page's one window onto the agent: a small strip in the corner that
 * narrates the current step while the agent works, and expands into the full
 * list of steps, the outcome, and the approval gate on demand. There is no
 * composer — the conversation happens in the agent's own UI, and this box
 * only shows what the agent did to the catalogue.
 */
export function AgentActivityBox({
  activities,
  playlist,
  playlistInDrawer,
  approval,
  autoApprove,
  onAnswerApproval,
  onToggleAutoApprove,
  onClearActivities,
  history,
  onClearHistory,
  registrationStatus,
  registeredTools,
  contextualTools,
  lifted = false,
}: {
  activities: PostalWebMcpActivity[];
  playlist: AgentPlaylist | null;
  /** The drawer is showing the playlist; do not repeat its link here. */
  playlistInDrawer: boolean;
  approval: ApprovalRequest | null;
  autoApprove: boolean;
  onAnswerApproval: (approved: boolean, always?: boolean) => void;
  onToggleAutoApprove: () => void;
  onClearActivities: () => void;
  history: HistoryEntry[];
  onClearHistory: () => void;
  registrationStatus: PostalWebMcpRegistrationStatus | "registering";
  registeredTools: PostalWebMcpToolName[];
  contextualTools: string[];
  /** Sit above the bottom player when it is showing. */
  lifted?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<"steps" | "history">("steps");
  const [copied, setCopied] = useState(false);

  // An approval is the one thing that must interrupt: the agent's call is
  // paused until a human answers, so the box opens itself.
  useEffect(() => {
    if (approval) {
      setExpanded(true);
      setView("steps");
    }
  }, [approval]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  const running = activities.filter((activity) => activity.status === "running");
  const current = running[running.length - 1] ?? activities[activities.length - 1] ?? null;
  const isWorking = running.length > 0;
  const lastFailed = !isWorking && current?.status === "error";
  const shareUrl = playlist?.shareUrl;
  const healthy = registrationStatus === "registered";

  const position = `fixed right-4 z-20 transition-[bottom] ${lifted ? "bottom-[104px]" : "bottom-4"}`;
  const surface =
    "bg-background-light shadow-[0_12px_40px_rgba(24,24,24,0.12)] ring-1 ring-neutral-175";

  const copyLink = () => {
    if (!shareUrl) return;
    void navigator.clipboard
      ?.writeText(shareUrl)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  if (!expanded) {
    // Collapsed: one line about what is happening right now.
    let dot: string;
    let label: string;
    if (approval) {
      dot = "bg-accent animate-pulse";
      label = "Needs your approval";
    } else if (isWorking && current) {
      dot = "bg-info animate-pulse";
      label = describeStep(current);
    } else if (lastFailed && current) {
      dot = "bg-danger";
      label = describeStep(current);
    } else if (shareUrl) {
      dot = "bg-success";
      label = `Link ready${playlist?.name ? ` · ${playlist.name}` : ""}`;
    } else if (current) {
      dot = "bg-success";
      label = describeStep(current);
    } else {
      dot = healthy
        ? "bg-success"
        : registrationStatus === "registering"
          ? "bg-info animate-pulse"
          : "bg-danger";
      label = healthy
        ? "Ready for your agent"
        : registrationStatus === "registering"
          ? "Registering tools…"
          : registrationStatus === "unsupported"
            ? "No WebMCP in this browser"
            : "Tool registration incomplete";
    }

    return (
      <div
        className={`${position} ${surface} box-in flex max-w-[min(420px,calc(100vw-2rem))] items-center gap-1 rounded-full py-1 pl-4 pr-1.5`}
      >
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          aria-label="Show agent activity"
          className="flex min-w-0 items-center gap-2.5 py-1.5 text-left"
        >
          <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
          <span className="truncate text-xs font-medium text-content">{label}</span>
          {activities.length > 0 && !approval && !shareUrl && (
            <span className="shrink-0 text-[11px] tabular-nums text-content-subtle">
              {activities.length} step{activities.length === 1 ? "" : "s"}
            </span>
          )}
        </button>
        {approval ? (
          <Button size="compact" onClick={() => onAnswerApproval(true)}>
            Approve
          </Button>
        ) : shareUrl && !isWorking ? (
          <Button size="compact" onClick={copyLink} className="gap-1.5">
            <CopyIcon className="size-3" />
            {copied ? "Copied" : "Copy link"}
          </Button>
        ) : (
          <IconButton label="Expand" onClick={() => setExpanded(true)}>
            <ChevronIcon up className="size-3" />
          </IconButton>
        )}
      </div>
    );
  }

  const title = approval
    ? "Needs your approval"
    : isWorking
      ? current?.via === "page"
        ? "Working"
        : "Agent working"
      : activities.length
        ? "Agent activity"
        : "Agent";

  return (
    <aside
      aria-label="Agent activity"
      className={`${position} ${surface} box-in flex max-h-[min(60vh,560px)] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[20px]`}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-1 rounded-full bg-neutral-100 p-0.5">
          <SegmentButton active={view === "steps"} onClick={() => setView("steps")}>
            {isWorking && view === "steps" && (
              <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-info" />
            )}
            {title}
          </SegmentButton>
          <SegmentButton active={view === "history"} onClick={() => setView("history")}>
            History
          </SegmentButton>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {view === "history" && history.length > 0 && (
            <TextButton onClick={onClearHistory}>Clear</TextButton>
          )}
          {view === "steps" && activities.length > 0 && !isWorking && (
            <TextButton onClick={onClearActivities}>Clear</TextButton>
          )}
          <IconButton label="Minimise" onClick={() => setExpanded(false)}>
            <ChevronIcon className="size-3" />
          </IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-neutral-150">
        {view === "history" ? (
          <HistoryList entries={history} />
        ) : (
          <>
            {approval && !playlistInDrawer && (
              <div className="m-3 rounded-[14px] bg-accent-muted px-4 py-3.5">
                <p className="text-xs leading-relaxed text-content">{approval.message}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="compact" onClick={() => onAnswerApproval(true)}>
                    Approve
                  </Button>
                  <Button
                    size="compact"
                    variant="secondary"
                    onClick={() => onAnswerApproval(true, true)}
                  >
                    Always approve
                  </Button>
                  <button
                    type="button"
                    onClick={() => onAnswerApproval(false)}
                    className="px-2 text-xs font-medium text-content-subtle transition hover:text-content"
                  >
                    Deny
                  </button>
                </div>
              </div>
            )}

            {playlist && !playlistInDrawer && (playlist.name || shareUrl) && (
              <div className="border-b border-neutral-150 px-4 py-3">
                <div className="flex items-center gap-2.5">
                  {shareUrl ? (
                    <StatusDot state="success" />
                  ) : (
                    <span className="flex size-4 items-center justify-center rounded-full bg-neutral-100 text-content-subtle">
                      <NoteIcon className="size-2.5" />
                    </span>
                  )}
                  <p className="truncate text-sm font-medium text-content">
                    {playlist.name ?? "Playlist"}
                  </p>
                  <span className="ml-auto shrink-0 text-xs tabular-nums text-content-subtle">
                    {playlist.trackIds.length} track{playlist.trackIds.length === 1 ? "" : "s"}
                  </span>
                </div>
                {shareUrl && <ShareLinkRow shareUrl={shareUrl} />}
              </div>
            )}

            <ActivityLog
              activities={activities}
              awaitingApproval={Boolean(approval)}
              emptyText={
                healthy
                  ? `No steps yet. Try asking your agent: “${EXAMPLE_ASK}”`
                  : "Tools are not available to agents in this browser."
              }
            />
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-neutral-150 px-4 py-2.5">
        <ToolStatus
          status={registrationStatus}
          registeredTools={registeredTools}
          contextualTools={contextualTools}
        />
        <button
          type="button"
          onClick={onToggleAutoApprove}
          aria-pressed={autoApprove}
          title="When on, agents can create share links without an Approve click."
          className="flex shrink-0 items-center gap-2 text-[11px] text-content-subtle transition hover:text-content"
        >
          Auto-approve
          <span
            aria-hidden="true"
            className={`relative inline-flex h-4 w-7 rounded-full transition ${
              autoApprove ? "bg-success" : "bg-neutral-200"
            }`}
          >
            <span
              className={`absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition ${
                autoApprove ? "left-3.5" : "left-0.5"
              }`}
            />
          </span>
        </button>
      </div>
    </aside>
  );
}

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-w-0 items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
        active
          ? "bg-background-light text-content shadow-[0_1px_2px_rgba(24,24,24,0.08)]"
          : "text-content-subtle hover:text-content"
      }`}
    >
      {children}
    </button>
  );
}

function TextButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-2 py-0.5 text-[11px] font-medium text-content-subtle transition hover:bg-neutral-100 hover:text-content"
    >
      {children}
    </button>
  );
}
