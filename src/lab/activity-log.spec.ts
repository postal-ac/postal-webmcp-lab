import { describe, expect, it } from "vitest";

import type { PostalWebMcpActivity } from "@/webmcp/types";

import { describeStep } from "./activity-log";

function step(
  partial: Partial<PostalWebMcpActivity> & Pick<PostalWebMcpActivity, "tool" | "status">,
): PostalWebMcpActivity {
  return { executionId: "x", startedAt: "2026-09-01T00:00:00.000Z", ...partial };
}

describe("describeStep", () => {
  it("narrates running calls in plain language, using the arguments", () => {
    expect(describeStep(step({ tool: "search_tracks", status: "running" }))).toBe(
      "Finding your newest tracks…",
    );
    expect(
      describeStep(
        step({
          tool: "search_tracks",
          status: "running",
          inputPreview: '{"query":"melodic","limit":5}',
        }),
      ),
    ).toBe("Searching for “melodic”…");
    expect(
      describeStep(
        step({
          tool: "create_playlist",
          status: "running",
          inputPreview: '{"name":"Ibiza Shortlist"}',
        }),
      ),
    ).toBe("Creating playlist “Ibiza Shortlist”…");
    expect(
      describeStep(
        step({
          tool: "add_tracks_to_playlist",
          status: "running",
          inputPreview: '{"playlistId":"p","trackIds":["a","b","c"]}',
        }),
      ),
    ).toBe("Adding 3 tracks…");
  });

  it("says the share link is waiting on the human while the gate is up", () => {
    const running = step({ tool: "create_share_link", status: "running" });
    expect(describeStep(running)).toBe("Creating a private share link…");
    expect(describeStep(running, { awaitingApproval: true })).toBe(
      "Waiting for your approval…",
    );
  });

  it("uses the tool's own summary once it has finished", () => {
    expect(
      describeStep(step({ tool: "search_tracks", status: "success", summary: "5 tracks found" })),
    ).toBe("5 tracks found");
    expect(
      describeStep(
        step({ tool: "create_share_link", status: "error", summary: "The user declined this action on the page." }),
      ),
    ).toBe("The user declined this action on the page.");
  });
});
