"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { submitMembershipRequestAction, withdrawMembershipRequestAction } from "@/app/communities/request-actions";
import { parseRequestForm, type RequestActionState, type RequestReceipt } from "@/lib/communities/request-validation";
import { requestOutcomeMessage, requestStatusMessage } from "@/lib/communities/request-presentation";
import { RequestRefresh } from "@/components/request-refresh";

type FormState = { result: RequestActionState; refreshRequired: boolean };
const initial: FormState = { result: { status: "idle" }, refreshRequired: false };

export function MembershipRequestForm({ communityId, latest }: { communityId: string; latest: RequestReceipt | null }) {
  const withdrawing = latest?.status === "pending";
  const operation = withdrawing ? "withdraw" : "submit";
  const id = useId();
  const feedback = useRef<HTMLParagraphElement>(null);
  const [state, action, pending] = useActionState(async (previous: FormState, form: FormData): Promise<FormState> => {
    if (previous.refreshRequired) return previous;
    const parsed = parseRequestForm(form, operation);
    if (parsed.status === "error") return { result: parsed, refreshRequired: false };
    try {
      const result = await (withdrawing ? withdrawMembershipRequestAction : submitMembershipRequestAction)({ status: "idle" }, form);
      return { result, refreshRequired: true };
    } catch {
      // Transport failures can occur after a commit. Never infer or retry intent.
      return { result: { status: "error", message: "The request could not be confirmed. Refresh to check its status before explicitly trying again." }, refreshRequired: true };
    }
  }, initial);
  useEffect(() => { if (state.result.status !== "idle") feedback.current?.focus(); }, [state]);
  const disabled = pending || state.refreshRequired;
  return <section className="space-y-4" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`} className="text-xl font-semibold">Request to join</h2>
    {state.result.status !== "success" && latest && <p className="text-sm">{requestStatusMessage(latest)}</p>}
    {withdrawing && <p className="break-words text-sm">Shared name for this attempt: {latest.requester_display_name}</p>}
    {!withdrawing && latest && <p className="text-sm text-muted-foreground">You are not currently a member. You can explicitly submit a new request under the current admission rules.</p>}
    <form action={action} className="space-y-4" aria-busy={pending}>
      <input type="hidden" name="community_id" value={communityId} />
      {withdrawing ? <input type="hidden" name="request_id" value={latest.request_id} /> : <>
        <label htmlFor={`${id}-name`} className="block text-sm font-medium">Name to share with reviewers
          <input id={`${id}-name`} name="display_name" required disabled={disabled} autoComplete="off"
            aria-describedby={`${id}-notice ${id}-rules ${id}-feedback`} className="form-input" />
        </label>
        <p id={`${id}-notice`} className="text-sm text-muted-foreground">This name will be shared with this community&apos;s owner and admins to review your request. Your private account profile name and email are not exposed. Enter the name you choose to share for this attempt.</p>
        <p id={`${id}-rules`} className="text-sm text-muted-foreground">Use 1–80 characters without control characters. Outer spaces are removed.</p>
      </>}
      <button type="submit" disabled={disabled} className="form-button">
        {pending ? withdrawing ? "Withdrawing…" : "Submitting…" : withdrawing ? "Withdraw request" : "Submit request"}
      </button>
      <p id={`${id}-feedback`} ref={feedback} tabIndex={-1} role={state.result.status === "error" ? "alert" : "status"}
        aria-live="polite" className="text-sm">
        {state.result.status === "success" ? requestOutcomeMessage(state.result.data) : state.result.status === "error" ? state.result.message : ""}
      </p>
      {state.refreshRequired && <p className="text-sm text-muted-foreground">Refresh status to load current membership and request controls.</p>}
      <RequestRefresh disabled={pending} />
    </form>
  </section>;
}
