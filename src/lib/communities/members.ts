import "server-only";
import { AuthenticationRequired, getVerifiedUser, reportError, type Client } from "../auth/service.ts";
import { exactMemberFields, memberAfter, normalizeManagementName, parseMemberPage, validCommunityMember, validMemberInput,
  type CommunityMember, type ManagementResult, type MemberLocator, type MemberPageInput, type NameInput, type NameResult,
  type RemovalResult, type RoleInput, type RoleResult } from "./member-validation.ts";

const invalid = { status: "error", code: "invalid", message: "Invalid management details. Check your input." } as const;
function failure(operation: string, error: unknown, mutation: boolean): ManagementResult<never> {
  reportError(operation, error);
  // Only known SQL denials establish nonexecution. Transport/malformed returns
  // are ambiguous: never automatically replay the intended mutation.
  const denied = !!error && typeof error === "object" && "code" in error && (error.code === "42501" || error.code === "22023");
  return mutation && !denied
    ? { status: "error", code: "reconciliation_required", message: "The result could not be confirmed. Refresh the current membership before explicitly trying again." }
    : { status: "error", code: "unavailable", message: "Community management is unavailable." };
}

export async function listCommunityMembers(client: Client, input: MemberPageInput): Promise<ManagementResult<CommunityMember[]>> {
  if (!await getVerifiedUser(client)) throw new AuthenticationRequired();
  const parsed = parseMemberPage(input);
  if (parsed.status !== "success") return invalid;
  const page = parsed.data;
  try {
    const { data, error } = await client.rpc("list_community_members", {
      p_community_id: page.communityId!, p_after_created_at: page.cursorCreatedAt,
      p_after_membership_id: page.cursorId, p_limit: page.limit,
    });
    if (error || !Array.isArray(data) || data.length > page.limit || !data.every(validCommunityMember))
      return failure("list-community-members", error, false);
    const seen = new Set<string>();
    let time = page.cursorCreatedAt, id = page.cursorId, selfCount = 0;
    for (const row of data) {
      if (seen.has(row.membership_id.toLowerCase()) || time && id && !memberAfter(row.joined_at, row.membership_id, time, id)
        || row.is_self && ++selfCount > 1) return failure("list-community-members", null, false);
      seen.add(row.membership_id.toLowerCase());
      time = row.joined_at; id = row.membership_id;
    }
    return { status: "success", data };
  } catch (error) { return failure("list-community-members", error, false); }
}

export async function setCommunityMemberRole(client: Client, input: RoleInput): Promise<ManagementResult<RoleResult>> {
  if (!await getVerifiedUser(client)) throw new AuthenticationRequired();
  if (!validMemberInput(input, "role")) return invalid;
  try {
    const { data, error } = await client.rpc("set_community_member_role", {
      p_community_id: input.communityId, p_membership_id: input.membershipId, p_role: input.role,
    });
    if (error || !Array.isArray(data) || data.length !== 1 || !exactMemberFields(data[0], ["outcome"])
      || !["changed", "unchanged"].includes(data[0].outcome)) return failure("set-community-member-role", error, true);
    return { status: "success", data: data[0] };
  } catch (error) { return failure("set-community-member-role", error, true); }
}

export async function removeCommunityMember(client: Client, input: MemberLocator): Promise<ManagementResult<RemovalResult>> {
  if (!await getVerifiedUser(client)) throw new AuthenticationRequired();
  if (!validMemberInput(input, "remove")) return invalid;
  try {
    const { data, error } = await client.rpc("remove_community_member", {
      p_community_id: input.communityId, p_membership_id: input.membershipId,
    });
    if (error || !Array.isArray(data) || data.length !== 1 || !exactMemberFields(data[0], ["outcome"])
      || !["removed", "already_absent"].includes(data[0].outcome)) return failure("remove-community-member", error, true);
    return { status: "success", data: data[0] };
  } catch (error) { return failure("remove-community-member", error, true); }
}

export async function setMyCommunityManagementName(client: Client, input: NameInput): Promise<ManagementResult<NameResult>> {
  if (!await getVerifiedUser(client)) throw new AuthenticationRequired();
  if (!validMemberInput(input, "name")) return invalid;
  const name = normalizeManagementName(input.name) ?? null;
  try {
    const { data, error } = await client.rpc("set_my_community_management_name", {
      p_community_id: input.communityId, p_membership_id: input.membershipId, p_name: name,
    });
    if (error || !Array.isArray(data) || data.length !== 1 || !exactMemberFields(data[0], ["management_display_name"])
      || data[0].management_display_name !== name) return failure("set-my-community-management-name", error, true);
    return { status: "success", data: data[0] };
  } catch (error) { return failure("set-my-community-management-name", error, true); }
}
