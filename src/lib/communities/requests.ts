import "server-only";

import { AuthenticationRequired, getVerifiedUser, reportError, type Client } from "../auth/service.ts";
import { isCommunitySlug } from "./validation.ts";
import {
  cancellationReasons, isRequestDisplayName, isRequestTimestamp, isUuid, parseRequestForm, parseRequestPage, requestStatuses,
  type PendingRequest, type RequestMutation, type RequestOperation, type RequestPageInput, type RequestReceipt, type RequestResult,
} from "./request-validation.ts";

const unavailable = "This request is unavailable. Refresh the page to check its current status.";
const uncertain = "The request could not be confirmed. Refresh to check its status before explicitly trying again.";

function failure(operation: string, error: unknown): { status: "error"; message: string } {
  reportError(operation, error);
  const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
  return { status: "error", message: code === "42501" ? unavailable : code === "22023"
    ? "Invalid request details. Refresh the page and check your input." : uncertain };
}

function hasFields(value: unknown, fields: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every((key) => Object.hasOwn(value, key));
}

function validMutation(value: unknown, operation: RequestOperation, requestId?: string): value is RequestMutation {
  if (!hasFields(value, ["request_id", "status", "outcome", "cancellation_reason"]) || !isUuid(value.request_id)
    || requestId !== undefined && value.request_id.toLowerCase() !== requestId.toLowerCase()
    || !requestStatuses.some((status) => status === value.status)) return false;
  const review = operation === "approve" || operation === "reject";
  const reasons = review ? ["policy_changed", "already_member", "cannot_be_admitted"] : cancellationReasons;
  if (value.status === "cancelled" ? !reasons.some((reason) => reason === value.cancellation_reason) : value.cancellation_reason !== null) return false;
  if (operation === "submit") return value.status === "pending" && ["created", "already_pending"].includes(value.outcome as string);
  if (value.outcome === "already_resolved") return value.status !== "pending";
  if (value.outcome === "cancelled") return review && value.status === "cancelled";
  return value.outcome === "resolved" && value.status === (operation === "approve" ? "approved" : operation === "reject" ? "rejected" : "withdrawn");
}

async function mutate(client: Client, operation: RequestOperation, form: FormData): Promise<RequestResult<RequestMutation>> {
  if (!await getVerifiedUser(client)) throw new AuthenticationRequired();
  const parsed = parseRequestForm(form, operation);
  if (parsed.status === "error") return parsed;
  const { communityId, requestId, displayName } = parsed.data;
  try {
    // RPC names are chosen here, never supplied by a form or browser authority.
    const { data, error } = operation === "submit"
      ? await client.rpc("request_community_membership", { p_community_id: communityId, p_display_name: displayName! })
      : await client.rpc({ withdraw: "withdraw_community_membership_request", approve: "approve_community_membership_request", reject: "reject_community_membership_request" }[operation] as
        "withdraw_community_membership_request" | "approve_community_membership_request" | "reject_community_membership_request",
      { p_community_id: communityId, p_request_id: requestId! });
    if (error) return failure(`request-${operation}`, error);
    if (!Array.isArray(data) || data.length !== 1 || !validMutation(data[0], operation, requestId)) return failure(`request-${operation}-result`, null);
    return { status: "success", data: data[0] };
  } catch (error) {
    // Never automatically retry submission after an ambiguous network result.
    return failure(`request-${operation}`, error);
  }
}

export const submitMembershipRequest = (client: Client, form: FormData) => mutate(client, "submit", form);
export const withdrawMembershipRequest = (client: Client, form: FormData) => mutate(client, "withdraw", form);
export const approveMembershipRequest = (client: Client, form: FormData) => mutate(client, "approve", form);
export const rejectMembershipRequest = (client: Client, form: FormData) => mutate(client, "reject", form);

function validReceipt(value: unknown): value is RequestReceipt {
  if (!hasFields(value, ["request_id", "community_id", "requester_display_name", "status", "created_at", "resolved_at", "cancellation_reason", "community_name", "community_slug"])
    || !isUuid(value.request_id) || !isUuid(value.community_id) || !isRequestDisplayName(value.requester_display_name)
    || !isRequestTimestamp(value.created_at) || !requestStatuses.some((status) => status === value.status)) return false;
  if (value.status === "pending" ? value.resolved_at !== null : !isRequestTimestamp(value.resolved_at) || Date.parse(value.resolved_at) < Date.parse(value.created_at)) return false;
  if (value.status === "cancelled" ? !cancellationReasons.some((reason) => reason === value.cancellation_reason) : value.cancellation_reason !== null) return false;
  return value.community_name === null ? value.community_slug === null
    : typeof value.community_name === "string" && value.community_name.length > 0 && [...value.community_name].length <= 80
      && typeof value.community_slug === "string" && isCommunitySlug(value.community_slug);
}

function validPending(value: unknown): value is PendingRequest {
  return hasFields(value, ["request_id", "requester_display_name", "status", "created_at"])
    && isUuid(value.request_id) && isRequestDisplayName(value.requester_display_name)
    && value.status === "pending" && isRequestTimestamp(value.created_at);
}

export async function getMyMembershipRequests(client: Client, input: RequestPageInput = {}): Promise<RequestResult<RequestReceipt[]>> {
  if (!await getVerifiedUser(client)) throw new AuthenticationRequired();
  const parsed = parseRequestPage(input, false);
  if (parsed.status === "error") return parsed;
  const { communityId, cursorCreatedAt, cursorId, limit } = parsed.data;
  try {
    const { data, error } = await client.rpc("get_my_community_membership_requests", {
      p_community_id: communityId, p_before_created_at: cursorCreatedAt, p_before_id: cursorId, p_limit: limit,
    });
    if (error) return failure("request-history", error);
    if (!Array.isArray(data) || data.length > limit || !data.every(validReceipt)
      || communityId !== undefined && data.some((row) => row.community_id.toLowerCase() !== communityId.toLowerCase())) return failure("request-history-result", null);
    return { status: "success", data };
  } catch (error) { return failure("request-history", error); }
}

export async function listMembershipRequests(client: Client, input: RequestPageInput): Promise<RequestResult<PendingRequest[]>> {
  if (!await getVerifiedUser(client)) throw new AuthenticationRequired();
  const parsed = parseRequestPage(input, true);
  if (parsed.status === "error") return parsed;
  const { communityId, cursorCreatedAt, cursorId, limit } = parsed.data;
  try {
    const { data, error } = await client.rpc("list_community_membership_requests", {
      p_community_id: communityId!, p_after_created_at: cursorCreatedAt, p_after_id: cursorId, p_limit: limit,
    });
    if (error) return failure("request-queue", error);
    if (!Array.isArray(data) || data.length > limit || !data.every(validPending)) return failure("request-queue-result", null);
    return { status: "success", data };
  } catch (error) { return failure("request-queue", error); }
}
