export type PostalCapabilityErrorCode =
  | "UNAUTHENTICATED"
  | "TRACK_NOT_FOUND"
  | "PLAYLIST_NOT_FOUND"
  | "ACCESS_DENIED"
  | "INVALID_INPUT"
  | "API_ERROR"
  | "USER_DENIED"
  | "INSUFFICIENT_CREDITS"
  | "WEBMCP_UNAVAILABLE";

export class PostalCapabilityError extends Error {
  constructor(
    public readonly code: PostalCapabilityErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PostalCapabilityError";
  }
}

export function toPostalCapabilityError(
  error: unknown,
  fallbackCode: PostalCapabilityErrorCode = "API_ERROR",
): PostalCapabilityError {
  if (error instanceof PostalCapabilityError) return error;

  const candidate = error as {
    message?: unknown;
    messageCode?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const messageCode = String(candidate?.messageCode ?? "").toLowerCase();
  const status = Number(candidate?.statusCode ?? candidate?.status ?? 0);
  const message =
    typeof candidate?.message === "string"
      ? candidate.message
      : "Postal could not complete this request.";

  if (status === 401 || messageCode.includes("unauth")) {
    return new PostalCapabilityError("UNAUTHENTICATED", message, error);
  }
  if (status === 403 || messageCode.includes("authoriz")) {
    return new PostalCapabilityError("ACCESS_DENIED", message, error);
  }
  // Postal's credit gate refuses metered AI calls before doing any work with
  // messageCode `not_enough_credits` — a state the agent should relay to the
  // user ("top up"), not retry.
  if (messageCode.includes("not_enough_credits")) {
    return new PostalCapabilityError("INSUFFICIENT_CREDITS", message, error);
  }
  if (
    messageCode.includes("invalid_track") ||
    (messageCode.includes("track") && messageCode.includes("not"))
  ) {
    return new PostalCapabilityError("TRACK_NOT_FOUND", message, error);
  }
  if (
    messageCode.includes("pack_not_found") ||
    messageCode.includes("playlist_not_found") ||
    messageCode.includes("not_collaborative_playlist")
  ) {
    return new PostalCapabilityError("PLAYLIST_NOT_FOUND", message, error);
  }

  return new PostalCapabilityError(fallbackCode, message, error);
}

export function unwrapPostalResponse<T>(
  response: unknown,
  fallbackCode: PostalCapabilityErrorCode = "API_ERROR",
): T {
  if (response == null) {
    throw new PostalCapabilityError(
      fallbackCode,
      "Postal did not return a response. Please try again.",
    );
  }

  const envelope = response as {
    data?: T;
    status?: number;
    statusCode?: number;
    message?: unknown;
    messageCode?: unknown;
    error?: unknown;
  };
  const status = Number(envelope.statusCode ?? envelope.status ?? 200);
  const hasError =
    status >= 400 ||
    envelope.error != null ||
    (typeof envelope.messageCode === "string" && status !== 200);

  if (hasError) throw toPostalCapabilityError(envelope, fallbackCode);
  return (envelope.data !== undefined ? envelope.data : response) as T;
}
