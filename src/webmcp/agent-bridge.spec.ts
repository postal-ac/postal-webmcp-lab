import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_MANIFEST_ID,
  AGENT_NOTE_ID,
  BRIDGE_REQUEST_TYPE,
  BRIDGE_RESPONSE_TYPE,
  installAgentBridge,
  type BridgeResponse,
} from "./agent-bridge";
import type { WebMcpModelContext } from "./types";

function fakeContext(): WebMcpModelContext {
  const tools = [
    {
      name: "search_tracks",
      description: "Search the library.",
      inputSchema: { type: "object", properties: { limit: { type: "integer" } } },
    },
    { name: "create_playlist", description: "Create a playlist.", inputSchema: {} },
  ];
  return {
    registerTool: vi.fn(),
    getTools: vi.fn(async () => tools),
    executeTool: vi.fn(async (tool, input: string) => {
      // Same contract as the browser: arguments arrive as a JSON string.
      const parsed = JSON.parse(input);
      return JSON.stringify({ success: true, tool: tool.name, echoed: parsed });
    }),
  };
}

function bridgeCall(request: Record<string, unknown>): Promise<BridgeResponse> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as BridgeResponse;
      if (data?.type === BRIDGE_RESPONSE_TYPE && data.id === request.id) {
        window.removeEventListener("message", onMessage);
        resolve(data);
      }
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ type: BRIDGE_REQUEST_TYPE, ...request }, "*");
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("installAgentBridge", () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it("publishes a manifest and a hidden note describing the tools and the protocol", async () => {
    cleanup = installAgentBridge(fakeContext());
    await flush();

    const script = document.getElementById(AGENT_MANIFEST_ID) as HTMLScriptElement;
    expect(script.type).toBe("application/json");
    const manifest = JSON.parse(script.textContent ?? "{}");
    expect(manifest.protocol).toBe("webmcp");
    expect(manifest.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "search_tracks",
      "create_playlist",
    ]);
    expect(manifest.tools[0].inputSchema.properties.limit.type).toBe("integer");
    expect(manifest.access.bridge.request).toContain(BRIDGE_REQUEST_TYPE);
    expect(document.documentElement.getAttribute("data-webmcp-tools")).toBe("2");

    const note = document.getElementById(AGENT_NOTE_ID)!;
    expect(note.textContent).toContain("search_tracks, create_playlist");
    expect(note.textContent).toContain(`#${AGENT_MANIFEST_ID}`);
  });

  it("lists and calls tools over postMessage, stringifying input for executeTool", async () => {
    const context = fakeContext();
    cleanup = installAgentBridge(context);
    await flush();

    const list = await bridgeCall({ id: "l1", action: "list" });
    expect(list.ok).toBe(true);
    expect((list.result as { name: string }[]).map((tool) => tool.name)).toContain("search_tracks");

    const call = await bridgeCall({
      id: "c1",
      action: "call",
      tool: "search_tracks",
      input: { limit: 5 },
    });
    expect(call.ok).toBe(true);
    expect(call.result).toEqual({ success: true, tool: "search_tracks", echoed: { limit: 5 } });
    expect(vi.mocked(context.executeTool).mock.calls[0][1]).toBe('{"limit":5}');
  });

  it("answers unknown tools and malformed requests with typed errors", async () => {
    cleanup = installAgentBridge(fakeContext());
    await flush();

    const missing = await bridgeCall({ id: "m1", action: "call", tool: "delete_everything" });
    expect(missing.ok).toBe(false);
    expect(missing.error?.code).toBe("TOOL_NOT_FOUND");
    expect(missing.error?.message).toContain("search_tracks");

    const malformed = await bridgeCall({ id: "m2", action: "nope" });
    expect(malformed.ok).toBe(false);
    expect(malformed.error?.code).toBe("INVALID_INPUT");
  });

  it("ignores unrelated messages and removes everything on cleanup", async () => {
    const context = fakeContext();
    cleanup = installAgentBridge(context);
    await flush();

    window.postMessage({ type: "something-else", id: "x", action: "call", tool: "search_tracks" }, "*");
    await flush();
    expect(context.executeTool).not.toHaveBeenCalled();

    cleanup();
    expect(document.getElementById(AGENT_MANIFEST_ID)).toBeNull();
    expect(document.getElementById(AGENT_NOTE_ID)).toBeNull();
    expect(document.documentElement.hasAttribute("data-webmcp-tools")).toBe(false);
    cleanup = () => {};
  });
});
