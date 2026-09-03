import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("registerPostalWebMCPTools", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is a no-op when WebMCP is unsupported", async () => {
    const { registerPostalWebMCPTools } = await import("./register-postal-tools");

    await expect(registerPostalWebMCPTools()).resolves.toMatchObject({
      status: "unsupported",
      registeredTools: [],
    });
  });

  it("registers the thirteen static tools once, without a userId input, and unregisters by signal", async () => {
    const definitions: any[] = [];
    const signals: AbortSignal[] = [];
    const modelContext = {
      registerTool: vi.fn(async (tool, options) => {
        definitions.push(tool);
        signals.push(options.signal);
      }),
    };
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: modelContext,
    });
    const { registerPostalWebMCPTools } = await import("./register-postal-tools");

    const first = await registerPostalWebMCPTools();
    const second = await registerPostalWebMCPTools();

    expect(first.status).toBe("registered");
    expect(first.registeredTools).toHaveLength(13);
    expect(modelContext.registerTool).toHaveBeenCalledTimes(13);
    expect(JSON.stringify(definitions.map((tool) => tool.inputSchema))).not.toContain(
      "userId",
    );
    first.cleanup();
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
    second.cleanup();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("does not register anything when the feature flag is off", async () => {
    vi.stubEnv("VITE_WEBMCP_ENABLED", "false");
    const registerTool = vi.fn();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool },
    });
    const { registerPostalWebMCPTools } = await import("./register-postal-tools");

    await expect(registerPostalWebMCPTools()).resolves.toMatchObject({
      status: "disabled",
    });
    expect(registerTool).not.toHaveBeenCalled();
  });
});
