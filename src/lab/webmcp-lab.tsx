import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toPostalCapabilityError } from "@/capabilities/errors";
import type { AgentTrackDetail } from "@/capabilities/types";
import { fetchLibrary } from "@/postal/library";
import {
  allToolDefinitions,
  executePostalTool,
  findToolDefinition,
  registerPostalWebMCPTools,
  type PostalWebMcpRegistrationStatus,
} from "@/webmcp/register-postal-tools";
import {
  gateFor,
  markUrlRequestHandled,
  parseUrlToolRequest,
  runUrlToolRequest,
  unknownToolOutcome,
  type UrlToolRequest,
} from "@/webmcp/url-door";
import { createUrlDoorRelay, type UrlDoorRelay } from "@/webmcp/url-door-relay";
import {
  POSTAL_WEBMCP_ACTIVITY_EVENT,
  type PostalWebMcpActivity,
  type PostalWebMcpToolName,
} from "@/webmcp/types";
import {
  APPROVAL_REQUEST_EVENT,
  respondToApproval,
  type ApprovalRequest,
} from "@/webmcp/approval";
import { installAgentBridge } from "@/webmcp/agent-bridge";
import {
  installContextualTools,
  subscribeContextualTools,
} from "@/webmcp/contextual-tools";

import { AgentActivityBox } from "./agent-activity-box";
import { BOTTOM_PLAYER_HEIGHT, BottomPlayer } from "./bottom-player";
import { deriveAgentPlaylist } from "./agent-playlist";
import { deriveBriefMatch, suggestedPitchName } from "./brief-matches";
import { BriefMatchesPanel } from "./brief-matches-panel";
import { extractPdfText } from "./brief-reader";
import { clearBrief, setBrief, subscribeBrief, type PageBrief } from "./brief-store";
import { appendHistory, clearHistory, readHistory, type HistoryEntry } from "./history";
import { setPagePlaylist, setPageShortlist } from "./page-context-store";
import { PlaylistDialog, PlaylistPill, type PlaylistPhase } from "./playlist-dialog";
import { installPlayQueue, setCatalogueQueue } from "./play-queue";
import { playingTrackDetails, subscribePlayback } from "./player-controller";
import {
  subscribeLabSettings,
  updateLabSettings,
  type LabSettings,
} from "./settings-store";
import { TrackLibrary, type LibraryStatus } from "./track-library";
import { UrlDoorPanel, type UrlDoorState } from "./url-door-panel";

/**
 * The Lab is a workspace, not a chat. The person talks to their agent in the
 * agent's own UI (a WebMCP-capable browser, ChatGPT's in-app browser, …);
 * the agent calls the tools this page registers; the page shows the
 * catalogue, narrates each step in a small corner box, and opens the playlist
 * dialog when the calls add up to a deliverable — where the person can add
 * and remove tracks through the very same tools.
 */
export function WebMcpLab() {
  const [registrationStatus, setRegistrationStatus] = useState<
    PostalWebMcpRegistrationStatus | "registering"
  >("registering");
  const [registeredTools, setRegisteredTools] = useState<PostalWebMcpToolName[]>([]);
  const [activities, setActivities] = useState<PostalWebMcpActivity[]>([]);
  const [library, setLibrary] = useState<AgentTrackDetail[]>([]);
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus>("loading");
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [briefNote, setBriefNote] = useState<string | null>(null);
  const [brief, setBriefState] = useState<PageBrief | null>(null);
  const [settings, setSettings] = useState<LabSettings>({ autoApprove: false });
  const [history, setHistory] = useState<HistoryEntry[]>(() => readHistory());
  const [contextualTools, setContextualTools] = useState<string[]>([]);
  // The bottom player shows once anything has played and stays until closed;
  // the corner box and the page padding move up to make room for it.
  const [playerVisible, setPlayerVisible] = useState(false);

  useEffect(() => subscribeContextualTools(setContextualTools), []);
  useEffect(() => installPlayQueue(), []);

  // The URL door: a tool call in the hash, for agents that can only open
  // URLs and read text. Free read-only tools run on arrival; anything else
  // waits for the person's Run click. A call arriving in a freshly opened
  // tab is handed to the Lab tab already open (see url-door-relay), so the
  // result appears where the agent is reading.
  const [urlDoor, setUrlDoor] = useState<UrlDoorState | null>(null);
  const relayRef = useRef<UrlDoorRelay | null>(null);
  const runUrlRequest = useCallback(async (request: UrlToolRequest, replyTo?: string) => {
    const definition = findToolDefinition(request.tool);
    const outcome = definition
      ? await (async () => {
          setUrlDoor({ kind: "running", request });
          return runUrlToolRequest(request, definition);
        })()
      : unknownToolOutcome(request, allToolDefinitions().map((tool) => tool.name));
    setUrlDoor({ kind: "done", outcome });
    if (replyTo) relayRef.current?.publishResult(replyTo, outcome);
  }, []);
  // Gate a request that has reached this tab (from its own hash, or handed
  // over by another tab) and either run it or park it behind Run.
  const admitRequest = useCallback(
    (request: UrlToolRequest, replyTo?: string) => {
      const gate = gateFor(findToolDefinition(request.tool));
      if (gate === "auto" || gate === "unknown") {
        void runUrlRequest(request, replyTo);
        return;
      }
      setUrlDoor({
        kind: "pending",
        request,
        reason:
          request.tool === "match_brief"
            ? "This call costs one Postal credit, so a link cannot spend it without you."
            : "This call changes your Postal account, so a link cannot make it without you.",
      });
      pendingReplyTo.current = replyTo ?? null;
    },
    [runUrlRequest],
  );
  const pendingReplyTo = useRef<string | null>(null);
  useEffect(() => {
    const relay = createUrlDoorRelay({
      onRequest: (request, replyTo) => admitRequest(request, replyTo),
      onResult: (outcome) => setUrlDoor({ kind: "done", outcome }),
    });
    relayRef.current = relay;
    const handle = () => {
      const parsed = parseUrlToolRequest(window.location.hash);
      if (!parsed) return;
      if ("error" in parsed) {
        setUrlDoor({ kind: "invalid", message: parsed.error });
        return;
      }
      markUrlRequestHandled(parsed);
      void relay.forward(parsed).then((route) => {
        if (route === "forwarded") {
          setUrlDoor({ kind: "forwarded", request: parsed });
          return;
        }
        admitRequest(parsed);
      });
    };
    handle();
    window.addEventListener("hashchange", handle);
    return () => {
      window.removeEventListener("hashchange", handle);
      relay.close();
      relayRef.current = null;
    };
  }, [admitRequest]);
  useEffect(() => setCatalogueQueue(library), [library]);
  useEffect(
    () =>
      subscribePlayback((id) => {
        if (id || playingTrackDetails()) setPlayerVisible(true);
      }),
    [],
  );

  useEffect(() => subscribeBrief(setBriefState), []);
  useEffect(() => subscribeLabSettings(setSettings), []);

  // Overlapping loads (a refresh during a page-through) must not interleave.
  const libraryLoadId = useRef(0);
  const loadLibrary = useCallback(async () => {
    const loadId = ++libraryLoadId.current;
    setLibraryStatus("loading");
    setLibraryError(null);
    try {
      await fetchLibrary((snapshot) => {
        if (libraryLoadId.current !== loadId) return;
        setLibrary(snapshot.tracks);
        setLibraryTotal(snapshot.totalCount);
        // Ready as soon as the first page is in — the rest streams in behind.
        setLibraryStatus("ready");
      });
    } catch (cause) {
      if (libraryLoadId.current !== loadId) return;
      setLibraryError(toPostalCapabilityError(cause).message);
      setLibraryStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    void registerPostalWebMCPTools().then((registration) => {
      cleanup = registration.cleanup;
      if (cancelled) {
        cleanup();
        return;
      }
      setRegistrationStatus(registration.status);
      setRegisteredTools(registration.registeredTools);
      // Once the tools exist, publish the DOM manifest and open the
      // postMessage bridge for agents that cannot see the API directly, and
      // start the contextual layer that keeps the tool list in step with
      // the screen (bridge first, so it hears the toolchange events).
      if (registration.registeredTools.length) {
        const removeBridge = installAgentBridge();
        const removeContextual = installContextualTools();
        const removeTools = cleanup;
        cleanup = () => {
          removeContextual();
          removeBridge();
          removeTools();
        };
      }
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  // Every tool execution lands here as a step; finished ones also go to the
  // local history. The catalogue re-reads after any write so a new playlist's
  // picks light up.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const onActivity = (event: Event) => {
      const activity = (event as CustomEvent<PostalWebMcpActivity>).detail;
      if (activity.status !== "running") {
        setHistory(
          appendHistory({
            kind: "tool",
            at: new Date().toISOString(),
            tool: activity.tool,
            status: activity.status,
            durationMs: activity.durationMs,
            summary: activity.summary,
            errorCode: activity.errorCode,
            inputPreview: activity.inputPreview,
            via: activity.via ?? "agent",
          }),
        );
        if (
          activity.status === "success" &&
          (activity.tool === "create_playlist" ||
            activity.tool === "add_tracks_to_playlist" ||
            activity.tool === "remove_tracks_from_playlist" ||
            activity.tool === "delete_playlist" ||
            activity.tool === "create_playlist_from_shortlist" ||
            activity.tool === "remove_from_open_playlist" ||
            activity.tool === "remove_now_playing" ||
            (activity.tool === "match_brief" && typeof activity.result?.playlistId === "string"))
        ) {
          if (refreshTimer.current) clearTimeout(refreshTimer.current);
          refreshTimer.current = setTimeout(() => void loadLibrary(), 1200);
        }
      }
      setActivities((current) => {
        const index = current.findIndex(
          (item) => item.executionId === activity.executionId,
        );
        if (index === -1) return [...current, activity];
        const next = [...current];
        next[index] = activity;
        return next;
      });
    };
    window.addEventListener(POSTAL_WEBMCP_ACTIVITY_EVENT, onActivity);
    return () => {
      window.removeEventListener(POSTAL_WEBMCP_ACTIVITY_EVENT, onActivity);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [loadLibrary]);

  useEffect(() => {
    const onApprovalRequest = (event: Event) => {
      setApproval((event as CustomEvent<ApprovalRequest>).detail);
    };
    window.addEventListener(APPROVAL_REQUEST_EVENT, onApprovalRequest);
    return () => window.removeEventListener(APPROVAL_REQUEST_EVENT, onApprovalRequest);
  }, []);

  const answerApproval = (approved: boolean, always = false) => {
    if (!approval) return;
    if (always) updateLabSettings({ autoApprove: true });
    respondToApproval(approval.approvalId, approved);
    setApproval(null);
  };

  const handleBriefDrop = async (file: File) => {
    setBriefNote(`Reading ${file.name}…`);
    try {
      const text = await extractPdfText(file);
      if (!text) {
        setBriefNote("That PDF contains no extractable text (a scan needs OCR first).");
        return;
      }
      setBrief({ fileName: file.name, text, droppedAt: new Date().toISOString() });
      setBriefNote(null);
    } catch (cause) {
      setBriefNote(
        cause instanceof Error ? `Could not read that PDF: ${cause.message}` : "Could not read that PDF.",
      );
    }
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    const file = Array.from(event.dataTransfer.files).find(
      (candidate) => candidate.type === "application/pdf" || candidate.name.toLowerCase().endsWith(".pdf"),
    );
    if (file) void handleBriefDrop(file);
  };

  // What has been built through the tools, reconstructed from the activity
  // stream and shown in the playlist drawer as a playable deliverable.
  const agentPlaylist = useMemo(() => deriveAgentPlaylist(activities), [activities]);
  const highlighted = useMemo(
    () => new Set(agentPlaylist?.trackIds ?? []),
    [agentPlaylist],
  );

  // The latest brief match is a proposal the human can audition and prune;
  // dismissing it is per call, so the next match_brief brings a fresh panel.
  const briefMatch = useMemo(() => deriveBriefMatch(activities), [activities]);
  const [dismissedMatchId, setDismissedMatchId] = useState<string | null>(null);
  const briefMatchVisible = Boolean(briefMatch && briefMatch.executionId !== dismissedMatchId);
  const matched = useMemo(() => {
    const map = new Map<string, string | null>();
    if (briefMatchVisible && briefMatch) {
      for (const pick of briefMatch.matches) map.set(pick.id, pick.reason ?? null);
    }
    return map;
  }, [briefMatch, briefMatchVisible]);
  const [creatingFromBrief, setCreatingFromBrief] = useState(false);
  // The person's click on the shortlist runs the same create_playlist /
  // add_tracks_to_playlist tools an agent would, so the playlist dialog and
  // history pick it up exactly as if the agent had finished the job.
  const createPlaylistFromBrief = useCallback(
    async (trackIds: string[]) => {
      if (!briefMatch || !trackIds.length) return;
      setCreatingFromBrief(true);
      try {
        if (agentPlaylist) {
          await executePostalTool("add_tracks_to_playlist", {
            playlistId: agentPlaylist.playlistId,
            trackIds,
          });
        } else {
          await executePostalTool("create_playlist", {
            name: suggestedPitchName(briefMatch),
            description: briefMatch.brief.summary ?? briefMatch.brief.excerpt,
            trackIds,
          });
        }
      } finally {
        setCreatingFromBrief(false);
      }
    },
    [agentPlaylist, briefMatch],
  );

  // Dialog phase: "building" while any tool call is in flight, held briefly
  // afterwards because an agent thinks between calls — except once the share
  // link has landed, which is the end of the job and should read as done.
  const anyToolRunning = activities.some((activity) => activity.status === "running");
  const linkLanded = Boolean(agentPlaylist?.shareUrl);
  const [playlistPhase, setPlaylistPhase] = useState<PlaylistPhase>("ready");
  useEffect(() => {
    if (anyToolRunning) {
      setPlaylistPhase("building");
      return;
    }
    if (linkLanded) {
      setPlaylistPhase("ready");
      return;
    }
    const timer = setTimeout(() => setPlaylistPhase("ready"), 3500);
    return () => clearTimeout(timer);
  }, [anyToolRunning, linkLanded]);

  // The dialog opens itself when a playlist first appears and again when its
  // share link lands; a manual close sticks until one of those changes.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerKey = useRef<string | null>(null);
  useEffect(() => {
    if (!agentPlaylist) {
      drawerKey.current = null;
      setDrawerOpen(false);
      return;
    }
    const key = `${agentPlaylist.playlistId}:${agentPlaylist.shareUrl ? "shared" : "bare"}`;
    if (drawerKey.current !== key) {
      drawerKey.current = key;
      setDrawerOpen(true);
    }
  }, [agentPlaylist]);

  const drawerVisible = Boolean(agentPlaylist && drawerOpen);

  // Mirror the playlist into the page context so the contextual tools can
  // name it, and exist only while the dialog shows it. Titles come from the
  // catalogue or the brief shortlist; ids the page has not loaded stay ids.
  useEffect(() => {
    if (!agentPlaylist) {
      setPagePlaylist(null);
      return;
    }
    const known = new Map<string, { title: string; playbackUrl?: string }>();
    for (const track of library) known.set(track.id, track);
    for (const pick of briefMatch?.matches ?? []) known.set(pick.id, pick);
    setPagePlaylist({
      playlistId: agentPlaylist.playlistId,
      name: agentPlaylist.name,
      tracks: agentPlaylist.trackIds.map((id) => {
        const track = known.get(id);
        return {
          id,
          title: track?.title ?? id,
          ...(track?.playbackUrl ? { playbackUrl: track.playbackUrl } : {}),
        };
      }),
      shareUrl: agentPlaylist.shareUrl,
      open: drawerVisible,
    });
  }, [agentPlaylist, drawerVisible, library, briefMatch]);

  // The shortlist context follows the panel: gone when dismissed, refreshed
  // with the kept picks whenever the person unticks one.
  useEffect(() => {
    if (!briefMatch || !briefMatchVisible) setPageShortlist(null);
  }, [briefMatch, briefMatchVisible]);
  const onKeptChange = useCallback(
    (kept: { id: string; title: string; playbackUrl?: string }[]) => {
      if (!briefMatch) return;
      setPageShortlist({
        executionId: briefMatch.executionId,
        source: briefMatch.brief.source,
        summary: briefMatch.brief.summary,
        kept: kept.map((pick) => ({
          id: pick.id,
          title: pick.title,
          ...(pick.playbackUrl ? { playbackUrl: pick.playbackUrl } : {}),
        })),
        total: briefMatch.matches.length,
      });
    },
    [briefMatch],
  );

  // The dialog's own Add / Remove buttons call the registered tools, so the
  // person's edits and the agent's calls share one activity stream and one
  // derived playlist. `via: "page"` on those activities keeps them apart.
  const addTracks = useCallback(
    async (trackIds: string[]) => {
      if (!agentPlaylist) return;
      await executePostalTool("add_tracks_to_playlist", {
        playlistId: agentPlaylist.playlistId,
        trackIds,
      });
    },
    [agentPlaylist],
  );
  const removeTrack = useCallback(
    async (trackId: string) => {
      if (!agentPlaylist) return;
      await executePostalTool("remove_tracks_from_playlist", {
        playlistId: agentPlaylist.playlistId,
        trackIds: [trackId],
      });
    },
    [agentPlaylist],
  );
  const renamePlaylist = useCallback(
    async (name: string) => {
      if (!agentPlaylist) return;
      await executePostalTool("update_playlist", {
        playlistId: agentPlaylist.playlistId,
        name,
      });
    },
    [agentPlaylist],
  );
  const reorderPlaylist = useCallback(
    async (trackIds: string[]) => {
      if (!agentPlaylist) return;
      await executePostalTool("reorder_playlist", {
        playlistId: agentPlaylist.playlistId,
        trackIds,
      });
    },
    [agentPlaylist],
  );
  // The click is the approval: create_share_link skips its prompt for
  // page-originated calls (see register-postal-tools).
  const createShareLinkFromPage = useCallback(async () => {
    if (!agentPlaylist) return;
    await executePostalTool("create_share_link", { playlistId: agentPlaylist.playlistId });
  }, [agentPlaylist]);
  // Confirmed in the dialog, so the tool's agent-only approval gate is
  // bypassed for this page-originated call.
  const deletePlaylistFromPage = useCallback(async () => {
    if (!agentPlaylist) return;
    await executePostalTool("delete_playlist", { playlistId: agentPlaylist.playlistId });
  }, [agentPlaylist]);
  const closeDialog = useCallback(() => setDrawerOpen(false), []);

  return (
    <div
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setIsDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDragging(false);
      }}
      onDrop={onDrop}
    >
      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-background/80">
          <div className="rounded-[16px] border-2 border-dashed border-accent bg-background-light px-8 py-6 text-sm font-medium text-content">
            Drop a PDF brief for your agent
          </div>
        </div>
      )}

      <div
        className={`mx-auto w-full max-w-[1180px] px-4 pt-6 sm:px-6 sm:pt-8 ${
          playerVisible ? "pb-[152px]" : "pb-28"
        }`}
      >
        {urlDoor && (
          <UrlDoorPanel
            state={urlDoor}
            onRun={() => {
              if (urlDoor.kind === "pending") {
                void runUrlRequest(urlDoor.request, pendingReplyTo.current ?? undefined);
                pendingReplyTo.current = null;
              }
            }}
            onDismiss={() => {
              if (urlDoor.kind === "pending" && pendingReplyTo.current) {
                // Tell the tab that handed this over that nobody pressed Run.
                relayRef.current?.publishResult(pendingReplyTo.current, {
                  request: urlDoor.request,
                  status: "error",
                  error: { code: "USER_DENIED", message: "The user dismissed this call without running it." },
                  durationMs: 0,
                });
                pendingReplyTo.current = null;
              }
              setUrlDoor(null);
            }}
          />
        )}

        {(brief || briefNote) && (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-full bg-background-light px-4 py-2 text-xs ring-1 ring-neutral-175">
            <span className="min-w-0 flex-1 truncate">
              {brief ? (
                <>
                  <span className="font-medium text-content">Brief on this page</span>
                  <span className="text-content-subtle"> · {brief.fileName}</span>
                </>
              ) : (
                <span className="text-content-subtle">{briefNote}</span>
              )}
            </span>
            <button
              type="button"
              onClick={brief ? clearBrief : () => setBriefNote(null)}
              aria-label={brief ? "Remove brief" : "Dismiss"}
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-content-subtle transition hover:bg-neutral-100 hover:text-content"
            >
              <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          </div>
        )}

        <TrackLibrary
          tracks={library}
          totalCount={libraryTotal}
          status={libraryStatus}
          error={libraryError}
          highlighted={highlighted}
          matched={matched}
          onRefresh={() => void loadLibrary()}
        />

        {briefMatch && briefMatchVisible && (
          <BriefMatchesPanel
            match={briefMatch}
            inPlaylist={highlighted}
            busy={creatingFromBrief}
            onCreatePlaylist={createPlaylistFromBrief}
            onKeptChange={onKeptChange}
            onDismiss={() => setDismissedMatchId(briefMatch.executionId)}
          />
        )}
      </div>

      {/* Playlist dialog: the shared workspace for playlist work. */}
      {agentPlaylist && drawerVisible && (
        <PlaylistDialog
          playlist={agentPlaylist}
          libraryTracks={library}
          phase={playlistPhase}
          approvalMessage={approval?.message ?? null}
          onApprove={() => answerApproval(true)}
          onAlwaysApprove={() => answerApproval(true, true)}
          onDeny={() => answerApproval(false)}
          onAddTracks={addTracks}
          onRemoveTrack={removeTrack}
          onRename={renamePlaylist}
          onReorder={reorderPlaylist}
          onCreateShareLink={createShareLinkFromPage}
          onDelete={deletePlaylistFromPage}
          onClose={closeDialog}
          bottomInset={playerVisible ? BOTTOM_PLAYER_HEIGHT : 0}
        />
      )}
      {agentPlaylist && !drawerVisible && (
        <PlaylistPill playlist={agentPlaylist} onOpen={() => setDrawerOpen(true)} />
      )}

      {/* The one agent surface: minimised strip, expandable to the steps. */}
      <AgentActivityBox
        activities={activities}
        playlist={agentPlaylist}
        playlistInDrawer={drawerVisible}
        approval={approval}
        autoApprove={settings.autoApprove}
        onAnswerApproval={answerApproval}
        onToggleAutoApprove={() => updateLabSettings({ autoApprove: !settings.autoApprove })}
        onClearActivities={() => setActivities([])}
        history={history}
        onClearHistory={() => {
          clearHistory();
          setHistory([]);
        }}
        registrationStatus={registrationStatus}
        registeredTools={registeredTools}
        contextualTools={contextualTools}
        lifted={playerVisible}
      />

      {playerVisible && <BottomPlayer onClose={() => setPlayerVisible(false)} />}
    </div>
  );
}
