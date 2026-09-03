import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiPost } from "@/postal/client";

import { inferBriefConstraints, matchBrief } from "./match-brief";

vi.mock("@/postal/client", () => ({ apiPost: vi.fn() }));
vi.mock("../auth", () => ({
  requireAuthenticatedPostalSession: vi.fn(async () => ({ id: "current-user" })),
}));

const BRIEF =
  "Netflix drama, closing scene. Warm, melodic electronic, no vocals, 100-115 BPM, builds slowly to a hopeful ending.";

const funnelResponse = {
  data: {
    briefParsed: true,
    brief: { artist: null, summary: "Warm melodic electronic, instrumental, 100–115 BPM" },
    candidatePoolSize: 212,
    historyId: "hist-1",
    orderedTracks: [
      {
        id: "track-a",
        name: "Sunrise.wav",
        artists: ["Postal Artist"],
        genres: ["Electronic"],
        moods: ["Hopeful"],
        duration: 214,
        playbackLink: "https://cdn.example/a.mp3",
        downloadLink: null,
        audio_profile: { cover: "https://cdn.example/a.jpg", bpm: 108, key: "A minor" },
        match: {
          score: 0.91,
          reason: "Instrumental, 108 BPM, slow build with a bright final section.",
          components: {},
          top_tags: ["cinematic"],
        },
      },
      {
        id: "track-b",
        name: "Ember",
        artists: [],
        genres: [],
        moods: [],
        duration: null,
        playbackLink: null,
        downloadLink: "https://cdn.example/b.wav",
        audio_profile: { cover: null, bpm: null, key: null },
        match: { score: 1.4, reason: ["no vocals", "110 BPM"], components: {}, top_tags: [] },
      },
    ],
  },
};

describe("matchBrief", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the brief to Postal's brief funnel and returns ranked, playable matches with reasons", async () => {
    vi.mocked(apiPost).mockResolvedValue(funnelResponse);

    const result = await matchBrief({ brief: BRIEF, source: "Gmail", limit: 5 });

    // The brief states "no vocals, 100-115 BPM": both become hard filters.
    expect(apiPost).toHaveBeenCalledWith(
      "/smart-playlists/generate-from-brief",
      JSON.stringify({
        brief: BRIEF,
        limit: 5,
        constraints: { bpmRange: [100, 115], hasVocals: false },
        tuning: { vocalPreference: "instrumental" },
      }),
    );
    expect(vi.mocked(apiPost).mock.calls[0]?.[1]).not.toContain("userId");
    expect(result.matches).toEqual([
      expect.objectContaining({
        id: "track-a",
        rank: 1,
        title: "Sunrise.wav",
        artist: "Postal Artist",
        bpm: 108,
        key: "A minor",
        duration: 214,
        coverUrl: "https://cdn.example/a.jpg",
        playbackUrl: "https://cdn.example/a.mp3",
        score: 0.91,
        reason: "Instrumental, 108 BPM, slow build with a bright final section.",
        tags: ["Electronic", "Hopeful", "cinematic"],
      }),
      expect.objectContaining({
        id: "track-b",
        rank: 2,
        playbackUrl: "https://cdn.example/b.wav",
        score: 1,
        reason: "no vocals; 110 BPM",
      }),
    ]);
    expect(result.matches[1]).not.toHaveProperty("artist");
    expect(result.brief).toEqual({
      summary: "Warm melodic electronic, instrumental, 100–115 BPM",
      artist: null,
      parsed: true,
      source: "Gmail",
      excerpt: BRIEF,
      characters: BRIEF.length,
      applied: { bpmRange: [100, 115], instrumental: true, fromBriefText: true },
    });
    expect(result.candidatePool).toBe(212);
    expect(result.historyId).toBe("hist-1");
  });

  it("passes exclusions through, caps the result at the limit, and reports an unparsed brief", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      data: {
        briefParsed: false,
        orderedTracks: funnelResponse.data.orderedTracks,
        historyId: null,
      },
    });

    const result = await matchBrief({
      brief: BRIEF,
      limit: 1,
      excludeTrackIds: ["track-z"],
    });

    expect(JSON.parse(vi.mocked(apiPost).mock.calls[0]?.[1] as string)).toEqual({
      brief: BRIEF,
      limit: 1,
      excludedIds: ["track-z"],
      constraints: { bpmRange: [100, 115], hasVocals: false },
      tuning: { vocalPreference: "instrumental" },
    });
    expect(result.matches).toHaveLength(1);
    expect(result.brief.parsed).toBe(false);
    expect(result.brief.summary).toBeNull();
    expect(result.historyId).toBeNull();
  });

  it("rejects a brief that is too short to be a brief before calling Postal", async () => {
    await expect(matchBrief({ brief: "upbeat" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("maps Postal's credit gate to a typed INSUFFICIENT_CREDITS error", async () => {
    vi.mocked(apiPost).mockRejectedValue({
      statusCode: 400,
      messageCode: "not_enough_credits",
      message: "Not enough credits: required 1, available 0",
    });

    await expect(matchBrief({ brief: BRIEF })).rejects.toMatchObject({
      code: "INSUFFICIENT_CREDITS",
      message: "Not enough credits: required 1, available 0",
    });
  });

  it("lets explicit filters override what the text says", async () => {
    vi.mocked(apiPost).mockResolvedValue(funnelResponse);

    const result = await matchBrief({ brief: BRIEF, bpmRange: [90, 120], instrumental: false });

    expect(JSON.parse(vi.mocked(apiPost).mock.calls[0]?.[1] as string)).toMatchObject({
      constraints: { bpmRange: [90, 120], hasVocals: true },
    });
    expect(result.brief.applied).toEqual({ bpmRange: [90, 120], instrumental: false, fromBriefText: false });
  });
});

describe("inferBriefConstraints", () => {
  it("reads BPM ranges, approximate tempos and vocal requirements from prose", () => {
    expect(inferBriefConstraints("Something 100–115 BPM, instrumental only")).toEqual({
      bpmRange: [100, 115],
      instrumental: true,
    });
    expect(inferBriefConstraints("around 124 bpm, female vocal")).toEqual({
      bpmRange: [119, 129],
      instrumental: false,
    });
    expect(inferBriefConstraints("uplifting, cinematic, no tempo given")).toEqual({});
  });
});
