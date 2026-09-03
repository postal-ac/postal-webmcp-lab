import { resolveClientSession } from "@/postal/session";

import { PostalCapabilityError } from "./errors";

/**
 * Every capability starts here. No tool takes a user ID — identity comes from
 * the session cookie the Worker holds, and the Postal backend still enforces
 * its own ownership checks on top.
 */
export async function requireAuthenticatedPostalSession() {
  const user = await resolveClientSession();
  if (!user) {
    throw new PostalCapabilityError(
      "UNAUTHENTICATED",
      "Sign in to Postal before using this capability.",
    );
  }
  return user;
}
