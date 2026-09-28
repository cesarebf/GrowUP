"use client";

import { useActionState } from "react";
import { createCommunityAction } from "@/app/communities/actions";
import { initialState } from "@/lib/auth/state";

export function CommunityForm() {
  const [state, action, pending] = useActionState(createCommunityAction, initialState);
  return <form action={action} className="space-y-4">
    <label htmlFor="name" className="block text-sm font-medium">Community name
      <input id="name" name="name" required maxLength={80} className="form-input" />
    </label>
    <label htmlFor="slug" className="block text-sm font-medium">Community URL: /c/
      <input id="slug" name="slug" required minLength={3} maxLength={48} autoCapitalize="none" spellCheck={false} aria-describedby="slug-help" className="form-input" />
    </label>
    <p id="slug-help" className="text-sm text-muted-foreground">Use letters, numbers, and single hyphens. Letters are saved in lowercase.</p>
    <label htmlFor="description" className="block text-sm font-medium">Short description (optional)
      <input id="description" name="description" maxLength={500} className="form-input" />
    </label>
    <label htmlFor="visibility" className="block text-sm font-medium">Visibility
      <select id="visibility" name="visibility" required defaultValue="" className="form-input" aria-describedby="visibility-help">
        <option value="" disabled>Choose visibility</option>
        <option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option>
      </select>
    </label>
    <p id="visibility-help" className="text-sm text-muted-foreground">Public: eligible for future discovery. Unlisted: accessible by link. Both publish the name and description. Private: visible only to members. Member content stays restricted in every mode.</p>
    <label htmlFor="join_policy" className="block text-sm font-medium">Join policy
      <select id="join_policy" name="join_policy" required defaultValue="" className="form-input" aria-describedby="joining-help">
        <option value="" disabled>Choose a join policy</option>
        <option value="instant">Instant</option><option value="approval_required">Approval required</option><option value="invitation_only">Invitation only</option>
      </select>
    </label>
    <p id="joining-help" className="text-sm text-muted-foreground">Your choice is saved for future admissions. Joining, approval requests, and invitations are not available yet. You become the owner when you create this community.</p>
    <button type="submit" disabled={pending} className="form-button">{pending ? "Creating…" : "Create community"}</button>
    <p role={state.status === "error" ? "alert" : "status"} aria-live="polite" className="text-sm">{state.message}</p>
  </form>;
}
