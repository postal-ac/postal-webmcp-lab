import { describe, expect, it } from "vitest";

import {
  APPROVAL_REQUEST_EVENT,
  requestApproval,
  respondToApproval,
  type ApprovalRequest,
} from "./approval";

function nextRequest(): Promise<ApprovalRequest> {
  return new Promise((resolve) =>
    window.addEventListener(
      APPROVAL_REQUEST_EVENT,
      (event) => resolve((event as CustomEvent<ApprovalRequest>).detail),
      { once: true },
    ),
  );
}

describe("requestApproval", () => {
  it("resolves when the user approves", async () => {
    const pendingRequest = nextRequest();
    const approval = requestApproval("Allow?");
    const request = await pendingRequest;
    respondToApproval(request.approvalId, true);
    await expect(approval).resolves.toBeUndefined();
  });

  it("rejects with USER_DENIED when the user declines", async () => {
    const pendingRequest = nextRequest();
    const approval = requestApproval("Allow?");
    const request = await pendingRequest;
    respondToApproval(request.approvalId, false);
    await expect(approval).rejects.toMatchObject({ code: "USER_DENIED" });
  });

  it("ignores responses for other approval ids", async () => {
    const pendingRequest = nextRequest();
    const approval = requestApproval("Allow?");
    const request = await pendingRequest;
    respondToApproval("someone-elses-id", false);
    respondToApproval(request.approvalId, true);
    await expect(approval).resolves.toBeUndefined();
  });
});
