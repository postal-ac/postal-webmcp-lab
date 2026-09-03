import { useState } from "react";

import { CloseIcon, StatusDot } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  buildUrlToolLink,
  describeOutcomeForText,
  URL_DOOR_RESULT_ID,
  type UrlDoorOutcome,
  type UrlToolRequest,
} from "@/webmcp/url-door";

/**
 * What the URL door shows. Two states matter to two readers:
 *
 * - A pending call that needs the person's Run click (a write, or a metered
 *   read). The card says what the link wants to do; the human decides.
 * - A finished call. The result is laid out as text first — this panel is
 *   built for agents that read the page and nothing else — with the full
 *   JSON in a `<script type="application/json">` element for the tidy ones,
 *   and the exact URL shape for the next call spelled out.
 */
export type UrlDoorState =
  | { kind: "forwarded"; request: UrlToolRequest }
  | { kind: "pending"; request: UrlToolRequest; reason: string }
  | { kind: "running"; request: UrlToolRequest }
  | { kind: "done"; outcome: UrlDoorOutcome }
  | { kind: "invalid"; message: string };

const MAX_INLINE_JSON = 12_000;

export function UrlDoorPanel({
  state,
  onRun,
  onDismiss,
}: {
  state: UrlDoorState;
  onRun: () => void;
  onDismiss: () => void;
}) {
  const [showJson, setShowJson] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const exampleLink = buildUrlToolLink(origin, pathname, "search_tracks", { limit: 5 });

  return (
    <section
      aria-label="Tool call from URL"
      data-url-door={state.kind}
      className="box-in mb-5 overflow-hidden rounded-[16px] bg-background-light ring-1 ring-neutral-175"
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          {state.kind === "pending" && (
            <>
              <p className="text-sm font-medium text-content">
                A link wants to run <code className="font-mono text-[12px]">{state.request.tool}</code>
              </p>
              <p className="mt-1 text-xs text-content-subtle">{state.reason}</p>
              <pre className="mt-2 max-h-28 overflow-auto rounded-[10px] bg-neutral-50 px-3 py-2 text-[11px] text-content">
                {JSON.stringify(state.request.input, null, 2)}
              </pre>
              <div className="mt-3 flex items-center gap-2">
                <Button size="compact" onClick={onRun}>
                  Run {state.request.tool}
                </Button>
                <button
                  type="button"
                  onClick={onDismiss}
                  className="px-2 text-xs font-medium text-content-subtle transition hover:text-content"
                >
                  Ignore
                </button>
              </div>
            </>
          )}

          {state.kind === "forwarded" && (
            <p className="flex items-center gap-2 text-sm text-content">
              <StatusDot state="busy" />
              Handed <code className="font-mono text-[12px]">{state.request.tool}</code> to the Postal
              tab you already had open — the result shows there, and here once it lands. You can
              close this tab.
            </p>
          )}

          {state.kind === "running" && (
            <p className="flex items-center gap-2 text-sm text-content">
              <StatusDot state="busy" />
              Running <code className="font-mono text-[12px]">{state.request.tool}</code> from the URL…
            </p>
          )}

          {state.kind === "invalid" && (
            <>
              <p className="text-sm font-medium text-danger">That URL is not a valid tool call</p>
              <p className="mt-1 text-xs text-content-subtle">{state.message}</p>
            </>
          )}

          {state.kind === "done" && (
            <>
              <p className="flex items-center gap-2 text-sm font-medium text-content">
                <StatusDot state={state.outcome.status === "success" ? "success" : "error"} />
                Tool call from URL
                {state.outcome.request.id ? (
                  <span className="text-content-subtle">· id {state.outcome.request.id}</span>
                ) : null}
                <span className="ml-auto text-[11px] tabular-nums text-content-subtle">
                  {state.outcome.durationMs} ms
                </span>
              </p>
              {/* Text first: agents that read the page get the whole outcome here. */}
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-neutral-50 px-3 py-2 text-[11px] leading-relaxed text-content">
                {describeOutcomeForText(state.outcome, origin, pathname).slice(0, MAX_INLINE_JSON)}
                {describeOutcomeForText(state.outcome, origin, pathname).length > MAX_INLINE_JSON
                  ? `\n… (${describeOutcomeForText(state.outcome, origin, pathname).length - MAX_INLINE_JSON} more characters; full JSON in #${URL_DOOR_RESULT_ID})`
                  : ""}
              </pre>
              <script
                type="application/json"
                id={URL_DOOR_RESULT_ID}
                dangerouslySetInnerHTML={{ __html: JSON.stringify(state.outcome).replace(/</g, "\\u003c") }}
              />
              <button
                type="button"
                onClick={() => setShowJson((current) => !current)}
                className="mt-2 text-[11px] font-medium text-content-subtle underline underline-offset-2 hover:text-content"
              >
                {showJson ? "Hide" : "Show"} pretty JSON
              </button>
              {showJson && (
                <pre className="mt-2 max-h-72 overflow-auto rounded-[10px] bg-neutral-50 px-3 py-2 text-[11px] text-content">
                  {JSON.stringify(state.outcome.result ?? state.outcome.error, null, 2)}
                </pre>
              )}
            </>
          )}

          <p className="mt-3 text-[11px] text-content-subtle">
            For agents that can only open URLs and read text: call any tool with{" "}
            <code className="break-all font-mono">{exampleLink}</code>. Free read-only tools run on
            arrival; writes and metered calls wait for a Run click here.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-content-subtle transition hover:bg-neutral-100 hover:text-content"
        >
          <CloseIcon className="size-3" />
        </button>
      </div>
    </section>
  );
}
