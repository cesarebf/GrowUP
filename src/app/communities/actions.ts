"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { AuthenticationRequired, reportError } from "@/lib/auth/service";
import type { ActionState } from "@/lib/auth/state";
import { changeMembership, createCommunity, type CreateCommunityResult, type MembershipResult } from "@/lib/communities/service";

async function membershipAction(operation: "join" | "leave", form: FormData): Promise<ActionState> {
  let result: MembershipResult;
  let unauthenticated = false;
  try {
    result = await changeMembership(await createClient(true), operation, form);
  } catch (error) {
    if (error instanceof AuthenticationRequired) unauthenticated = true;
    else reportError(`${operation}-community-action`, error);
    result = { status: "error", message: "Your membership could not be updated. Refresh Your communities before retrying." };
  }
  if (unauthenticated) redirect("/sign-in");
  if (result.status === "success") {
    revalidatePath("/communities");
    revalidatePath("/c/[slug]", "page");
    redirect(result.path);
  }
  return result;
}

export async function joinCommunityAction(_: ActionState, form: FormData): Promise<ActionState> {
  return membershipAction("join", form);
}

export async function leaveCommunityAction(_: ActionState, form: FormData): Promise<ActionState> {
  return membershipAction("leave", form);
}

export async function createCommunityAction(_: ActionState, form: FormData): Promise<ActionState> {
  let result: CreateCommunityResult;
  let unauthenticated = false;
  try {
    result = await createCommunity(await createClient(true), form);
  } catch (error) {
    if (error instanceof AuthenticationRequired) unauthenticated = true;
    else reportError("create-community-action", error);
    result = { status: "error", message: "Your community could not be created. Check Your communities before retrying." };
  }
  if (unauthenticated) redirect("/sign-in");
  if (result.status === "success") {
    revalidatePath("/communities");
    redirect(`/c/${result.slug}`);
  }
  return result;
}
