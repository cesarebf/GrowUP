import { isRequestTimestamp, isUuid, parseRequestPage, type RequestPageInput } from "./request-validation.ts";
export type InvitationResult<T> = {
    status: "success";
    data: T;
} | {
    status: "error";
    message: string;
};
export type InvitationReceipt = {
    invitation_id: string;
    created_at: string;
    expires_at: string;
};
export type InvitationHistory = InvitationReceipt & {
    status: "active" | "accepted" | "revoked" | "expired";
    accepted_at: string | null;
    revoked_at: string | null;
};
export type InvitationDelivery = InvitationReceipt & {
    path: string;
};
export type InvitationAdmission = {
    outcome: "accepted" | "already_member" | "unavailable";
    community_slug: string | null;
};
export type InvitationPreview = {
    outcome: "active" | "accepted" | "unavailable";
    community_name: string | null;
    community_description: string | null;
    expires_at: string | null;
    already_member: boolean | null;
    community_slug: string | null;
};
export type InvitationActionState<T> = InvitationResult<T> | {
    status: "idle";
};
export const invitationUnavailable: InvitationPreview = {
    outcome: "unavailable", community_name: null, community_description: null, expires_at: null, already_member: null, community_slug: null,
};
export function isInvitationToken(value: unknown): value is string {
    return typeof value === "string" && value.length === 64 && /^[0-9a-f]{64}$/.test(value);
}
export function invitationPath(token: unknown): string | null {
    return isInvitationToken(token) ? `/invite/${token}` : null;
}
export function exactInvitationFields(form: FormData, fields: string[]): boolean {
    for (const [key, value] of form) {
        if (key.startsWith("$ACTION_"))
            continue;
        if (!fields.includes(key) || typeof value !== "string" || form.getAll(key).length !== 1)
            return false;
    }
    return fields.every((key) => form.getAll(key).length === 1 && typeof form.get(key) === "string");
}
export function parseInvitationForm(form: FormData, operation: "create"): { communityId: string } | null;
export function parseInvitationForm(form: FormData, operation: "revoke"): { communityId: string; invitationId: string } | null;
export function parseInvitationForm(form: FormData, operation: "accept"): { token: string } | null;
export function parseInvitationForm(form: FormData, operation: "create" | "revoke" | "accept") {
    const fields = operation === "create" ? ["community_id"] : operation === "revoke" ? ["community_id", "invitation_id"] : ["token"];
    if (!exactInvitationFields(form, fields))
        return null;
    if (operation === "accept") {
        const token = form.get("token");
        return isInvitationToken(token) ? { token } : null;
    }
    const communityId = form.get("community_id");
    if (!isUuid(communityId)) return null;
    if (operation === "create") return { communityId };
    const invitationId = form.get("invitation_id");
    return isUuid(invitationId) ? { communityId, invitationId } : null;
}
export function parseInvitationPage(input: RequestPageInput) {
    return parseRequestPage(input, true);
}
export function exactProjection(value: unknown, fields: string[]): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
        && Object.keys(value).length === fields.length && fields.every((key) => Object.hasOwn(value, key));
}
export function invitationTimestampMicroseconds(value: unknown): bigint | null {
    if (!isRequestTimestamp(value)) return null;
    // Parse only whole seconds through Date (exact within the validated four-digit
    // year range). Keep all six fractional digits separately as integer microseconds.
    const fraction = /\.(\d{1,6})(?=Z|[+-])/.exec(value);
    const wholeSeconds = fraction ? value.replace(fraction[0], "") : value;
    return BigInt(Date.parse(wholeSeconds)) * BigInt(1000)
        + BigInt((fraction?.[1] ?? "").padEnd(6, "0"));
}
export function validInvitationTimes(value: Record<string, unknown>): boolean {
    const created = invitationTimestampMicroseconds(value.created_at);
    const expires = invitationTimestampMicroseconds(value.expires_at);
    return created !== null && expires !== null
        && expires - created === BigInt(168 * 60 * 60) * BigInt(1000000);
}
