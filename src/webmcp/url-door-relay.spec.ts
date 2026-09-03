import { describe, expect, it, vi } from "vitest";

import { createUrlDoorRelay, type ChannelLike } from "./url-door-relay";

/** In-memory BroadcastChannel: every channel from one bus hears the others. */
function bus() {
  const channels = new Set<FakeChannel>();
  class FakeChannel implements ChannelLike {
    listeners = new Set<(event: { data: unknown }) => void>();
    constructor() {
      channels.add(this);
    }
    postMessage(message: unknown) {
      for (const other of channels) {
        if (other === this) continue;
        for (const listener of other.listeners) queueMicrotask(() => listener({ data: message }));
      }
    }
    addEventListener(_: "message", listener: (event: { data: unknown }) => void) {
      this.listeners.add(listener);
    }
    removeEventListener(_: "message", listener: (event: { data: unknown }) => void) {
      this.listeners.delete(listener);
    }
    close() {
      channels.delete(this);
    }
  }
  return () => new FakeChannel();
}

const request = { tool: "search_tracks", input: { limit: 3 } };

describe("url door relay", () => {
  it("runs locally when no other Lab tab answers", async () => {
    const relay = createUrlDoorRelay({ onRequest: vi.fn(), onResult: vi.fn() }, bus());
    await expect(relay.forward(request)).resolves.toBe("local");
    relay.close();
  });

  it("hands the request to an open tab and receives its result back", async () => {
    const make = bus();
    const existingHandlers = { onRequest: vi.fn(), onResult: vi.fn() };
    const existing = createUrlDoorRelay(existingHandlers, make);
    const openedHandlers = { onRequest: vi.fn(), onResult: vi.fn() };
    const opened = createUrlDoorRelay(openedHandlers, make);

    await expect(opened.forward(request)).resolves.toBe("forwarded");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(existingHandlers.onRequest).toHaveBeenCalledWith(request, opened.tabId);
    expect(openedHandlers.onRequest).not.toHaveBeenCalled();

    const outcome = { request, status: "success" as const, result: { tracks: [] }, durationMs: 1 };
    existing.publishResult(opened.tabId, outcome);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(openedHandlers.onResult).toHaveBeenCalledWith(outcome);
    expect(existingHandlers.onResult).not.toHaveBeenCalled();

    existing.close();
    opened.close();
  });

  it("degrades to local when BroadcastChannel is unavailable", async () => {
    const relay = createUrlDoorRelay({ onRequest: vi.fn(), onResult: vi.fn() }, () => null);
    await expect(relay.forward(request)).resolves.toBe("local");
  });
});
