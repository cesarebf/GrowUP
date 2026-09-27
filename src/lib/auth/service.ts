import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types.ts";
import type { ActionState, AuthFormMode } from "./state.ts";
import { parseOrigin } from "../supabase/config.ts";
import { isTokenHash } from "./confirmation.ts";

export type Client = SupabaseClient<Database>;
export class AuthenticationRequired extends Error {}

const failure = (message: string): ActionState => ({ status: "error", message });
const success = (message: string): ActionState => ({ status: "success", message });

export function reportError(operation: string, error: unknown) {
  // Do not log messages, provider payloads, emails, URLs, passwords, or tokens.
  const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
  console.error("GrowUP operation failed", {
    operation,
    code: typeof code === "string" && /^[a-zA-Z0-9_]{1,64}$/.test(code) ? code : "unexpected",
  });
}

function field(data: FormData, name: string) {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

function validPassword(password: string) {
  return password.length >= 12 && password.length <= 128;
}

export async function getVerifiedUser(client: Client): Promise<User | null> {
  // Fetch authoritative identity, never trust getSession() or supplied IDs.
  const { data, error } = await client.auth.getUser();
  if (error) {
    if (error.status === 401 || error.status === 403 ||
      ["session_not_found", "refresh_token_not_found", "refresh_token_already_used", "bad_jwt", "user_not_found"].includes(error.code ?? "") ||
      error.name === "AuthSessionMissingError") return null;
    reportError("verify-user", error);
    throw new Error("Unable to verify your session. Please try again.");
  }
  const user = data.user;
  if (!user?.email_confirmed_at || user.is_anonymous || user.deleted_at) return null;
  // getUser is authoritative, but a still-valid access token may identify a
  // now-banned account. Mirror the database eligibility check explicitly.
  if (user.banned_until && !(Date.parse(user.banned_until) <= Date.now())) return null;
  return user;
}

function providerFailure(operation: string, error: { status?: number; code?: string }): ActionState {
  if (error.status === 429) return failure("Too many attempts. Please try again later.");
  reportError(operation, error);
  return failure("Authentication is temporarily unavailable. Please try again.");
}

export async function submitAuth(
  client: Client,
  mode: AuthFormMode,
  form: FormData,
  appOrigin: string,
): Promise<ActionState> {
  const email = field(form, "email").trim();
  const password = field(form, "password");
  const emailMode = ["sign-in", "sign-up", "forgot-password", "resend"].includes(mode);
  if (emailMode && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return failure("Enter a valid email address.");
  }
  if (["sign-up", "recover"].includes(mode) &&
    (!validPassword(password) || password !== field(form, "confirmPassword"))) {
    return failure("Use 12–128 characters and enter the same password twice.");
  }
  if (mode === "sign-in") {
    if (!password || password.length > 128) return failure("Enter your password.");
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.status && error.status >= 500 || error.status === 429) return providerFailure(mode, error);
      return failure("Sign-in failed. Check your email and password, and verify your email.");
    }
    let eligible = false;
    try {
      eligible = !!await getVerifiedUser(client);
    } finally {
      if (!eligible) {
        const { error: signOutError } = await client.auth.signOut({ scope: "local" });
        if (signOutError) reportError("clear-ineligible-session", signOutError);
      }
    }
    if (!eligible) return failure("Sign-in failed. Verify your email and check that your account is available.");
    return success("Signed in.");
  }
  if (mode === "sign-up") {
    const { data, error } = await client.auth.signUp({
      email, password,
      options: { emailRedirectTo: `${parseOrigin(appOrigin)}/auth/confirm` },
    });
    if (error && !["user_already_exists", "email_exists"].includes(error.code ?? "")) {
      return providerFailure(mode, error);
    }
    // A signup session means confirmation is disabled in the project. Fail
    // closed and flag the configuration instead of silently accepting it.
    if (data.session) {
      const { error: signOutError } = await client.auth.signOut({ scope: "local" });
      if (signOutError) return providerFailure("clear-signup-session", signOutError);
      reportError("email-confirmation-disabled", null);
      return failure("Email verification is unavailable. Please contact support.");
    }
    return success("If signup is available for this address, a verification email will arrive shortly. Check your inbox and spam folder.");
  }
  if (mode === "forgot-password" || mode === "resend") {
    const redirectTo = `${parseOrigin(appOrigin)}/auth/confirm`;
    const { error } = mode === "forgot-password"
      ? await client.auth.resetPasswordForEmail(email, { redirectTo })
      : await client.auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectTo } });
    if (error && !["user_not_found", "email_not_confirmed", "email_already_confirmed"].includes(error.code ?? "")) {
      return providerFailure(mode, error);
    }
    return success("If this address is eligible, an email will arrive shortly. Check your inbox and spam folder.");
  }
  if (mode !== "verify" && mode !== "recover") return failure("Invalid authentication request.");
  const token = field(form, "token_hash");
  if (!isTokenHash(token)) return failure("This link is invalid. Request a new email.");
  const { error } = await client.auth.verifyOtp({
    token_hash: token, type: mode === "verify" ? "email" : "recovery",
  });
  if (error) {
    if (error.status && error.status >= 500 || error.status === 429) return providerFailure("verify-email-token", error);
    return failure("This link is invalid or expired. Request a new email.");
  }
  let result = failure("Email verification failed. Request a new email.");
  let scope: "local" | "global" = "local";
  try {
    if (await getVerifiedUser(client)) {
      result = success("Email verified. You can now sign in.");
      if (mode === "recover") {
        const { error: updateError } = await client.auth.updateUser({ password });
        if (updateError) {
          reportError("recover-password", updateError);
          result = failure("Password change failed. Request a new reset email and choose a different password.");
        } else {
          scope = "global";
          result = success("Password updated. Sign in with your new password.");
        }
      }
    }
  } finally {
    // Verification creates a session. End it even when identity resolution or
    // password update fails/throws; a failed reset must not leave a login behind.
    const { error: signOutError } = await client.auth.signOut({ scope });
    if (signOutError) {
      reportError("end-confirmation-session", signOutError);
      result = failure("Ending the session failed. Please sign out before continuing; request a new email if your change did not complete.");
    }
  }
  return result;
}

export async function signOut(client: Client): Promise<ActionState> {
  const { error } = await client.auth.signOut({ scope: "local" });
  return error ? providerFailure("sign-out", error) : success("Signed out.");
}

export async function readPrivateProfile(client: Client) {
  const user = await getVerifiedUser(client);
  if (!user) throw new AuthenticationRequired();
  const { data, error } = await client.from("private_profiles")
    .select("user_id, display_name, created_at").eq("user_id", user.id).single();
  if (error) {
    reportError("read-profile", error);
    throw new Error("Your profile is temporarily unavailable. Please try again.");
  }
  return { user, profile: data };
}

export async function updatePrivateProfile(client: Client, form: FormData): Promise<ActionState> {
  const user = await getVerifiedUser(client);
  if (!user) throw new AuthenticationRequired();
  const displayName = field(form, "display_name").trim();
  if ([...displayName].length > 80 || /[\u0000-\u001f\u007f]/.test(displayName)) {
    return failure("Use a display name of up to 80 characters without control characters.");
  }
  const { error } = await client.from("private_profiles")
    .update({ display_name: displayName || null })
    .eq("user_id", user.id).select("user_id").single();
  if (error) {
    reportError("update-profile", error);
    return failure("Your profile could not be saved. Please try again.");
  }
  return success("Private profile saved.");
}
