"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { AuthenticationRequired, reportError } from "@/lib/auth/service";
import type { ActionState } from "@/lib/auth/state";
import { createCommunity, type CreateCommunityResult } from "@/lib/communities/service";

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
