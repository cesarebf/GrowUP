export const requestStatuses = ["pending", "approved", "rejected", "withdrawn", "cancelled"] as const;
export type RequestStatus = typeof requestStatuses[number];
export const cancellationReasons = ["policy_changed", "already_member", "requester_unavailable"] as const;
export type CancellationReason = typeof cancellationReasons[number];
export type ReviewCancellationReason = Exclude<CancellationReason, "requester_unavailable"> | "cannot_be_admitted";
export type RequestOperation = "submit" | "withdraw" | "approve" | "reject";
export type RequestOutcome = "created" | "already_pending" | "resolved" | "already_resolved" | "cancelled";
export type RequestMutation = {
  request_id: string; status: RequestStatus; outcome: RequestOutcome;
  cancellation_reason: CancellationReason | ReviewCancellationReason | null;
};
export type RequesterMutation = Omit<RequestMutation, "cancellation_reason"> & { cancellation_reason: CancellationReason | null };
export type ReviewerMutation = Omit<RequestMutation, "cancellation_reason"> & { cancellation_reason: ReviewCancellationReason | null };
export type RequestReceipt = {
  request_id: string; community_id: string; requester_display_name: string; status: RequestStatus;
  created_at: string; resolved_at: string | null; cancellation_reason: CancellationReason | null;
  community_name: string | null; community_slug: string | null;
};
export type PendingRequest = {
  request_id: string; requester_display_name: string; status: "pending"; created_at: string;
};
export type RequestResult<T> = { status: "success"; data: T } | { status: "error"; message: string };
export type RequestActionState = RequestResult<RequestMutation> | { status: "idle" };

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isRequestDisplayName(value: unknown): value is string {
  return typeof value === "string" && [...value].length >= 1 && [...value].length <= 80
    && value === value.replace(/^ +| +$/g, "")
    && !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value);
}

type RequestInput = { communityId: string; displayName?: string; requestId?: string };
export function parseRequestForm(form: FormData, operation: RequestOperation): RequestResult<RequestInput> {
  const allowed = new Set(operation === "submit" ? ["community_id", "display_name"] : ["community_id", "request_id"]);
  for (const [key, value] of form) {
    // React transport metadata is ignored, never forwarded to the database.
    if (key.startsWith("$ACTION_")) continue;
    if (!allowed.has(key) || typeof value !== "string" || form.getAll(key).length !== 1) {
      return { status: "error", message: "Invalid request fields. Refresh the page and try again." };
    }
  }
  const communityId = form.get("community_id");
  if (!isUuid(communityId)) return { status: "error", message: "Invalid community. Refresh the page and try again." };
  if (operation === "submit") {
    const value = form.get("display_name");
    const displayName = typeof value === "string" ? value.replace(/^ +| +$/g, "") : null;
    if (!isRequestDisplayName(displayName)) return { status: "error", message: "Enter a shared name of 1–80 characters without control characters." };
    return { status: "success", data: { communityId, displayName } };
  }
  const requestId = form.get("request_id");
  if (!isUuid(requestId)) return { status: "error", message: "Invalid request. Refresh the page and try again." };
  return { status: "success", data: { communityId, requestId } };
}

// Preserve PostgreSQL microseconds for stable tuple cursors; never round through
// Date.toISOString(). Accept finite ISO timestamps only, with explicit timezone.
export function isRequestTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || /[\r\n]/.test(value)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour = "0", offsetMinute = "0"] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1]
    && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60
    && Number(offsetHour) <= 14 && Number(offsetMinute) < 60 && Number.isFinite(Date.parse(value));
}

export type RequestPageInput = { communityId?: string; cursorCreatedAt?: string; cursorId?: string; limit?: number };
export function parseRequestPage(input: RequestPageInput, requireCommunity: boolean): RequestResult<RequestPageInput & { limit: number }> {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !["communityId", "cursorCreatedAt", "cursorId", "limit"].includes(key))
    || (requireCommunity || input.communityId !== undefined) && !isUuid(input.communityId)
    || (input.cursorCreatedAt !== undefined || input.cursorId !== undefined)
      && (!isRequestTimestamp(input.cursorCreatedAt) || !isUuid(input.cursorId))
    || input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50)) {
    return { status: "error", message: "Invalid request page. Refresh the page and try again." };
  }
  return { status: "success", data: { ...input, limit: input.limit ?? 20 } };
}
