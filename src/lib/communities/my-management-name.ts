import "server-only";
import { AuthenticationRequired, getVerifiedUser, reportError, type Client } from "../auth/service.ts";
import { exactMemberFields, normalizeManagementName } from "./member-validation.ts";
import { isUuid } from "./request-validation.ts";

// Existing own-membership SELECT/RLS surface. No other member or profile read.
export async function readMyManagementName(client: Client, communityId: string) {
  const user = await getVerifiedUser(client);
  if (!user) throw new AuthenticationRequired();
  try {
    if (!isUuid(communityId)) throw new Error();
    const { data, error } = await client.from("community_memberships")
      .select("membership_id, management_display_name").eq("community_id", communityId).eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (!exactMemberFields(data, ["membership_id", "management_display_name"]) || !isUuid(data.membership_id)
      || (data.management_display_name !== null && typeof data.management_display_name !== "string")
      || normalizeManagementName(data.management_display_name) !== data.management_display_name) throw new Error();
    return { membership_id: data.membership_id, management_display_name: data.management_display_name };
  } catch (error) {
    reportError("read-my-management-name", error);
    throw new Error("Your community membership is temporarily unavailable. Refresh before trying again.");
  }
}
