/**
 * Page-level Lab settings, persisted per browser profile. The one setting so
 * far — auto-approve — turns the human approval gate on consequential tool
 * calls into a standing grant, so an outside agent can run the full workflow
 * without a person clicking Approve mid-run. It is the page's own consent
 * dial: granted and revoked here, never by the agent.
 */
export interface LabSettings {
  /** Approve consequential tool calls (share links) without asking. */
  autoApprove: boolean;
}

const STORAGE_KEY = "postal-webmcp-settings-v1";
const DEFAULTS: LabSettings = { autoApprove: false };

type Listener = (settings: LabSettings) => void;

const listeners = new Set<Listener>();

export function readLabSettings(): LabSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      ...DEFAULTS,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function updateLabSettings(patch: Partial<LabSettings>): LabSettings {
  const next = { ...readLabSettings(), ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or private-window failures must never break the page.
  }
  for (const listener of listeners) listener(next);
  return next;
}

export function subscribeLabSettings(listener: Listener): () => void {
  listeners.add(listener);
  listener(readLabSettings());
  return () => listeners.delete(listener);
}
