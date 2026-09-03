import { useEffect, useRef, useState } from "react";

import {
  POSTAL_WEBMCP_TOOL_NAMES,
  type PostalWebMcpToolName,
} from "@/webmcp/types";
import type { PostalWebMcpRegistrationStatus } from "@/webmcp/register-postal-tools";
import { webMcpMode } from "@/webmcp/polyfill";
import { CheckIcon } from "@/components/icons";

/**
 * Registration state, kept deliberately quiet: a dot and a phrase in the
 * activity box's footer, expanding *upward* into the tool list on demand. The
 * tools are plumbing for agents, not content for people — but problems
 * (unsupported browser, partial registration) stay visible in the collapsed
 * state, because those change what the page can do.
 */
export function ToolStatus({
  status,
  registeredTools,
  contextualTools = [],
}: {
  status: PostalWebMcpRegistrationStatus | "registering";
  registeredTools: PostalWebMcpToolName[];
  /** Tools registered live for what is on screen right now. */
  contextualTools?: string[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // The tool list is a peek, not a mode — a click anywhere else puts it away,
  // so it can never sit open over the catalogue while an agent works.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // The always-on set is static registrations plus whatever the contextual
  // layer keeps registered permanently (get_selected_tracks); the rest of the
  // contextual list is the "on screen now" extra.
  const alwaysOn = new Set<string>(POSTAL_WEBMCP_TOOL_NAMES);
  const registered = new Set<string>([
    ...registeredTools,
    ...contextualTools.filter((tool) => alwaysOn.has(tool)),
  ]);
  const onScreen = contextualTools.filter((tool) => !alwaysOn.has(tool));
  const mode = webMcpMode();
  const healthy = status === "registered";
  const readyCount = registered.size;

  const summary = healthy
    ? `${readyCount} tools ready${onScreen.length ? ` · +${onScreen.length} on screen` : ""}${
        mode === "native" ? "" : " · polyfill"
      }`
    : status === "unsupported"
      ? "No WebMCP in this browser"
      : status === "registering"
        ? "Registering tools…"
        : `${readyCount}/${POSTAL_WEBMCP_TOOL_NAMES.length} tools registered`;

  return (
    <div ref={containerRef} className="relative">
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-[260px] rounded-[14px] bg-background-light p-2 shadow-[0_12px_32px_rgba(24,24,24,0.12)] ring-1 ring-neutral-175">
          <p className="px-2 pb-1.5 pt-1 text-[11px] font-medium text-content">
            Tools available to agents
          </p>
          <div className="grid">
            {POSTAL_WEBMCP_TOOL_NAMES.map((tool) => (
              <div
                key={tool}
                className="flex items-center gap-2 rounded-[8px] px-2 py-1 text-[11px] text-content-subtle"
              >
                <span
                  aria-hidden="true"
                  className={`flex size-3.5 items-center justify-center rounded-full ${
                    registered.has(tool) ? "bg-success/15 text-success" : "bg-neutral-100 text-content-subtle"
                  }`}
                >
                  {registered.has(tool) && <CheckIcon className="size-2" />}
                </span>
                <span className="font-mono">{tool}</span>
              </div>
            ))}
          </div>
          <p className="px-2 pb-1 pt-2 text-[11px] font-medium text-content">
            For what is on screen now
          </p>
          {onScreen.length ? (
            <div className="grid">
              {onScreen.map((tool) => (
                <div
                  key={tool}
                  className="flex items-center gap-2 rounded-[8px] px-2 py-1 text-[11px] text-content-subtle"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-3.5 items-center justify-center rounded-full bg-accent-muted text-accent"
                  >
                    <CheckIcon className="size-2" />
                  </span>
                  <span className="font-mono">{tool}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-2 pb-1 text-[11px] text-content-subtle">
              None — open a playlist or match a brief and tools appear here.
            </p>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex items-center gap-2 text-left"
      >
        <span
          aria-hidden="true"
          className={`size-1.5 shrink-0 rounded-full ${
            healthy
              ? "bg-success"
              : status === "registering"
                ? "animate-pulse bg-info"
                : "bg-danger"
          }`}
        />
        <span className="truncate text-[11px] text-content-subtle">{summary}</span>
      </button>
    </div>
  );
}
