"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { AuthenticationRequired, reportError } from "@/lib/auth/service";
import { approveMembershipRequest, rejectMembershipRequest, submitMembershipRequest, withdrawMembershipRequest } from "@/lib/communities/requests";
import type { RequestActionState } from "@/lib/communities/request-validation";

async function requestAction(mutate: typeof submitMembershipRequest, form: FormData): Promise<RequestActionState> {
  let result: RequestActionState;
  let unauthenticated = false;
  try {
    result = await mutate(await createClient(true), form);
  } catch (error) {
    if (error instanceof AuthenticationRequired) unauthenticated = true;
    else reportError("membership-request-action", error);
    result = { status: "error", message: "The request could not be confirmed. Refresh to check its status before explicitly trying again." };
  }
  if (unauthenticated) redirect("/sign-in");
  if (result.status === "success") {
    revalidatePath("/communities");
    revalidatePath("/c/[slug]", "page");
    revalidatePath("/c/[slug]/requests", "page");
    revalidatePath("/communities/requests");
    revalidatePath("/c/[slug]/invitations", "page");
    revalidatePath("/invite/[token]", "page");
  }
  return result;
}

export async function submitMembershipRequestAction(_: RequestActionState, form: FormData): Promise<RequestActionState> {
  return requestAction(submitMembershipRequest, form);
}
export async function withdrawMembershipRequestAction(_: RequestActionState, form: FormData): Promise<RequestActionState> {
  return requestAction(withdrawMembershipRequest, form);
}
export async function approveMembershipRequestAction(_: RequestActionState, form: FormData): Promise<RequestActionState> {
  return requestAction(approveMembershipRequest, form);
}
export async function rejectMembershipRequestAction(_: RequestActionState, form: FormData): Promise<RequestActionState> {
  return requestAction(rejectMembershipRequest, form);
}
