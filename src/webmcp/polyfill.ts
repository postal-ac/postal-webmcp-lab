import type {
  RegisteredWebMcpTool,
  WebMcpModelContext,
  WebMcpToolDefinition,
} from "./types";

export type WebMcpMode = "native" | "polyfill";

let mode: WebMcpMode = "polyfill";

/**
 * WebMCP is not shipping in every browser yet — Brave, Safari and stable
 * Chrome expose no `document.modelContext` at all, and a page that simply
 * refuses to work there is impossible to develop against and impossible for a
 * reviewer to open.
 *
 * So: when the browser provides the API we use it untouched, and when it does
 * not we install a minimal same-page implementation of the three methods this
 * project uses. The polyfill is a local registry — it makes tools callable by
 * *this page* (the demo runner), never discoverable by an outside agent. The
 * UI says which of the two is in play; nothing here fakes agent support.
 */
export function installWebMcpPolyfill(): WebMcpMode {
  if (typeof document === "undefined") return "polyfill";

  if (document.modelContext?.registerTool) {
    mode = "native";
    return mode;
  }

  const tools = new Map<string, WebMcpToolDefinition>();

  // The real API fires `toolchange` whenever the registered set changes; the
  // Lab's contextual tools and agent manifest depend on it, so the polyfill
  // does too — as the `ontoolchange` handler property the bridge looks for.
  const fireToolChange = () => {
    const handler = (modelContext as { ontoolchange?: ((event: Event) => void) | null })
      .ontoolchange;
    handler?.(new Event("toolchange"));
  };

  const modelContext: WebMcpModelContext & { ontoolchange: ((event: Event) => void) | null } = {
    ontoolchange: null,

    async registerTool(tool, options) {
      tools.set(tool.name, tool);
      fireToolChange();
      // Mirror the real API's teardown contract, which the Lab relies on to
      // unregister when the component unmounts.
      options?.signal?.addEventListener(
        "abort",
        () => {
          if (tools.get(tool.name) === tool) tools.delete(tool.name);
          fireToolChange();
        },
        { once: true },
      );
    },

    async getTools() {
      return Array.from(tools.values()).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        origin: window.location.origin,
      }));
    },

    async executeTool(tool: RegisteredWebMcpTool, input, options) {
      const registered = tools.get(tool.name);
      if (!registered) throw new Error(`Unknown tool: ${tool.name}`);
      // Same contract as the browser's: arguments arrive as a JSON string and
      // reach the tool parsed. Objects are tolerated so the polyfill stays
      // easy to drive from a console.
      let args: unknown = input;
      if (typeof input === "string") {
        try {
          args = JSON.parse(input);
        } catch {
          throw new Error("Failed to parse input arguments");
        }
      }
      return registered.execute(args, options);
    },
  };

  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: modelContext,
  });

  mode = "polyfill";
  return mode;
}

export function webMcpMode(): WebMcpMode {
  return mode;
}
