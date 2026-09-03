import type { WebMcpModelContext, WebMcpToolDefinition } from "./types";

/**
 * Tools that come and go with the page. WebMCP registers a tool with an
 * `AbortSignal` and forgets it when the signal fires, and it fires
 * `toolchange` so agents re-read the list — that is the whole mechanism for
 * a tool set that tracks what is on screen. This registry owns one controller
 * per tool name and reconciles towards a desired list: new names register,
 * gone names abort, and a tool whose description changed (a live one: "3
 * tracks selected: …") is aborted and registered again, because the
 * description is what the agent reads to decide what to call.
 *
 * Registrations are serialised: a burst of selection clicks becomes a queue
 * of syncs, each starting from the state the previous one reached.
 */
export interface DynamicToolRegistrySnapshot {
  names: string[];
}

export class DynamicToolRegistry {
  private readonly live = new Map<
    string,
    { controller: AbortController; description: string; schema: string }
  >();
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(snapshot: DynamicToolRegistrySnapshot) => void>();
  private disposed = false;

  constructor(private readonly modelContext: WebMcpModelContext) {}

  /** Names currently registered, in registration order. */
  names(): string[] {
    return [...this.live.keys()];
  }

  subscribe(listener: (snapshot: DynamicToolRegistrySnapshot) => void): () => void {
    this.listeners.add(listener);
    listener({ names: this.names() });
    return () => this.listeners.delete(listener);
  }

  /** Reconcile towards `desired`. Resolves when the browser has the new set. */
  sync(desired: WebMcpToolDefinition[]): Promise<void> {
    this.queue = this.queue.then(() => this.apply(desired)).catch(() => {});
    return this.queue;
  }

  /** Abort every registration; further syncs are ignored. */
  dispose(): void {
    this.disposed = true;
    for (const entry of this.live.values()) entry.controller.abort();
    this.live.clear();
    this.notify();
  }

  private async apply(desired: WebMcpToolDefinition[]): Promise<void> {
    if (this.disposed) return;
    const wanted = new Map(desired.map((tool) => [tool.name, tool] as const));
    let changed = false;

    for (const [name, entry] of [...this.live]) {
      const next = wanted.get(name);
      const schema = next ? JSON.stringify(next.inputSchema) : "";
      if (next && next.description === entry.description && schema === entry.schema) continue;
      // Gone, or changed: drop the old registration before (re)adding.
      entry.controller.abort();
      this.live.delete(name);
      changed = true;
    }

    for (const tool of desired) {
      if (this.live.has(tool.name)) continue;
      const controller = new AbortController();
      try {
        await this.modelContext.registerTool(tool, { signal: controller.signal });
        this.live.set(tool.name, {
          controller,
          description: tool.description,
          schema: JSON.stringify(tool.inputSchema),
        });
        changed = true;
      } catch (error) {
        console.warn(`[WebMCP] Could not register contextual tool ${tool.name}`, error);
      }
    }

    if (changed) this.notify();
  }

  private notify() {
    const snapshot = { names: this.names() };
    for (const listener of this.listeners) listener(snapshot);
  }
}
