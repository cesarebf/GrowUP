"use client";

import { useActionState } from "react";
import { joinCommunityAction, leaveCommunityAction } from "@/app/communities/actions";
import { initialState } from "@/lib/auth/state";

export function CommunityMembershipForm({ communityId, operation }: { communityId: string; operation: "join" | "leave" }) {
  const [state, action, pending] = useActionState(operation === "join" ? joinCommunityAction : leaveCommunityAction, initialState);
  return <form action={action} className="space-y-4">
    <input type="hidden" name="community_id" value={communityId} />
    {operation === "leave" && <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name="confirm_leave" value="yes" required disabled={pending} className="mt-1" />
      <span>I confirm I want to leave and lose member access. Rejoining depends on the current admission rules and starts with the member role.</span>
    </label>}
    <button type="submit" disabled={pending} className="form-button">
      {pending ? "Updating…" : operation === "join" ? "Join community" : "Leave community"}
    </button>
    <p role={state.status === "error" ? "alert" : "status"} aria-live="polite" className="text-sm">{state.message}</p>
  </form>;
}
