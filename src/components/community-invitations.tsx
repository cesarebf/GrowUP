"use client";

import { useActionState, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createInvitationAction, revokeInvitationAction } from "@/app/communities/invitation-actions";
import type { InvitationDelivery, InvitationHistory, InvitationResult } from "@/lib/communities/invitation-validation";
import { copyInvitationLink, invitationPresentationUrl, invitationStatusLabels } from "@/lib/communities/invitation-presentation";
import { requestDate } from "@/lib/communities/request-presentation";
import { RequestRefresh } from "@/components/request-refresh";

type ManagementState = { status: "idle" } | { status: "error"; message: string }
  | { status: "created"; data: InvitationDelivery } | { status: "revoked"; data: InvitationHistory };
const subscribeOrigin = () => () => {};
const browserOrigin = () => window.location.origin;
const serverOrigin = () => "";

export function InvitationLink({ delivery }: { delivery: InvitationDelivery }) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [copyState, setCopyState] = useState("");
  const [copying, setCopying] = useState(false);
  const origin = useSyncExternalStore(subscribeOrigin, browserOrigin, serverOrigin);
  const url = invitationPresentationUrl(delivery.path, origin);
  async function copy() {
    if (copying) return;
    setCopying(true);
    const result = await copyInvitationLink(delivery.path, window.location.origin, navigator.clipboard);
    setCopying(false);
    setCopyState(result === "copied" ? "Link copied." : result === "manual"
      ? "Clipboard unavailable. The link is selected; copy it manually using your keyboard or touch menu."
      : "The link could not be displayed. Refresh history before creating another invitation.");
    if (result === "manual") { field.current?.focus(); field.current?.select(); }
  }
  return <section className="min-w-0 space-y-3 rounded-lg border p-4" aria-label="New invitation link">
    <label htmlFor={id} className="block text-sm font-medium">Copy this invitation link now</label>
    <p id={`${id}-help`} className="text-sm">Shown only for this creation response. GrowUP cannot recover it after you dismiss it, leave, or refresh.</p>
    <textarea ref={field} id={id} readOnly value={url ?? ""} rows={4} spellCheck={false} autoComplete="off"
      aria-describedby={`${id}-help`} className="form-input min-w-0 resize-y break-all" />
    <p className="text-sm">Expires <time dateTime={delivery.expires_at}>{requestDate(delivery.expires_at)}</time>.</p>
    <div className="flex flex-wrap gap-4">
      <button type="button" className="form-button" disabled={!url || copying} onClick={copy}>{copying ? "Copying…" : "Copy link"}</button>
      <button type="button" className="text-sm underline" onClick={() => window.location.reload()}>Dismiss link and refresh history</button>
    </div>
    <p role="status" aria-live="polite" className="text-sm">{copyState}</p>
  </section>;
}

export function CommunityInvitations({ communityId, invitations }: { communityId: string; invitations: InvitationHistory[] }) {
  const id = useId();
  const feedback = useRef<HTMLParagraphElement>(null);
  const [state, action, pending] = useActionState(async (previous: ManagementState, form: FormData): Promise<ManagementState> => {
    if (previous.status !== "idle") return previous;
    const operation = form.get("operation");
    form.delete("operation");
    if (operation !== "create" && operation !== "revoke") return { status: "error", message: "Choose an invitation action. Refresh status before trying again." };
    if (operation === "revoke") {
      if (form.get("confirm") !== "yes") return { status: "error", message: "Confirm revocation. Refresh status before trying again." };
      form.delete("confirm");
    }
    try {
      if (operation === "create") {
        const result = await createInvitationAction({ status: "idle" }, form);
        return result.status === "success" ? { status: "created", data: result.data } : result;
      }
      const result: InvitationResult<InvitationHistory> = await revokeInvitationAction({ status: "idle" }, form);
      return result.status === "success" ? { status: "revoked", data: result.data } : result;
    } catch { return { status: "error", message: "The invitation result could not be confirmed. Refresh history before explicitly trying again." }; }
  }, { status: "idle" });
  useEffect(() => { if (state.status !== "idle") feedback.current?.focus(); }, [state]);
  const disabled = pending || state.status !== "idle";
  return <section aria-label="Invitation management" aria-busy={pending} className="min-w-0 space-y-5">
    <p className="text-sm">Anyone possessing a valid link and an eligible verified account can join as a member. Each link is single-use for one new member, expires after 7 days (168 hours), and can be revoked. Existing invitations remain valid until used, revoked, or expired, even if settings or the creator’s role change.</p>
    <form action={action}>
      <input type="hidden" name="community_id" value={communityId} />
      <button type="submit" name="operation" value="create" disabled={disabled} className="form-button">{pending ? "Working…" : "Create invitation"}</button>
    </form>
    <p ref={feedback} tabIndex={-1} role={state.status === "error" ? "alert" : "status"} aria-live="polite" className="text-sm">
      {pending ? "Updating invitation…" : state.status === "created" ? "Invitation created. Copy the link before leaving this page."
        : state.status === "revoked" ? state.data.status === "revoked" ? "Invitation revoked."
          : `Invitation is ${invitationStatusLabels[state.data.status].toLowerCase()}; it was not revoked.`
          : state.status === "error" ? state.message : ""}
    </p>
    {state.status === "created" && <InvitationLink delivery={state.data} />}
    {state.status !== "idle" && <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Refresh history and current permissions before another action. Any one-time link will be cleared. If creation was uncertain, revoke the unused invitation from history before creating another.</p>
      <RequestRefresh disabled={pending} />
    </div>}
    <h2 className="text-xl font-semibold">Invitation history</h2>
    <p className="text-sm text-muted-foreground">Newest first. Historical links cannot be recovered or copied. Times are UTC.</p>
    {invitations.length === 0 ? <p className="text-sm">No invitations on this page.</p> : <ul className="space-y-4">
      {invitations.map((original) => {
        const row = state.status === "revoked" && state.data.invitation_id === original.invitation_id ? state.data : original;
        const rowId = `${id}-${row.invitation_id}`;
        return <li key={row.invitation_id} className="min-w-0 space-y-3 rounded-lg border p-4">
          <h3 id={rowId} className="break-words font-medium">Invitation {row.invitation_id.slice(0, 8)} — {invitationStatusLabels[row.status]}</h3>
          <p className="text-sm">Created <time dateTime={row.created_at}>{requestDate(row.created_at)}</time></p>
          <p className="text-sm">Expires <time dateTime={row.expires_at}>{requestDate(row.expires_at)}</time></p>
          {row.status === "active" && <form action={action} aria-labelledby={rowId} className="space-y-3">
            <input type="hidden" name="community_id" value={communityId} />
            <input type="hidden" name="invitation_id" value={row.invitation_id} />
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" value="yes" required disabled={disabled} className="mt-1" />Revoke this invitation permanently</label>
            <button type="submit" name="operation" value="revoke" disabled={disabled} className="form-button">Revoke</button>
          </form>}
        </li>;
      })}
    </ul>}
  </section>;
}
