import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiPost, PlaylistModeType } from "@/postal/client";

import { createShareLink } from "./create-share-link";

vi.mock("@/postal/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/postal/client")>()),
  apiPost: vi.fn(),
}));
vi.mock("../auth", () => ({
  requireAuthenticatedPostalSession: vi.fn(async () => ({ id: "current-user" })),
}));

describe("createShareLink", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the ownership-checked private-mode endpoint and sends no email data", async () => {
    vi.mocked(apiPost).mockResolvedValue({ data: { link: "private-token" } });

    const result = await createShareLink({ playlistId: "playlist-1" });

    expect(apiPost).toHaveBeenCalledWith(
      `/packs/playlist-1/modes/${PlaylistModeType.PRIVATE}/link`,
    );
    expect(result).toEqual({
      playlistId: "playlist-1",
      shareUrl: "https://postal.music/playlist/playlist-1?token=private-token",
    });
  });

  it("maps another user's playlist to a clean inaccessible error", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      statusCode: 403,
      messageCode: "not_authorized",
      message: "Not authorized",
    });

    await expect(createShareLink({ playlistId: "someone-elses" })).rejects.toMatchObject({
      code: "ACCESS_DENIED",
    });
  });

  it("reports a backend/network failure separately from a missing playlist", async () => {
    vi.mocked(apiPost).mockResolvedValue(undefined);

    await expect(createShareLink({ playlistId: "playlist-1" })).rejects.toMatchObject({
      code: "API_ERROR",
    });
  });
});
