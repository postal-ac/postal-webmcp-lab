import type { AgentTrackDetail } from "../types";

type UnknownRecord = Record<string, any>;

function relationNames(rows: unknown, relation: string): string[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row: UnknownRecord) =>
      String(row?.[relation]?.name ?? row?.[relation]?.code ?? "").trim(),
    )
    .filter(Boolean);
}

function directNames(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row: UnknownRecord) => String(row?.name ?? "").trim())
    .filter(Boolean);
}

function optionalNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function serializeAgentTrack(raw: UnknownRecord): AgentTrackDetail {
  const track = raw?.track && typeof raw.track === "object" ? raw.track : raw;
  const profile = track?.audio_profile ?? {};
  const genres = relationNames(profile.genres, "genre");
  const moods = relationNames(profile.moods, "mood");
  const instruments = relationNames(profile.instruments, "instrument");
  const tags = Array.from(
    new Set([
      ...genres,
      ...moods,
      ...instruments,
      ...relationNames(profile.types, "audioType"),
      ...relationNames(profile.vocals, "vocalType"),
      ...relationNames(profile.lyricThemes, "lyricTheme"),
      ...relationNames(profile.tags, "tag"),
      ...directNames(profile.additionalTags),
    ]),
  );
  const artist =
    String(profile.artist ?? "").trim() ||
    directNames(track.artists).join(", ") ||
    undefined;

  return {
    id: String(track.id),
    title: String(profile.title ?? track.name ?? "Untitled track"),
    ...(profile.cover ? { coverUrl: String(profile.cover) } : {}),
    ...(track.playbackLink || track.downloadLink
      ? { playbackUrl: String(track.playbackLink ?? track.downloadLink) }
      : {}),
    ...(artist ? { artist } : {}),
    ...(optionalNumber(profile.bpm) !== undefined
      ? { bpm: optionalNumber(profile.bpm) }
      : {}),
    ...(profile.key ? { key: String(profile.key) } : {}),
    ...(tags.length ? { tags } : {}),
    ...(optionalNumber(profile.duration) !== undefined
      ? { duration: optionalNumber(profile.duration) }
      : {}),
    ...(track.createdAt ? { createdAt: String(track.createdAt) } : {}),
    ...(profile.album ? { album: String(profile.album) } : {}),
    ...(profile.year ? { year: String(profile.year) } : {}),
    ...(genres.length ? { genres } : {}),
    ...(moods.length ? { moods } : {}),
    ...(instruments.length ? { instruments } : {}),
  };
}

export function searchableTrackText(track: AgentTrackDetail): string {
  return [
    track.title,
    track.artist,
    track.album,
    ...(track.tags ?? []),
    ...(track.genres ?? []),
    ...(track.moods ?? []),
    ...(track.instruments ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}
