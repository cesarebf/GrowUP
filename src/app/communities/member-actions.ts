"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { AuthenticationRequired, reportError } from "@/lib/auth/service";
import { removeCommunityMember, setCommunityMemberRole, setMyCommunityManagementName } from "@/lib/communities/members";
import { parseMemberForm, type ManagementActionState, type MemberOperation } from "@/lib/communities/member-validation";

async function memberAction(operation: MemberOperation, form: FormData): Promise<ManagementActionState> {
  let unauthenticated = false;
  try {
    const input = parseMemberForm(form, operation);
    if (!input) return { status: "error", code: "invalid", message: "Invalid management details. Check your input." };
    const client = await createClient(true);
    const result = "role" in input ? await setCommunityMemberRole(client, input)
      : "name" in input ? await setMyCommunityManagementName(client, input) : await removeCommunityMember(client, input);
    if (result.status === "success") {
      revalidatePath("/communities");
      revalidatePath("/c/[slug]", "page");
      revalidatePath("/c/[slug]/requests", "page");
      revalidatePath("/communities/requests");
      revalidatePath("/c/[slug]/invitations", "page");
      revalidatePath("/invite/[token]", "page");
    }
    return result;
  } catch (error) {
    if (error instanceof AuthenticationRequired) unauthenticated = true;
    else reportError("community-member-action", error);
  }
  if (unauthenticated) redirect("/sign-in");
  return { status: "error", code: "reconciliation_required", message: "The result could not be confirmed. Refresh the current membership before explicitly trying again." };
}
export async function setCommunityMemberRoleAction(_: ManagementActionState, form: FormData): Promise<ManagementActionState> {
  return memberAction("role", form);
}
export async function removeCommunityMemberAction(_: ManagementActionState, form: FormData): Promise<ManagementActionState> {
  return memberAction("remove", form);
}
export async function setMyCommunityManagementNameAction(_: ManagementActionState, form: FormData): Promise<ManagementActionState> {
  return memberAction("name", form);
}
