"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ConfigurationError, parseOrigin } from "@/lib/supabase/config";
import { AuthenticationRequired, reportError, signOut, submitAuth, updatePrivateProfile } from "@/lib/auth/service";
import type { ActionState, AuthFormMode } from "@/lib/auth/state";
import { clearInvitationReturn, consumeInvitationReturn } from "@/lib/auth/invitation-return";

async function run(mode: AuthFormMode, form: FormData): Promise<ActionState> {
  let result: ActionState;
  let signInDestination = "/account";
  try {
    const origin = parseOrigin(process.env.APP_URL);
    result = await submitAuth(await createClient(true), mode, form, origin);
    if (mode === "sign-in" && result.status === "success") signInDestination = await consumeInvitationReturn();
  } catch (error) {
    reportError(error instanceof ConfigurationError ? "auth-configuration" : "auth-action", error);
    return { status: "error", message: "Authentication is temporarily unavailable. Please try again." };
  }
  // Redirect throws a framework control-flow exception: never catch it above.
  if (result.status === "success") {
    if (mode === "sign-in") redirect(signInDestination);
    if (mode === "verify") redirect("/sign-in?notice=verified");
    if (mode === "recover") redirect("/sign-in?notice=recovered");
  }
  return result;
}

export async function signInAction(_: ActionState, form: FormData) { return run("sign-in", form); }
export async function signUpAction(_: ActionState, form: FormData) { return run("sign-up", form); }
export async function forgotPasswordAction(_: ActionState, form: FormData) { return run("forgot-password", form); }
export async function resendAction(_: ActionState, form: FormData) { return run("resend", form); }
export async function verifyAction(_: ActionState, form: FormData) { return run("verify", form); }
export async function recoverAction(_: ActionState, form: FormData) { return run("recover", form); }

export async function signOutAction(): Promise<void> {
  let result: ActionState;
  try {
    result = await signOut(await createClient(true));
    await clearInvitationReturn();
  } catch (error) {
    reportError("sign-out-action", error);
    throw new Error("Sign out failed. Please try again.");
  }
  if (result.status === "error") throw new Error("Sign out failed. Please try again.");
  redirect("/sign-in?notice=signed-out");
}

export async function updateProfileAction(_: ActionState, form: FormData): Promise<ActionState> {
  let result: ActionState;
  let unauthenticated = false;
  try {
    result = await updatePrivateProfile(await createClient(true), form);
  } catch (error) {
    if (error instanceof AuthenticationRequired) unauthenticated = true;
    else reportError("profile-action", error);
    result = { status: "error", message: "Your profile could not be saved. Please try again." };
  }
  if (unauthenticated) redirect("/sign-in");
  if (result.status === "success") revalidatePath("/account");
  return result;
}
