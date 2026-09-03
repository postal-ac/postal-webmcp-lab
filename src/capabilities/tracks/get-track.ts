import { z } from "zod";

import { apiGet } from "@/postal/client";

import { requireAuthenticatedPostalSession } from "../auth";
import { PostalCapabilityError, toPostalCapabilityError } from "../errors";
import type { GetTrackInput } from "../types";
import { serializeAgentTrack } from "./track-serializer";

const inputSchema = z.object({ trackId: z.string().trim().min(1).max(200) });

export async function getTrack(input: GetTrackInput) {
  await requireAuthenticatedPostalSession();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PostalCapabilityError("INVALID_INPUT", "A trackId is required.");
  }

  try {
    const response = await apiGet(`/tracks/details/${encodeURIComponent(parsed.data.trackId)}`);
    const track = response?.data ?? response;
    if (!track?.id) {
      throw new PostalCapabilityError(
        "TRACK_NOT_FOUND",
        "The requested track does not exist or is not accessible.",
      );
    }
    return serializeAgentTrack(track);
  } catch (error) {
    throw toPostalCapabilityError(error, "TRACK_NOT_FOUND");
  }
}
