import type { AgentTrackDetail } from "@/capabilities/types";

/**
 * Tracks the user has ticked in the catalogue. A module-level store rather
 * than React state because the `get_selected_tracks` tool reads it from
 * outside the component tree — this is the page half of a shared workspace:
 * the human points at tracks with the mouse, the agent reads the pointing.
 */
type Listener = (selected: AgentTrackDetail[]) => void;

const selected = new Map<string, AgentTrackDetail>();
const listeners = new Set<Listener>();

function notify() {
  const snapshot = [...selected.values()];
  for (const listener of listeners) listener(snapshot);
}

export function subscribeSelection(listener: Listener): () => void {
  listeners.add(listener);
  listener([...selected.values()]);
  return () => listeners.delete(listener);
}

export function toggleSelected(track: AgentTrackDetail): void {
  if (selected.has(track.id)) selected.delete(track.id);
  else selected.set(track.id, track);
  notify();
}

export function clearSelection(): void {
  selected.clear();
  notify();
}

export function selectedTracks(): AgentTrackDetail[] {
  return [...selected.values()];
}

export function isSelected(id: string): boolean {
  return selected.has(id);
}
