import "server-only";

import { AuthenticationRequired, getVerifiedUser, reportError, type Client } from "../auth/service.ts";
import { isCommunitySlug, parseCommunityInput } from "./validation.ts";

export type CreateCommunityResult = { status: "error"; message: string } | { status: "success"; slug: string };

export async function createCommunity(client: Client, form: FormData): Promise<CreateCommunityResult> {
  if (!await getVerifiedUser(client)) throw new AuthenticationRequired();
  const parsed = parseCommunityInput(form);
  if (parsed.error !== undefined) return { status: "error", message: parsed.error };
  const input = parsed.input;
  const { data, error } = await client.rpc("create_community", {
    p_name: input.name, p_slug: input.slug, p_description: input.description,
    p_visibility: input.visibility, p_join_policy: input.join_policy,
  });
  if (error || !data) {
    if (error?.code === "23505") return { status: "error", message: "That community URL is unavailable. Choose another." };
    reportError("create-community", error);
    return { status: "error", message: "Your community could not be created. Check Your communities before retrying." };
  }
  return { status: "success", slug: input.slug };
}

export async function readCommunity(client: Client, slug: string) {
  if (!isCommunitySlug(slug)) return null;
  const { data, error } = await client.rpc("get_community_landing", { p_slug: slug });
  if (error) {
    reportError("read-community", error);
    throw new Error("This community is temporarily unavailable. Please try again.");
  }
  return data?.[0] ?? null;
}

export async function listMyCommunities(client: Client) {
  const user = await getVerifiedUser(client);
  if (!user) throw new AuthenticationRequired();
  // Both sides of the join retain RLS. No separate, unscoped discovery query.
  const { data, error } = await client.from("community_memberships")
    .select("role, communities!community_memberships_community_id_fkey(id, name, slug, visibility)")
    .eq("user_id", user.id).order("created_at", { ascending: false });
  if (error) {
    reportError("list-my-communities", error);
    throw new Error("Your communities are temporarily unavailable. Please try again.");
  }
  return data;
}
