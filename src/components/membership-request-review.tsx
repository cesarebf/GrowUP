"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { approveMembershipRequestAction, rejectMembershipRequestAction } from "@/app/communities/request-actions";
import type { PendingRequest, RequestActionState } from "@/lib/communities/request-validation";
import { requestDate, requestOutcomeMessage } from "@/lib/communities/request-presentation";
import { RequestRefresh } from "@/components/request-refresh";

export function MembershipRequestReview({ communityId, requests }: { communityId: string; requests: PendingRequest[] }) {
  const id = useId();
  const feedback = useRef<HTMLParagraphElement>(null);
  const [state, action, pending] = useActionState(async (previous: RequestActionState, form: FormData): Promise<RequestActionState> => {
    if (previous.status !== "idle") return previous;
    const decision = form.get("decision");
    form.delete("decision");
    if (decision !== "approve" && decision !== "reject") return { status: "error", message: "Choose a review action. Refresh status before trying again." };
    try {
      return await (decision === "approve" ? approveMembershipRequestAction : rejectMembershipRequestAction)({ status: "idle" }, form);
    } catch {
      return { status: "error", message: "The review could not be confirmed. Refresh status before trying again." };
    }
  }, { status: "idle" });
  useEffect(() => { if (state.status !== "idle") feedback.current?.focus(); }, [state]);
  const disabled = pending || state.status !== "idle";
  // Keep feedback outside individual rows: revalidation can remove the resolved
  // attempt (including the final row) before the reviewer reads its outcome.
  return <section className="space-y-4" aria-label="Review queue" aria-busy={pending}>
    <p ref={feedback} tabIndex={-1} role={state.status === "error" ? "alert" : "status"} aria-live="polite" className="text-sm">
      {pending ? "Reviewing…" : state.status === "success" ? `Last review: ${requestOutcomeMessage(state.data)}` : state.status === "error" ? state.message : ""}
    </p>
    {state.status !== "idle" && <>
      <p className="text-sm text-muted-foreground">Refresh status to reconcile the queue and your current review permissions.</p>
      <RequestRefresh disabled={pending} />
    </>}
    {requests.length === 0 ? <p className="text-sm">No pending requests on this page.</p> :
      <ul className="space-y-4">{requests.map((request) => <li key={request.request_id} className="space-y-3 rounded-lg border p-4">
        <h2 id={`${id}-${request.request_id}`} className="break-words font-medium">{request.requester_display_name}</h2>
        <p className="text-sm text-muted-foreground">Requested <time dateTime={request.created_at}>{requestDate(request.created_at)}</time></p>
        <form action={action} aria-labelledby={`${id}-${request.request_id}`} className="space-y-3">
          <input type="hidden" name="community_id" value={communityId} />
          <input type="hidden" name="request_id" value={request.request_id} />
          <div className="flex gap-3">
            <button type="submit" name="decision" value="approve" disabled={disabled} className="form-button">Approve</button>
            <button type="submit" name="decision" value="reject" disabled={disabled} className="rounded-md border px-4 py-2 text-sm disabled:opacity-50">Reject</button>
          </div>
        </form>
      </li>)}</ul>}
  </section>;
}
