"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { useRouter } from "next/navigation";
import { removeCommunityMemberAction, setCommunityMemberRoleAction } from "@/app/communities/member-actions";
import type { CommunityMember } from "@/lib/communities/member-validation";
import type { CommunityRole } from "@/lib/communities/validation";
import { memberRoleChoices, roleLabels } from "@/lib/communities/member-presentation";
import { requestDate } from "@/lib/communities/request-presentation";
import { RequestRefresh } from "@/components/request-refresh";

type State = { status: "idle" } | { status: "error"; message: string }
  | { status: "success"; message: string; removedId?: string };

export function CommunityMembers({ communityId, actorRole, members }: {
  communityId: string; actorRole: CommunityRole; members: CommunityMember[];
}) {
  const id = useId();
  const router = useRouter();
  const feedback = useRef<HTMLParagraphElement>(null);
  const [state, action, pending] = useActionState(async (previous: State, form: FormData): Promise<State> => {
    if (previous.status !== "idle") return previous;
    const operation = form.get("operation");
    const row = members.find(member => member.membership_id === form.get("membership_id"));
    const choices = row ? memberRoleChoices(actorRole, row) : [];
    if (!row || !choices.length || (operation !== "role" && operation !== "remove"))
      return { status: "error", message: "Community management is unavailable. Refresh status." };
    if (operation === "role" && !choices.includes(form.get("role") as typeof choices[number]))
      return { status: "error", message: "Choose a different available role. Refresh status." };
    if (operation === "remove" && form.get("confirm") !== "yes")
      return { status: "error", message: "Confirm removal before continuing. Refresh status." };
    form.delete("operation");
    form.delete("confirm");
    try {
      const result = await (operation === "role" ? setCommunityMemberRoleAction : removeCommunityMemberAction)({ status: "idle" }, form);
      if (result.status === "error") return { status: "error", message: result.message };
      if (result.status !== "success" || !("outcome" in result.data)) throw new Error();
      return { status: "success", message: result.data.outcome === "removed" ? "Member removed from the community."
        : result.data.outcome === "already_absent" ? "This membership is already absent. The roster is being refreshed."
          : result.data.outcome === "unchanged" ? "The member already has that role." : "Member role updated.",
      ...(operation === "remove" ? { removedId: row.membership_id } : {}) };
    } catch { return { status: "error", message: "The result could not be confirmed. Refresh status before explicitly trying again." }; }
  }, { status: "idle" });
  useEffect(() => {
    if (state.status !== "idle") { feedback.current?.focus(); router.refresh(); }
  }, [state, router]);
  const disabled = pending || state.status !== "idle";
  const rows = members.filter(row => state.status !== "success" || row.membership_id !== state.removedId);
  return <section aria-label="Community members" aria-busy={pending} className="min-w-0 space-y-4">
    <p ref={feedback} tabIndex={-1} role={state.status === "error" ? "alert" : "status"} className="text-sm">
      {pending ? "Updating membership…" : state.status !== "idle" ? state.message : ""}
    </p>
    {state.status !== "idle" && <div className="space-y-2">
      <p className="text-sm">Refresh status to confirm current permissions before another action.</p>
      <RequestRefresh disabled={pending} />
    </div>}
    {state.status !== "error" && (rows.length === 0 ? <p className="text-sm">No members on this page.</p> : <ul className="space-y-4">
      {rows.map((row, index) => {
        const choices = memberRoleChoices(actorRole, row);
        const label = `${id}-${index}`;
        return <li key={row.membership_id} className="min-w-0 space-y-3 rounded-lg border p-4">
          <h2 id={label} className="break-words font-medium">{row.management_display_name ?? "Unnamed member"}{row.is_self ? " (you)" : ""}</h2>
          <p className="text-sm font-medium">{roleLabels[row.role]}</p>
          <p className="text-sm text-muted-foreground">Joined <time dateTime={row.joined_at}>{requestDate(row.joined_at)}</time></p>
          {choices.length > 0 && <div className="space-y-3">
            <form action={action} aria-labelledby={label} className="flex flex-wrap gap-3">
              <input type="hidden" name="community_id" value={communityId} />
              <input type="hidden" name="membership_id" value={row.membership_id} />
              <input type="hidden" name="operation" value="role" />
              {choices.map(role => <button key={role} type="submit" name="role" value={role} disabled={disabled} className="form-button">Make {role}</button>)}
            </form>
            <form action={action} aria-labelledby={label} className="space-y-3 border-t pt-3">
              <input type="hidden" name="community_id" value={communityId} />
              <input type="hidden" name="membership_id" value={row.membership_id} />
              <input type="hidden" name="operation" value="remove" />
              <p id={`${label}-removal`} className="text-sm">Removal ends this community membership. It is not a ban; they may join again under the community’s admission rules.</p>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" value="yes" required disabled={disabled} aria-describedby={`${label}-removal`} className="mt-1" />Confirm removal of this member from the community</label>
              <button type="submit" disabled={disabled} className="form-button border border-destructive bg-background text-destructive">Remove member</button>
            </form>
          </div>}
        </li>;
      })}
    </ul>)}
  </section>;
}
