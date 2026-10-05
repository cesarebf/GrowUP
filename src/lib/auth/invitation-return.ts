import "server-only";
import { cookies } from "next/headers";
import { parseOrigin } from "../supabase/config.ts";
import { exactInvitationFields, invitationPath, isInvitationToken } from "../communities/invitation-validation.ts";
export const invitationReturnCookie = "growup_invitation_return";
export function invitationCookieOptions(origin: string | undefined) {
    const trusted = new URL(parseOrigin(origin));
    return { httpOnly: true, sameSite: "lax" as const, secure: trusted.protocol === "https:", path: "/", maxAge: 3600 };
}
export async function startInvitationReturn(form: FormData): Promise<"/sign-in" | "/sign-up" | null> {
    if (!exactInvitationFields(form, ["token", "destination"]) || !isInvitationToken(form.get("token")))
        return null;
    const destination = form.get("destination");
    if (destination !== "sign-in" && destination !== "sign-up")
        return null;
    const options = invitationCookieOptions(process.env.APP_URL);
    (await cookies()).set(invitationReturnCookie, form.get("token") as string, options);
    // One host cookie: a newer explicit flow replaces the prior tab's context.
    return destination === "sign-in" ? "/sign-in" : "/sign-up";
}
export async function consumeInvitationReturn(): Promise<string> {
    const store = await cookies();
    const value = store.get(invitationReturnCookie)?.value;
    store.delete(invitationReturnCookie);
    return invitationPath(value) ?? "/account";
}
export async function clearInvitationReturn(): Promise<void> { (await cookies()).delete(invitationReturnCookie); }
