"use client";

import { useActionState } from "react";
import { updateProfileAction } from "@/app/auth/actions";
import { initialState } from "@/lib/auth/state";

export function ProfileForm({ displayName }: { displayName: string | null }) {
  const [state, action, pending] = useActionState(updateProfileAction, initialState);
  return <form action={action} className="space-y-4">
    <label htmlFor="display_name" className="block text-sm font-medium">Private display name (optional)
      <input id="display_name" name="display_name" defaultValue={displayName ?? ""} maxLength={80} autoComplete="nickname" className="form-input" />
    </label>
    <p className="text-sm text-muted-foreground">This does not publish a public profile.</p>
    <button className="form-button" type="submit" disabled={pending}>{pending ? "Saving…" : "Save profile"}</button>
    <p role={state.status === "error" ? "alert" : "status"} aria-live="polite" className="text-sm">{state.message}</p>
  </form>;
}
