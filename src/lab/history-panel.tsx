import { StatusDot } from "@/components/icons";

import type { HistoryEntry } from "./history";

function timeOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date().toDateString() === date.toDateString();
  const clock = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return today
    ? clock
    : `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${clock}`;
}

function durationOf(ms?: number): string | null {
  if (ms === undefined) return null;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The local trail, newest first — what ran and how it went. Chrome-less: the
 * activity box supplies the card and the Clear / Back controls around it.
 * The raw tool call stays one hover away in the row's title.
 */
export function HistoryList({ entries }: { entries: HistoryEntry[] }) {
  if (!entries.length) {
    return (
      <p className="px-4 py-8 text-center text-xs text-content-subtle">
        Nothing yet. Tool calls will show up here.
      </p>
    );
  }

  return (
    <ol className="divide-y divide-neutral-100">
      {[...entries].reverse().map((entry, index) => {
        const ok = entry.kind === "tool" ? entry.status === "success" : entry.ok;
        const title =
          entry.kind === "tool"
            ? `${entry.tool}${entry.inputPreview ? ` ${entry.inputPreview}` : ""}`
            : entry.prompt;
        const label =
          entry.kind === "tool"
            ? (entry.summary ?? entry.errorCode ?? entry.tool)
            : `“${entry.prompt}”`;
        const detail =
          entry.kind === "tool"
            ? durationOf(entry.durationMs)
            : entry.ok
              ? [entry.playlistName, entry.shareUrl && "share link created"]
                  .filter(Boolean)
                  .join(" · ") || "Completed"
              : (entry.message ?? "Failed");
        return (
          <li
            key={`${entry.at}-${index}`}
            title={title}
            className="flex items-center gap-3 px-4 py-2.5"
          >
            <StatusDot state={ok ? "success" : "error"} />
            <div className="min-w-0 flex-1">
              <p className={`truncate text-xs ${ok ? "text-content" : "text-danger"}`}>{label}</p>
              {entry.kind === "run" && detail && (
                <p className="truncate text-[11px] text-content-subtle">{detail}</p>
              )}
            </div>
            <span className="shrink-0 text-[11px] tabular-nums text-content-subtle">
              {entry.kind === "tool" && detail ? `${detail} · ` : ""}
              {timeOf(entry.at)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
