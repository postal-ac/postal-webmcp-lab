import { describe, expect, it, vi } from "vitest";

import { DynamicToolRegistry } from "./dynamic-tools";
import type { WebMcpModelContext, WebMcpToolDefinition } from "./types";

function tool(name: string, description: string, schema: unknown = { type: "object" }): WebMcpToolDefinition {
  return { name, description, inputSchema: schema as Record<string, unknown>, execute: async () => "{}" };
}

function fakeContext() {
  const signals = new Map<string, AbortSignal[]>();
  const registerTool = vi.fn(async (definition: WebMcpToolDefinition, options?: { signal?: AbortSignal }) => {
    const list = signals.get(definition.name) ?? [];
    if (options?.signal) list.push(options.signal);
    signals.set(definition.name, list);
  });
  const modelContext = {
    registerTool,
    getTools: vi.fn(async () => []),
    executeTool: vi.fn(),
  } as unknown as WebMcpModelContext;
  return { modelContext, registerTool, signals };
}

describe("DynamicToolRegistry", () => {
  it("registers new tools, leaves unchanged ones alone, and aborts the ones that disappear", async () => {
    const { modelContext, registerTool, signals } = fakeContext();
    const registry = new DynamicToolRegistry(modelContext);

    await registry.sync([tool("a", "A"), tool("b", "B")]);
    expect(registry.names()).toEqual(["a", "b"]);
    expect(registerTool).toHaveBeenCalledTimes(2);

    await registry.sync([tool("a", "A")]);
    expect(registry.names()).toEqual(["a"]);
    expect(registerTool).toHaveBeenCalledTimes(2);
    expect(signals.get("b")?.[0]?.aborted).toBe(true);
    expect(signals.get("a")?.[0]?.aborted).toBe(false);
  });

  it("re-registers a tool whose description changed, aborting the old registration first", async () => {
    const { modelContext, registerTool, signals } = fakeContext();
    const registry = new DynamicToolRegistry(modelContext);

    await registry.sync([tool("selection", "Nothing selected")]);
    await registry.sync([tool("selection", "2 tracks selected: Sunrise, Ember")]);

    expect(registerTool).toHaveBeenCalledTimes(2);
    expect(signals.get("selection")?.map((signal) => signal.aborted)).toEqual([true, false]);
    expect(registerTool.mock.calls[1]?.[0].description).toBe("2 tracks selected: Sunrise, Ember");
  });

  it("serialises overlapping syncs and notifies subscribers on change", async () => {
    const { modelContext } = fakeContext();
    const registry = new DynamicToolRegistry(modelContext);
    const seen: string[][] = [];
    registry.subscribe((snapshot) => seen.push(snapshot.names));

    const first = registry.sync([tool("a", "A")]);
    const second = registry.sync([tool("b", "B")]);
    await Promise.all([first, second]);

    expect(registry.names()).toEqual(["b"]);
    expect(seen).toEqual([[], ["a"], ["b"]]);
  });

  it("aborts everything on dispose and ignores later syncs", async () => {
    const { modelContext, registerTool, signals } = fakeContext();
    const registry = new DynamicToolRegistry(modelContext);
    await registry.sync([tool("a", "A")]);

    registry.dispose();
    await registry.sync([tool("c", "C")]);

    expect(signals.get("a")?.[0]?.aborted).toBe(true);
    expect(registry.names()).toEqual([]);
    expect(registerTool).toHaveBeenCalledTimes(1);
  });
});
