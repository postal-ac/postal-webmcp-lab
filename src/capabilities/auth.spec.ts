import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveClientSession } from "@/postal/session";

import { requireAuthenticatedPostalSession } from "./auth";

vi.mock("@/postal/session", () => ({ resolveClientSession: vi.fn() }));

describe("requireAuthenticatedPostalSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an unauthenticated browser session", async () => {
    vi.mocked(resolveClientSession).mockResolvedValue(null);

    await expect(requireAuthenticatedPostalSession()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("returns the current session without accepting a user ID input", async () => {
    const user = { id: "signed-in-user", email: "demo@postal.music" };
    vi.mocked(resolveClientSession).mockResolvedValue(user);

    await expect(requireAuthenticatedPostalSession()).resolves.toBe(user);
  });
});
