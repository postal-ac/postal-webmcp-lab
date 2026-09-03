/**
 * The whole Postal API surface this project uses.
 *
 * Every call goes to the Lab's own origin (`/api/postal/...`), where the Worker
 * attaches the Postal access token and forwards to the real backend. That means
 * no CORS configuration on the Postal side, and no bearer token in the page.
 *
 * Responses keep Postal's envelope — `{ statusCode, messageCode, message, data }`
 * — because the capability layer's `unwrapPostalResponse` reads it.
 */
const PROXY_PREFIX = "/api/postal";

type SearchParams = Record<string, string | undefined>;

async function readEnvelope(response: Response): Promise<any> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw body ?? {
      statusCode: response.status,
      message: "Postal could not complete this request.",
    };
  }
  return body;
}

export async function apiGet(path: string, params: SearchParams = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, value);
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  return readEnvelope(await fetch(`${PROXY_PREFIX}${path}${suffix}`));
}

export async function apiPost(path: string, body?: string | FormData) {
  return readEnvelope(
    await fetch(`${PROXY_PREFIX}${path}`, {
      method: "POST",
      // FormData sets its own multipart content-type (with boundary);
      // setting one by hand here would corrupt the request.
      ...(typeof body === "string"
        ? { headers: { "content-type": "application/json" } }
        : {}),
      ...(body !== undefined ? { body } : {}),
    }),
  );
}

export async function apiPatch(path: string, body?: string | FormData) {
  return readEnvelope(
    await fetch(`${PROXY_PREFIX}${path}`, {
      method: "PATCH",
      ...(typeof body === "string"
        ? { headers: { "content-type": "application/json" } }
        : {}),
      ...(body !== undefined ? { body } : {}),
    }),
  );
}

export async function apiDelete(path: string, body?: string) {
  return readEnvelope(
    await fetch(`${PROXY_PREFIX}${path}`, {
      method: "DELETE",
      ...(body !== undefined
        ? { headers: { "content-type": "application/json" }, body }
        : {}),
    }),
  );
}

/** Postal's playlist ("pack") modes, mirrored from the product enum. */
export const PlaylistModeType = { PRIVATE: "PRIVATE" } as const;

/** Postal's release-format enum, mirrored from the product enum. */
export const PlaylistType = { PLAYLIST: "PLAYLIST" } as const;

/**
 * `POST /pack/create` is a multipart endpoint shared with Postal's own pack
 * dialogs, so it expects the full field set even when most of it is empty.
 */
export function buildPlaylistFormData(name: string, description: string): FormData {
  const formData = new FormData();
  formData.append("name", name);
  formData.append("description", description);
  formData.append("mode", PlaylistModeType.PRIVATE);
  formData.append("playlistType", PlaylistType.PLAYLIST);
  formData.append("uploadLimit", "25");
  formData.append("limit", "25");
  formData.append("showInStorefront", "false");
  formData.append("trackIds", "");
  formData.append("imageUrl", "");
  return formData;
}
