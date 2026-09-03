import { describe, expect, it } from "vitest";

import { buildBriefPrompt } from "./brief-reader";

describe("buildBriefPrompt", () => {
  it("wraps the brief with instructions", () => {
    const prompt = buildBriefPrompt("Five electronic tracks please.");
    expect(prompt).toContain("--- BRIEF ---");
    expect(prompt).toContain("Five electronic tracks please.");
  });

  it("truncates very long briefs for the on-device context window", () => {
    const prompt = buildBriefPrompt("x".repeat(10_000));
    expect(prompt.length).toBeLessThan(4600);
    expect(prompt.endsWith("…")).toBe(true);
  });
});
