import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { AuthenticationRequired, getVerifiedUser, reportError, type Client } from "../auth/service.ts";
import { isCommunitySlug } from "./validation.ts";
import { isUuid, isRequestTimestamp, type RequestPageInput } from "./request-validation.ts";
import { exactProjection, invitationPath, invitationTimestampMicroseconds, invitationUnavailable, isInvitationToken, parseInvitationForm, parseInvitationPage, validInvitationTimes, type InvitationResult, type InvitationDelivery, type InvitationHistory, type InvitationPreview, type InvitationAdmission, } from "./invitation-validation.ts";
export function generateInvitationToken() { return randomBytes(32).toString("hex"); }
export function hashInvitationToken(token: string) {
    if (!isInvitationToken(token))
        throw new Error("Invalid invitation token.");
    return createHash("sha256").update(token, "utf8").digest("hex");
}
const invalid = { status: "error", message: "Invalid invitation details. Refresh and check your input." } as const;
function failure(operation: string, error: unknown) {
    reportError(operation, error);
    return { status: "error", message: "The invitation result could not be confirmed. Refresh its status before explicitly trying again." } as const;
}
const receiptFields = ["invitation_id", "created_at", "expires_at"];
const historyFields = [...receiptFields, "status", "accepted_at", "revoked_at"];
function validHistory(value: unknown): value is InvitationHistory {
    if (!exactProjection(value, historyFields) || !isUuid(value.invitation_id) || !validInvitationTimes(value)
        || !["active", "accepted", "revoked", "expired"].includes(value.status as string))
        return false;
    const created = invitationTimestampMicroseconds(value.created_at)!;
    const expires = invitationTimestampMicroseconds(value.expires_at)!;
    for (const key of ["accepted_at", "revoked_at"]) {
        if (value[key] === null) continue;
        const resolved = invitationTimestampMicroseconds(value[key]);
        if (resolved === null || resolved < created || resolved >= expires)
            return false;
    }
    return value.status === "accepted" ? value.accepted_at !== null && value.revoked_at === null
        : value.status === "revoked" ? value.revoked_at !== null && value.accepted_at === null
            : value.accepted_at === null && value.revoked_at === null;
}
function validAdmission(value: unknown): value is InvitationAdmission {
    return exactProjection(value, ["outcome", "community_slug"])
        && ["accepted", "already_member", "unavailable"].includes(value.outcome as string)
        && (value.outcome === "unavailable" ? value.community_slug === null : value.community_slug === null
            ? value.outcome === "accepted" : typeof value.community_slug === "string" && isCommunitySlug(value.community_slug));
}
function validPreview(value: unknown): value is InvitationPreview {
    if (!exactProjection(value, Object.keys(invitationUnavailable)))
        return false;
    if (value.outcome === "unavailable")
        return Object.entries(invitationUnavailable).every(([key, expected]) => value[key] === expected);
    if (value.outcome !== "active" && value.outcome !== "accepted")
        return false;
    if (value.community_name === null)
        return value.outcome === "accepted" && ["community_description", "expires_at", "already_member", "community_slug"].every((key) => value[key] === null);
    if (typeof value.community_name !== "string" || [...value.community_name].length < 1 || [...value.community_name].length > 80
        || typeof value.community_description !== "string" || [...value.community_description].length > 500
        || !isRequestTimestamp(value.expires_at) || typeof value.already_member !== "boolean")
        return false;
    return value.outcome === "active" ? value.community_slug === null
        : value.already_member === true && typeof value.community_slug === "string" && isCommunitySlug(value.community_slug);
}
export async function createInvitation(client: Client, form: FormData): Promise<InvitationResult<InvitationDelivery>> {
    if (!await getVerifiedUser(client))
        throw new AuthenticationRequired();
    const parsed = parseInvitationForm(form, "create");
    if (!parsed)
        return invalid;
    try {
        // Generated once; only the digest crosses the creation RPC boundary. No retry.
        const token = generateInvitationToken();
        const { data, error } = await client.rpc("create_community_invitation", { p_community_id: parsed.communityId, p_token_hash: hashInvitationToken(token) });
        if (error)
            return failure("invitation-create", error);
        const value: unknown = Array.isArray(data) && data.length === 1 ? data[0] : null;
        if (!exactProjection(value, receiptFields) || !isUuid(value.invitation_id) || !validInvitationTimes(value))
            return failure("invitation-create-result", null);
        return { status: "success", data: { invitation_id: value.invitation_id, created_at: value.created_at as string, expires_at: value.expires_at as string, path: invitationPath(token)! } };
    }
    catch (error) {
        return failure("invitation-create", error);
    }
}
export async function listInvitations(client: Client, input: RequestPageInput): Promise<InvitationResult<InvitationHistory[]>> {
    if (!await getVerifiedUser(client))
        throw new AuthenticationRequired();
    const parsed = parseInvitationPage(input);
    if (parsed.status === "error")
        return invalid;
    const { communityId, cursorCreatedAt, cursorId, limit } = parsed.data;
    try {
        const { data, error } = await client.rpc("list_community_invitations", { p_community_id: communityId!, p_before_created_at: cursorCreatedAt, p_before_id: cursorId, p_limit: limit });
        if (error || !Array.isArray(data) || data.length > limit || !data.every(validHistory))
            return failure("invitation-list", error);
        return { status: "success", data };
    }
    catch (error) {
        return failure("invitation-list", error);
    }
}
export async function revokeInvitation(client: Client, form: FormData): Promise<InvitationResult<InvitationHistory>> {
    if (!await getVerifiedUser(client))
        throw new AuthenticationRequired();
    const parsed = parseInvitationForm(form, "revoke");
    if (!parsed)
        return invalid;
    try {
        const { data, error } = await client.rpc("revoke_community_invitation", { p_community_id: parsed.communityId, p_invitation_id: parsed.invitationId });
        if (error || !Array.isArray(data) || data.length !== 1 || !validHistory(data[0]) || data[0].invitation_id.toLowerCase() !== parsed.invitationId.toLowerCase())
            return failure("invitation-revoke", error);
        return { status: "success", data: data[0] };
    }
    catch (error) {
        return failure("invitation-revoke", error);
    }
}
export async function previewInvitation(client: Client, token: unknown): Promise<InvitationResult<InvitationPreview>> {
    if (!isInvitationToken(token))
        return { status: "success", data: { ...invitationUnavailable } };
    try {
        const { data, error } = await client.rpc("get_community_invitation_preview", { p_token: token });
        if (error || !Array.isArray(data) || data.length !== 1 || !validPreview(data[0]))
            return failure("invitation-preview", error);
        return { status: "success", data: data[0] };
    }
    catch (error) {
        return failure("invitation-preview", error);
    }
}
export async function acceptInvitation(client: Client, form: FormData): Promise<InvitationResult<InvitationAdmission>> {
    if (!await getVerifiedUser(client))
        throw new AuthenticationRequired();
    const parsed = parseInvitationForm(form, "accept");
    if (!parsed)
        return invalid;
    try {
        const { data, error } = await client.rpc("accept_community_invitation", { p_token: parsed.token });
        if (error || !Array.isArray(data) || data.length !== 1 || !validAdmission(data[0]))
            return failure("invitation-accept", error);
        return { status: "success", data: data[0] };
    }
    catch (error) {
        return failure("invitation-accept", error);
    }
}
