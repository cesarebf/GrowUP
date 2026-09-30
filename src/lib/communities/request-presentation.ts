import type { RequestMutation, RequestPageInput, RequestStatus } from "./request-validation.ts";
import { parseRequestPage } from "./request-validation.ts";

export const requestPageSize = 20;

export function requestStatusMessage(request: Pick<RequestMutation, "status" | "cancellation_reason">): string {
  const messages: Record<RequestStatus, string> = {
    pending: "Approval pending. This request does not grant member access.",
    approved: "Request approved. Current membership may have changed since this attempt.",
    rejected: "Request rejected.",
    withdrawn: "Request withdrawn.",
    cancelled: request.cancellation_reason === "policy_changed"
      ? "Request cancelled because the community's admission settings changed."
      : request.cancellation_reason === "already_member"
        ? "Request cancelled because membership already existed."
        : "Request cancelled because the requester could not be admitted.",
  };
  return messages[request.status];
}

export function requestOutcomeMessage(result: RequestMutation): string {
  const prefix = result.outcome === "already_resolved" ? "This attempt was already resolved. "
    : result.outcome === "already_pending" ? "You already have a pending request; no new attempt was created. " : "";
  return prefix + requestStatusMessage(result);
}

export type RequestSearchParams = Record<string, string | string[] | undefined>;

// URL cursors are untrusted. Preserve microseconds and validate both tuple parts.
export function requestPageInput(search: RequestSearchParams, communityId?: string) {
  if (Object.keys(search).some((key) => !["at", "id"].includes(key))
    || Array.isArray(search.at) || Array.isArray(search.id)) {
    return { status: "error", message: "Invalid request page. Return to the first page." } as const;
  }
  const input: RequestPageInput = { limit: requestPageSize };
  if (communityId !== undefined) input.communityId = communityId;
  if (search.at !== undefined) input.cursorCreatedAt = search.at;
  if (search.id !== undefined) input.cursorId = search.id;
  return parseRequestPage(input, communityId !== undefined);
}

export function nextRequestPage(path: string, row: { created_at: string; request_id: string }) {
  return `${path}?${new URLSearchParams({ at: row.created_at, id: row.request_id })}`;
}

export function requestDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}
