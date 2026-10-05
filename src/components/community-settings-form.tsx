"use client";

import { useActionState } from "react";
import { updateCommunitySettingsAction } from "@/app/communities/actions";
import { initialState } from "@/lib/auth/state";
import type { CommunitySettingsInput } from "@/lib/communities/validation";

export function CommunitySettingsForm({ community }: { community: CommunitySettingsInput & { id: string } }) {
  const [state, action, pending] = useActionState(updateCommunitySettingsAction, initialState);
  return <section className="space-y-4" aria-labelledby="settings-heading">
    <h2 id="settings-heading" className="text-xl font-semibold">Community settings</h2>
    <form action={action} className="space-y-4">
      <input type="hidden" name="community_id" value={community.id} />
      <label htmlFor="settings-name" className="block text-sm font-medium">Community name
        <input id="settings-name" name="name" required maxLength={80} defaultValue={community.name} className="form-input" />
      </label>
      <label htmlFor="settings-description" className="block text-sm font-medium">Short description (optional)
        <input id="settings-description" name="description" maxLength={500} defaultValue={community.description} className="form-input" />
      </label>
      <label htmlFor="settings-visibility" className="block text-sm font-medium">Visibility
        <select id="settings-visibility" name="visibility" required defaultValue={community.visibility} className="form-input" aria-describedby="settings-visibility-help">
          <option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option>
        </select>
      </label>
      <p id="settings-visibility-help" className="text-sm text-muted-foreground">Public and unlisted communities publish the name and description by direct link. Private communities are hidden from nonmembers except for the limited preview available with a valid invitation.</p>
      <label htmlFor="settings-join-policy" className="block text-sm font-medium">Join policy
        <select id="settings-join-policy" name="join_policy" required defaultValue={community.join_policy} className="form-input" aria-describedby="settings-policy-help">
          <option value="instant">Instant</option><option value="approval_required">Approval required</option><option value="invitation_only">Invitation only</option>
        </select>
      </label>
      <p id="settings-policy-help" className="text-sm text-muted-foreground">Instant: eligible users join public/unlisted communities immediately. Approval required: eligible users request access to public/unlisted communities and an owner or admin must approve. Invitation only: users cannot request access; an owner or admin can share a single-use invitation link. Private communities accept no unsolicited joins or requests, even with instant or approval required saved. Changes keep existing members. Existing invitations remain valid until used, revoked, or expired. Making the community private or leaving approval required cancels pending requests. The community URL cannot be edited.</p>
      <button type="submit" disabled={pending} className="form-button">{pending ? "Saving…" : "Save settings"}</button>
      <p role={state.status === "error" ? "alert" : "status"} aria-live="polite" className="text-sm">{state.message}</p>
    </form>
  </section>;
}
