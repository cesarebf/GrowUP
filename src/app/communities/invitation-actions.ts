"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { AuthenticationRequired, reportError } from "@/lib/auth/service";
import { startInvitationReturn } from "@/lib/auth/invitation-return";
import { acceptInvitation, createInvitation, revokeInvitation } from "@/lib/communities/invitations";
import { exactInvitationFields, isInvitationToken, type InvitationActionState, type InvitationAdmission, type InvitationDelivery, type InvitationHistory, type InvitationResult } from "@/lib/communities/invitation-validation";
async function mutate<T>(service: (client: Awaited<ReturnType<typeof createClient>>, form: FormData) => Promise<InvitationResult<T>>, form: FormData, accepting = false): Promise<InvitationResult<T>> {
    let result: InvitationResult<T>;
    let unauthenticated = false;
    try {
        result = await service(await createClient(true), form);
    }
    catch (error) {
        if (error instanceof AuthenticationRequired)
            unauthenticated = true;
        else
            reportError("invitation-action", error);
        result = { status: "error", message: "The invitation result could not be confirmed. Refresh before explicitly trying again." };
    }
    let destination: string | null = null;
    if (unauthenticated) {
        if (accepting && exactInvitationFields(form, ["token"]) && isInvitationToken(form.get("token"))) {
            const returnForm = new FormData();
            returnForm.set("token", form.get("token") as string);
            returnForm.set("destination", "sign-in");
            try {
                destination = await startInvitationReturn(returnForm);
            }
            catch (error) {
                reportError("invitation-return", error);
                return result;
            }
        }
        redirect(destination ?? "/sign-in");
    }
    if (result.status === "success") {
        revalidatePath("/communities");
        revalidatePath("/communities/requests");
        revalidatePath("/c/[slug]", "page");
        revalidatePath("/c/[slug]/requests", "page");
        revalidatePath("/c/[slug]/invitations", "page");
        revalidatePath("/invite/[token]", "page");
    }
    return result;
}
export async function createInvitationAction(_: InvitationActionState<InvitationDelivery>, form: FormData) { return mutate(createInvitation, form); }
export async function revokeInvitationAction(_: InvitationActionState<InvitationHistory>, form: FormData) { return mutate(revokeInvitation, form); }
export async function acceptInvitationAction(_: InvitationActionState<InvitationAdmission>, form: FormData) { return mutate(acceptInvitation, form, true); }
export async function startInvitationAuthAction(_: InvitationActionState<never>, form: FormData): Promise<InvitationActionState<never>> {
    let destination: string | null;
    try {
        destination = await startInvitationReturn(form);
    }
    catch (error) {
        reportError("invitation-return", error);
        return { status: "error", message: "Authentication is temporarily unavailable." };
    }
    if (destination)
        redirect(destination);
    return { status: "error", message: "Invalid invitation return details." };
}
