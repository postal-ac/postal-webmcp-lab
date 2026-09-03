import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet } from "@/postal/client";

import { findSectionPosition, getWaveform, serializeWaveform } from "./get-waveform";

vi.mock("@/postal/client", () => ({ apiGet: vi.fn() }));
vi.mock("../auth", () => ({
  requireAuthenticatedPostalSession: vi.fn(async () => ({ id: "current-user" })),
}));

const payload = {
  data: {
    trackId: "t1",
    waveformStatus: "completed",
    waveform: {
      version: 1,
      durationSec: 200,
      channelMode: "mono",
      resolutions: { "256": [], "1024": [[-500, 250], [-1000, 900], [0, 0]], "4096": [] },
      rms: { "256": [], "1024": [], "4096": [] },
      markers: [
        { type: "section", startSec: 0, endSec: 20, label: "intro" },
        { type: "section", startSec: 20, endSec: 60, label: "verse" },
        { type: "section", startSec: 60, endSec: 90, label: "drop" },
        { type: "section", startSec: 72, label: "Best hook" },
        { type: "section", startSec: 60, label: "Biggest lift" },
        { type: "silence", startSec: 0, endSec: 1 },
        { type: "lyric", startSec: 21, label: "Some words" },
      ],
    },
  },
};

describe("getWaveform", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalises peaks to 0–1 and splits markers into sections and highlights", async () => {
    vi.mocked(apiGet).mockResolvedValue(payload);

    const waveform = await getWaveform({ trackId: "t1" });

    expect(apiGet).toHaveBeenCalledWith("/tracks/t1/waveform");
    expect(waveform.durationSec).toBe(200);
    expect(waveform.peaks).toEqual([0.5, 1, 0]);
    expect(waveform.sections.map((section) => section.label)).toEqual(["Intro", "Verse", "Drop"]);
    expect(waveform.highlights).toEqual([
      { label: "Biggest Lift", atSec: 60 },
      { label: "Best Hook", atSec: 72 },
    ]);
  });

  it("returns an empty, statused waveform when Postal has not generated one", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      data: { trackId: "t2", waveformStatus: "processing", waveform: null },
    });

    const waveform = await getWaveform({ trackId: "t2" });
    expect(waveform).toEqual({
      trackId: "t2",
      status: "processing",
      durationSec: 0,
      peaks: [],
      sections: [],
      highlights: [],
    });
  });

  it("falls back to the loudest stretch when there are no point markers", () => {
    const rms = Array.from({ length: 64 }, (_, index) => (index >= 40 && index < 48 ? 0.9 : 0.1));
    const waveform = serializeWaveform(
      "t3",
      { durationSec: 128, resolutions: { "1024": [] }, rms: { "1024": rms }, markers: [] },
      "completed",
    );
    expect(waveform.highlights).toEqual([{ label: "Loudest stretch", atSec: 80 }]);
  });
});

describe("findSectionPosition", () => {
  const waveform = {
    sections: [
      { label: "Intro", startSec: 0, endSec: 20 },
      { label: "Chorus", startSec: 40, endSec: 60 },
    ],
    highlights: [{ label: "Biggest Lift", atSec: 61 }],
  };

  it("resolves spoken names through highlights first, then sections, with aliases", () => {
    expect(findSectionPosition(waveform, "the drop")).toEqual({ label: "Biggest Lift", atSec: 61 });
    expect(findSectionPosition(waveform, "hook")).toEqual({ label: "Chorus", atSec: 40 });
    expect(findSectionPosition(waveform, "intro")).toEqual({ label: "Intro", atSec: 0 });
    expect(findSectionPosition(waveform, "bridge")).toBeNull();
  });
});
