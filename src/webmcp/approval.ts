import { PostalCapabilityError } from "@/capabilities/errors";

/**
 * In-page human approval for consequential tool calls.
 *
 * This is the WebMCP-only trick: because the tool executes inside the page
 * the user is looking at, the page itself can pause the call and put an
 * Approve / Deny bar in front of the human — whoever the caller is. An
 * outside agent, the built-in runner and the on-device planner all hit the
 * same gate; none of them can mint a share link without a click.
 */
export interface ApprovalRequest {
  approvalId: string;
  message: string;
}

export interface ApprovalResponse {
  approvalId: string;
  approved: boolean;
}

export const APPROVAL_REQUEST_EVENT = "postal:webmcp-approval-request";
export const APPROVAL_RESPONSE_EVENT = "postal:webmcp-approval-response";
export const APPROVAL_TIMEOUT_MS = 120_000;

export function respondToApproval(approvalId: string, approved: boolean): void {
  window.dispatchEvent(
    new CustomEvent<ApprovalResponse>(APPROVAL_RESPONSE_EVENT, {
      detail: { approvalId, approved },
    }),
  );
}

export function requestApproval(message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const approvalId = crypto.randomUUID();

    const cleanup = () => {
      window.removeEventListener(APPROVAL_RESPONSE_EVENT, onResponse);
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      cleanup();
      // Tell the UI to drop the stale bar before failing the call.
      window.dispatchEvent(
        new CustomEvent<ApprovalResponse>(APPROVAL_RESPONSE_EVENT, {
          detail: { approvalId, approved: false },
        }),
      );
      reject(
        new PostalCapabilityError(
          "USER_DENIED",
          "The user did not approve this action in time.",
        ),
      );
    }, APPROVAL_TIMEOUT_MS);

    const onResponse = (event: Event) => {
      const detail = (event as CustomEvent<ApprovalResponse>).detail;
      if (detail.approvalId !== approvalId) return;
      cleanup();
      if (detail.approved) resolve();
      else
        reject(
          new PostalCapabilityError(
            "USER_DENIED",
            "The user declined this action on the page.",
          ),
        );
    };

    window.addEventListener(APPROVAL_RESPONSE_EVENT, onResponse);
    window.dispatchEvent(
      new CustomEvent<ApprovalRequest>(APPROVAL_REQUEST_EVENT, {
        detail: { approvalId, message },
      }),
    );
  });
}
