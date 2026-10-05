"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { acceptInvitationAction, startInvitationAuthAction } from "@/app/communities/invitation-actions";
import type { InvitationActionState, InvitationAdmission, InvitationPreview } from "@/lib/communities/invitation-validation";
import { unavailableInvitationMessage } from "@/lib/communities/invitation-presentation";
import { requestDate } from "@/lib/communities/request-presentation";
import { RequestRefresh } from "@/components/request-refresh";

function CommunityLink({ slug }: { slug: string }) {
  return <Link href={`/c/${slug}`} replace prefetch={false} referrerPolicy="no-referrer" className="inline-block text-sm underline">Enter community</Link>;
}

export function InvitationAuth({ token }: { token: string }) {
  const feedback = useRef<HTMLParagraphElement>(null);
  const [state, action, pending] = useActionState(async (previous: InvitationActionState<never>, form: FormData): Promise<InvitationActionState<never>> => {
    if (previous.status !== "idle") return previous;
    try { return await startInvitationAuthAction(previous, form); }
    catch { return { status: "error", message: "Authentication could not be started. Refresh before trying again." }; }
  }, { status: "idle" });
  useEffect(() => { if (state.status !== "idle") feedback.current?.focus(); }, [state]);
  return <div className="space-y-4" aria-busy={pending}>
    <p className="text-sm">Sign in with an eligible verified account, or sign up. You will return here to explicitly accept; signing in does not join the community.</p>
    <form action={action} className="flex flex-wrap gap-3">
      <input type="hidden" name="token" value={token} />
      <button type="submit" name="destination" value="sign-in" disabled={pending || state.status !== "idle"} className="form-button">Sign in</button>
      <button type="submit" name="destination" value="sign-up" disabled={pending || state.status !== "idle"} className="form-button">Sign up</button>
    </form>
    <p ref={feedback} tabIndex={-1} role={state.status === "error" ? "alert" : "status"} aria-live="polite" className="text-sm">{pending ? "Opening authentication…" : state.status === "error" ? state.message : ""}</p>
    {state.status === "error" && <RequestRefresh />}
    <p className="text-sm text-muted-foreground">After signup, verify your email and sign in in this same browser within one hour. If confirmation opens elsewhere or your return expires, finish signing in and reopen the original invitation. Starting another invitation sign-in flow replaces this return destination.</p>
  </div>;
}

export function CommunityInvitationAccept({ token, preview, signedIn }: { token: string; preview: InvitationPreview; signedIn: boolean }) {
  const feedback = useRef<HTMLParagraphElement>(null);
  const [state, action, pending] = useActionState(async (previous: InvitationActionState<InvitationAdmission>, form: FormData): Promise<InvitationActionState<InvitationAdmission>> => {
    if (previous.status !== "idle") return previous;
    try { return await acceptInvitationAction(previous, form); }
    catch { return { status: "error", message: "The invitation result could not be confirmed. Refresh status before explicitly trying again." }; }
  }, { status: "idle" });
  useEffect(() => { if (state.status !== "idle") feedback.current?.focus(); }, [state]);

  // An action result replaces the earlier preview completely. Never retain
  // private metadata after a denial, uncertain outcome, or departed replay.
  if (state.status !== "idle") {
    const result = state.status === "success" ? state.data : null;
    const message = state.status === "error" ? state.message : result?.outcome === "unavailable" ? unavailableInvitationMessage
      : result?.outcome === "already_member" ? "You are already a member. Your role is unchanged and this invitation remains unused."
        : result?.community_slug ? "Invitation accepted. Your membership is confirmed."
          : "Invitation already accepted. It cannot be used to join again. Community details are unavailable.";
    return <section className="space-y-4" aria-busy={pending}>
      <p ref={feedback} tabIndex={-1} role={state.status === "error" ? "alert" : "status"} aria-live="polite">{message}</p>
      {result?.community_slug && <CommunityLink slug={result.community_slug} />}
      <RequestRefresh disabled={pending} />
    </section>;
  }
  if (preview.outcome === "unavailable") return <p role="status">{unavailableInvitationMessage}</p>;
  return <section className="min-w-0 space-y-4" aria-busy={pending}>
    {preview.community_name && <h2 className="break-words text-xl font-semibold">{preview.community_name}</h2>}
    {preview.community_description && <p className="break-words whitespace-pre-wrap">{preview.community_description}</p>}
    {preview.expires_at && <p className="text-sm">{preview.outcome === "active" ? "Expires" : "Original expiry"} <time dateTime={preview.expires_at}>{requestDate(preview.expires_at)}</time></p>}
    {preview.outcome === "accepted" ? <>
      <p role="status">Invitation already accepted. It cannot be used to join again.</p>
      {preview.community_slug ? <CommunityLink slug={preview.community_slug} /> : <p className="text-sm">Community details are unavailable.</p>}
    </> : !signedIn ? <InvitationAuth token={token} /> : <>
      <p className="text-sm">{preview.already_member
        ? "You are already a member. Your role is unchanged and this invitation remains unused. Continue to confirm your current access."
        : "Accepting joins this community as a member and uses this single-use invitation. Any pending membership request is cancelled automatically."}</p>
      <form action={action}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" disabled={pending} className="form-button">{pending ? "Checking invitation…" : preview.already_member ? "Continue to community" : "Accept invitation"}</button>
      </form>
      <p role="status" aria-live="polite" className="text-sm">{pending ? "Checking invitation…" : ""}</p>
    </>}
    <RequestRefresh disabled={pending} />
  </section>;
}
