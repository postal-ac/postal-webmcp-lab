/**
 * The brief the user dropped onto the page, held as shared workspace state —
 * the same pattern as the checkbox selection. The human contributes the
 * document by dropping it here; the agent reads it through the `get_brief`
 * tool. Files never travel through the tool protocol (it is JSON only), so
 * the page extracts the text and the agent reads the extraction.
 */
export interface PageBrief {
  fileName: string;
  text: string;
  droppedAt: string;
}

type Listener = (brief: PageBrief | null) => void;

let current: PageBrief | null = null;
const listeners = new Set<Listener>();

export function setBrief(brief: PageBrief): void {
  current = brief;
  for (const listener of listeners) listener(current);
}

export function clearBrief(): void {
  current = null;
  for (const listener of listeners) listener(null);
}

export function getBrief(): PageBrief | null {
  return current;
}

export function subscribeBrief(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}
