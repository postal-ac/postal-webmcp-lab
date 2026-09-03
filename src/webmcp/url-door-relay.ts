import type { UrlDoorOutcome, UrlToolRequest } from "./url-door";

/**
 * The URL door across tabs.
 *
 * An agent that opens a `#tool=` URL from outside the browser (a shell
 * `open`, an OS-level URL handler) gets a *new* tab, while the tab it can
 * read is the one already showing the Lab. If each tab handled its own hash,
 * the result would appear where the agent cannot see it. So a freshly opened
 * tab first asks, over a same-origin BroadcastChannel, whether another Lab
 * tab is open; if one answers, the call is handed to that tab — it runs the
 * tool, shows the pending card or the result, and posts the outcome back so
 * the new tab can show it too. Only when no other tab answers does the new
 * tab run the call itself.
 *
 * Same origin only, by construction: BroadcastChannel never crosses origins.
 */
export const URL_DOOR_CHANNEL = "postal-url-door";
const PROBE_WAIT_MS = 200;

type Message =
  | { type: "probe"; from: string }
  | { type: "here"; from: string; to: string }
  | { type: "request"; from: string; to: string; request: UrlToolRequest }
  | { type: "result"; from: string; to: string; outcome: UrlDoorOutcome };

export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  close(): void;
}

export interface UrlDoorRelay {
  /** This tab's id, echoed in messages. */
  tabId: string;
  /** Try to hand the request to an already-open Lab tab. */
  forward(request: UrlToolRequest): Promise<"forwarded" | "local">;
  /** Tell the tab that forwarded a request how it ended. */
  publishResult(to: string, outcome: UrlDoorOutcome): void;
  close(): void;
}

export function createUrlDoorRelay(
  handlers: {
    /** Another tab handed us a request; `replyTo` is that tab's id. */
    onRequest: (request: UrlToolRequest, replyTo: string) => void;
    /** A request we forwarded has finished elsewhere. */
    onResult: (outcome: UrlDoorOutcome) => void;
  },
  makeChannel: () => ChannelLike | null = defaultChannel,
): UrlDoorRelay {
  const channel = makeChannel();
  const tabId = crypto.randomUUID();
  if (!channel) {
    return {
      tabId,
      forward: async () => "local",
      publishResult: () => {},
      close: () => {},
    };
  }

  let pendingProbe: ((from: string) => void) | null = null;

  const onMessage = (event: { data: unknown }) => {
    const message = event.data as Message | null;
    if (!message || typeof message !== "object" || !("type" in message)) return;
    switch (message.type) {
      case "probe":
        if (message.from !== tabId) {
          channel.postMessage({ type: "here", from: tabId, to: message.from } satisfies Message);
        }
        break;
      case "here":
        if (message.to === tabId) pendingProbe?.(message.from);
        break;
      case "request":
        if (message.to === tabId) handlers.onRequest(message.request, message.from);
        break;
      case "result":
        if (message.to === tabId) handlers.onResult(message.outcome);
        break;
    }
  };
  channel.addEventListener("message", onMessage);

  return {
    tabId,
    async forward(request) {
      const target = await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => {
          pendingProbe = null;
          resolve(null);
        }, PROBE_WAIT_MS);
        pendingProbe = (from) => {
          clearTimeout(timer);
          pendingProbe = null;
          resolve(from);
        };
        channel.postMessage({ type: "probe", from: tabId } satisfies Message);
      });
      if (!target) return "local";
      channel.postMessage({ type: "request", from: tabId, to: target, request } satisfies Message);
      return "forwarded";
    },
    publishResult(to, outcome) {
      channel.postMessage({ type: "result", from: tabId, to, outcome } satisfies Message);
    },
    close() {
      channel.removeEventListener("message", onMessage);
      channel.close();
    },
  };
}

function defaultChannel(): ChannelLike | null {
  if (typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(URL_DOOR_CHANNEL) as unknown as ChannelLike;
}
