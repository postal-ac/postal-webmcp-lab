/**
 * A local trail of what has happened on this page: every finished tool
 * execution. Entries of kind "run" date from the removed in-page composer
 * and are still rendered so older trails stay readable.
 *
 * Lives in `localStorage`, so it survives reloads but never leaves this
 * browser profile — it is a debugging and demo aid, not telemetry. Note that
 * it is per-browser, not per-account: on a shared machine, Clear is the
 * privacy control.
 */

export type HistoryEntry =
  | {
      kind: "tool";
      at: string;
      tool: string;
      status: "success" | "error";
      durationMs?: number;
      summary?: string;
      errorCode?: string;
      inputPreview?: string;
      /** "agent" = an outside caller; "page" = the page's own controls. */
      via: "page" | "agent";
    }
  | {
      kind: "run";
      at: string;
      prompt: string;
      ok: boolean;
      message?: string;
      playlistName?: string;
      shareUrl?: string;
    };

const STORAGE_KEY = "postal-webmcp-history-v1";
const MAX_ENTRIES = 300;

export function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendHistory(entry: HistoryEntry): HistoryEntry[] {
  const entries = [...readHistory(), entry].slice(-MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota or private-window failures must never break a tool call.
  }
  return entries;
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — reads already tolerate absence.
  }
}
