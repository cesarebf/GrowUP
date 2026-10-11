import { parseMemberPage, type CommunityMember, type ManagedRole } from "./member-validation.ts";
import type { CommunityRole } from "./validation.ts";
import type { RequestSearchParams } from "./request-presentation.ts";

export const memberPageSize = 20;
export const roleLabels = { owner: "Owner", admin: "Admin", moderator: "Moderator", member: "Member" };

// Presentation only: each mutation independently authorizes current DB state.
export function memberRoleChoices(actor: CommunityRole, row: CommunityMember): ManagedRole[] {
  if (row.is_self || row.role === "owner") return [];
  const roles: ManagedRole[] = actor === "owner" ? ["member", "moderator", "admin"]
    : actor === "admin" && row.role !== "admin" ? ["member", "moderator"] : [];
  return roles.filter(role => role !== row.role);
}

export function memberPageInput(search: RequestSearchParams, communityId: string) {
  const invalid = { status: "error", message: "Invalid member page. Return to the first page." } as const;
  if (Object.keys(search).some(key => !["at", "id"].includes(key)) || Array.isArray(search.at) || Array.isArray(search.id)) return invalid;
  const input = { communityId, limit: memberPageSize,
    ...(search.at !== undefined ? { cursorCreatedAt: search.at } : {}),
    ...(search.id !== undefined ? { cursorId: search.id } : {}) };
  return parseMemberPage(input).status === "success" ? { status: "success", data: input } as const : invalid;
}

export function nextMemberPage(path: string, row: CommunityMember) {
  return `${path}?${new URLSearchParams({ at: row.joined_at, id: row.membership_id })}`;
}
