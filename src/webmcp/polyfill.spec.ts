import { beforeEach, describe, expect, it, vi } from "vitest";

import { installWebMcpPolyfill, webMcpMode } from "./polyfill";

describe("installWebMcpPolyfill", () => {
  beforeEach(() => {
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: undefined,
    });
  });

  it("defers to a browser that already implements WebMCP", () => {
    const native = { registerTool: vi.fn(), getTools: vi.fn(), executeTool: vi.fn() };
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: native,
    });

    expect(installWebMcpPolyfill()).toBe("native");
    expect(webMcpMode()).toBe("native");
    expect(document.modelContext).toBe(native);
  });

  it("registers, discovers and executes a tool when the browser has no WebMCP", async () => {
    expect(installWebMcpPolyfill()).toBe("polyfill");

    const execute = vi.fn(async (input: { q: string }) => ({ echoed: input.q }));
    await document.modelContext!.registerTool({
      name: "echo",
      description: "Echo the input",
      inputSchema: { type: "object" },
      execute: execute as WebMcpExecute,
    });

    const tools = await document.modelContext!.getTools();
    expect(tools.map((tool) => tool.name)).toEqual(["echo"]);

    // Arguments travel as a JSON string, exactly as the browser sends them.
    await expect(
      document.modelContext!.executeTool(tools[0], JSON.stringify({ q: "hello" })),
    ).resolves.toEqual({ echoed: "hello" });
    expect(execute).toHaveBeenCalledWith({ q: "hello" }, undefined);

    await expect(
      document.modelContext!.executeTool(tools[0], "not json"),
    ).rejects.toThrow("Failed to parse input arguments");
  });

  it("unregisters a tool when its AbortSignal fires", async () => {
    installWebMcpPolyfill();
    const controller = new AbortController();

    await document.modelContext!.registerTool(
      {
        name: "temporary",
        description: "Goes away",
        inputSchema: { type: "object" },
        execute: async () => ({}),
      },
      { signal: controller.signal },
    );
    expect(await document.modelContext!.getTools()).toHaveLength(1);

    controller.abort();
    expect(await document.modelContext!.getTools()).toHaveLength(0);
  });

  it("fires ontoolchange when a tool is registered and when its signal aborts", async () => {
    installWebMcpPolyfill();
    const context = document.modelContext as typeof document.modelContext & {
      ontoolchange: ((event: Event) => void) | null;
    };
    const changes: string[][] = [];
    context.ontoolchange = () => {
      void context.getTools().then((tools) => changes.push(tools.map((tool) => tool.name)));
    };

    const controller = new AbortController();
    await context.registerTool(
      { name: "live", description: "d", inputSchema: {}, execute: async () => "{}" },
      { signal: controller.signal },
    );
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(changes).toEqual([["live"], []]);
  });
});

type WebMcpExecute = (input: any) => Promise<unknown>;
