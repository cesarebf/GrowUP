"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setMyCommunityManagementNameAction } from "@/app/communities/member-actions";
import { normalizeManagementName } from "@/lib/communities/member-validation";
import { RequestRefresh } from "@/components/request-refresh";

type State = { status: "idle" } | { status: "invalid" | "error" | "success"; message: string };
export function CommunityManagementName({ communityId, membershipId, currentName }: {
  communityId: string; membershipId: string; currentName: string | null;
}) {
  const id = useId();
  const router = useRouter();
  const feedback = useRef<HTMLParagraphElement>(null);
  const [name, setName] = useState(currentName ?? "");
  const [state, action, pending] = useActionState(async (previous: State, form: FormData): Promise<State> => {
    if (previous.status === "success" || previous.status === "error") return previous;
    if (normalizeManagementName(form.get("name")) === undefined)
      return { status: "invalid", message: "Use at most 80 Unicode characters without control characters, or leave blank to clear." };
    try {
      const result = await setMyCommunityManagementNameAction({ status: "idle" }, form);
      if (result.status === "error") return { status: "error", message: result.message };
      if (result.status !== "success" || !("management_display_name" in result.data)) throw new Error();
      setName(result.data.management_display_name ?? "");
      return { status: "success", message: result.data.management_display_name === null ? "Management name cleared." : "Management name saved." };
    } catch { return { status: "error", message: "The result could not be confirmed. Refresh status before explicitly trying again." }; }
  }, { status: "idle" });
  useEffect(() => {
    if (state.status !== "idle") feedback.current?.focus();
    if (state.status === "success" || state.status === "error") router.refresh();
  }, [state, router]);
  const settled = state.status === "success" || state.status === "error";
  const invalid = normalizeManagementName(name) === undefined;
  return <form action={action} aria-busy={pending} className="space-y-4">
    <input type="hidden" name="community_id" value={communityId} />
    <input type="hidden" name="membership_id" value={membershipId} />
    <label htmlFor={id} className="block text-sm font-medium">Your management name (optional)</label>
    <p id={`${id}-help`} className="text-sm text-muted-foreground">Visible to you and this community’s current owner and admins. This is a community-specific label, not a verified identity or your global profile name. Duplicates are allowed. Leave blank to clear.</p>
    <input id={id} name="name" value={name} onChange={event => setName(event.target.value)} disabled={pending || settled}
      aria-describedby={`${id}-help ${id}-length`} aria-invalid={invalid} autoComplete="off" className="form-input" />
    <p id={`${id}-length`} className="text-sm">{Array.from(name.replace(/^ +| +$/g, "")).length}/80 Unicode characters after trimming outer spaces.{invalid ? " Remove extra or control characters." : ""}</p>
    <div className="flex flex-wrap gap-3">
      <button type="submit" disabled={pending || settled || invalid} className="form-button">{pending ? "Saving…" : "Save management name"}</button>
      <button type="button" disabled={pending || settled || name === ""} onClick={() => setName("")} className="text-sm underline disabled:opacity-50">Clear field</button>
    </div>
    <p ref={feedback} tabIndex={-1} role={state.status === "error" || state.status === "invalid" ? "alert" : "status"} className="text-sm">{state.status !== "idle" ? state.message : ""}</p>
    {settled && <RequestRefresh disabled={pending} />}
  </form>;
}
