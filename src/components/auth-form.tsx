"use client";

import { useActionState } from "react";
import { initialState, type ActionState, type AuthFormMode } from "@/lib/auth/state";

const labels: Record<AuthFormMode, string> = {
  "sign-in": "Sign in", "sign-up": "Create account",
  "forgot-password": "Send reset email", resend: "Resend verification email",
  verify: "Verify email", recover: "Set new password",
};

export function AuthForm({ mode, action, tokenHash }: {
  mode: AuthFormMode;
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  tokenHash?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const email = ["sign-in", "sign-up", "forgot-password", "resend"].includes(mode);
  const password = ["sign-in", "sign-up", "recover"].includes(mode);
  const newPassword = mode === "sign-up" || mode === "recover";
  return (
    <form action={formAction} className="space-y-4">
      <fieldset disabled={pending} className="space-y-4">
        {email && <div>
          <label htmlFor="email" className="block text-sm font-medium">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} className="form-input" />
        </div>}
        {password && <div>
          <label htmlFor="password" className="block text-sm font-medium">{newPassword ? "New password" : "Password"}</label>
          <input id="password" name="password" type="password" autoComplete={newPassword ? "new-password" : "current-password"}
            required minLength={newPassword ? 12 : undefined} maxLength={128} className="form-input" aria-describedby={newPassword ? "password-help" : undefined} />
          {newPassword && <p id="password-help" className="mt-1 text-sm text-muted-foreground">Use 12–128 characters. A password manager can help.</p>}
        </div>}
        {newPassword && <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium">Confirm password</label>
          <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className="form-input" />
        </div>}
        {tokenHash && <input type="hidden" name="token_hash" value={tokenHash} />}
        <button type="submit" className="form-button">{pending ? "Please wait…" : labels[mode]}</button>
      </fieldset>
      <p role={state.status === "error" ? "alert" : "status"} aria-live="polite" className="text-sm">{state.message}</p>
    </form>
  );
}
