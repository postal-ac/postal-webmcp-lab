export interface SearchTracksInput {
  query?: string;
  limit?: number;
  createdAfter?: string;
  tags?: string[];
}

export interface GetTrackInput {
  trackId: string;
}

export interface CreatePlaylistInput {
  name: string;
  description?: string;
}

export interface AddTracksToPlaylistInput {
  playlistId: string;
  trackIds: string[];
}

export interface CreateShareLinkInput {
  playlistId: string;
}

export interface AgentTrackSummary {
  id: string;
  title: string;
  coverUrl?: string;
  /** Presigned streaming URL (~1h expiry) for the browser-playable rendition. */
  playbackUrl?: string;
  artist?: string;
  bpm?: number;
  key?: string;
  tags?: string[];
  duration?: number;
  createdAt?: string;
}

export interface AgentTrackDetail extends AgentTrackSummary {
  album?: string;
  year?: string;
  genres?: string[];
  moods?: string[];
  instruments?: string[];
}

export interface MatchBriefInput {
  brief: string;
  /** Where the brief came from, for the page's narration ("Gmail", "brief.pdf"). */
  source?: string;
  limit?: number;
  excludeTrackIds?: string[];
  /** Hard tempo filter; inferred from the brief text when omitted. */
  bpmRange?: [number, number];
  /** Hard vocals filter; inferred from the brief text when omitted. */
  instrumental?: boolean;
}

/** One ranked pick for a brief: a playable track plus the ranker's verdict. */
export interface BriefMatch extends AgentTrackSummary {
  rank: number;
  /** 0–1 match score from Postal's ranker, when it reported one. */
  score?: number;
  /** The ranker's one-sentence explanation of why this track fits. */
  reason?: string;
}

export interface BriefMatchResult {
  matches: BriefMatch[];
  brief: {
    /** Postal's reading of the brief; null when the parser was unavailable. */
    summary: string | null;
    /** Reference artist the brief names, when it names one. */
    artist: string | null;
    parsed: boolean;
    source?: string;
    excerpt: string;
    characters: number;
    /** The hard filters that were sent, and whether they came from the text. */
    applied: { bpmRange?: [number, number]; instrumental?: boolean; fromBriefText: boolean };
  };
  /** How many library tracks were considered before ranking. */
  candidatePool?: number;
  /** Postal Co-Work history id for this generation, when it was saved. */
  historyId: string | null;
}
