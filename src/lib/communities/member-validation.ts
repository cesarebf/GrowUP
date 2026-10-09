import { isRequestDisplayName, isRequestTimestamp, isUuid, parseRequestPage, type RequestPageInput } from "./request-validation.ts";
import type { CommunityRole } from "./validation.ts";

export type ManagedRole = Exclude<CommunityRole, "owner">;
export type CommunityMember = {
  membership_id: string; management_display_name: string | null; role: CommunityRole; joined_at: string; is_self: boolean;
};
export type RoleResult = { outcome: "changed" | "unchanged" };
export type RemovalResult = { outcome: "removed" | "already_absent" };
export type NameResult = { management_display_name: string | null };
export type ManagementResult<T> = { status: "success"; data: T }
  | { status: "error"; code: "invalid" | "unavailable" | "reconciliation_required"; message: string };
export type MemberLocator = { communityId: string; membershipId: string };
export type RoleInput = MemberLocator & { role: ManagedRole };
export type NameInput = MemberLocator & { name: string | null };
export type ManagementMutation = RoleResult | RemovalResult | NameResult;
export type ManagementActionState = ManagementResult<ManagementMutation> | { status: "idle" };
export type MemberOperation = "role" | "remove" | "name";
export type MemberPageInput = RequestPageInput & { communityId: string };

export function exactMemberFields(value: unknown, fields: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every((key) => Object.hasOwn(value, key));
}
export function isManagedRole(value: unknown): value is ManagedRole {
  return value === "member" || value === "moderator" || value === "admin";
}
export function normalizeManagementName(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const name = value.replace(/^ +| +$/g, "");
  return name === "" ? null : isRequestDisplayName(name) ? name : undefined;
}
export function validMemberInput(value: unknown, operation: MemberOperation): boolean {
  const extra = operation === "role" ? ["role"] : operation === "name" ? ["name"] : [];
  return exactMemberFields(value, ["communityId", "membershipId", ...extra])
    && isUuid(value.communityId) && isUuid(value.membershipId)
    && (operation !== "role" || isManagedRole(value.role))
    && (operation !== "name" || normalizeManagementName(value.name) !== undefined);
}
export function parseMemberForm(form: FormData, operation: MemberOperation): RoleInput | NameInput | MemberLocator | null {
  const fields = ["community_id", "membership_id", ...(operation === "role" ? ["role"] : operation === "name" ? ["name"] : [])];
  for (const [key, value] of form) {
    if (key.startsWith("$ACTION_")) continue;
    if (!fields.includes(key) || typeof value !== "string" || form.getAll(key).length !== 1) return null;
  }
  if (!fields.every(key => form.getAll(key).length === 1 && typeof form.get(key) === "string")) return null;
  const communityId = form.get("community_id"), membershipId = form.get("membership_id");
  if (!isUuid(communityId) || !isUuid(membershipId)) return null;
  const locator = { communityId, membershipId };
  if (operation === "remove") return locator;
  if (operation === "role") { const role = form.get("role"); return isManagedRole(role) ? { ...locator, role } : null; }
  const name = normalizeManagementName(form.get("name"));
  return name !== undefined ? { ...locator, name } : null;
}
export function parseMemberPage(input: MemberPageInput) { return parseRequestPage(input, true); }
export function validCommunityMember(value: unknown): value is CommunityMember {
  return exactMemberFields(value, ["membership_id", "management_display_name", "role", "joined_at", "is_self"])
    && isUuid(value.membership_id) && (value.management_display_name === null || isRequestDisplayName(value.management_display_name))
    && (value.role === "owner" || isManagedRole(value.role)) && isRequestTimestamp(value.joined_at) && typeof value.is_self === "boolean";
}

// Compare exact microseconds and canonical UUID bytes without converting the
// fractional timestamp to a JavaScript Date. Original cursor strings survive.
export function memberTimestampMicros(value: string): bigint {
  const fraction = /\.(\d{1,6})(?=Z|[+-])/.exec(value);
  const seconds = fraction ? value.replace(fraction[0], "") : value;
  return BigInt(Date.parse(seconds)) * BigInt(1000) + BigInt((fraction?.[1] ?? "").padEnd(6, "0"));
}
export function memberAfter(time: string, id: string, previousTime: string, previousId: string): boolean {
  const current = memberTimestampMicros(time), previous = memberTimestampMicros(previousTime);
  return current > previous || current === previous && id.toLowerCase() > previousId.toLowerCase();
}
