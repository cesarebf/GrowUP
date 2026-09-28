export const visibilities = ["public", "unlisted", "private"] as const;
export const joinPolicies = ["instant", "approval_required", "invitation_only"] as const;
export type Visibility = typeof visibilities[number];
export type JoinPolicy = typeof joinPolicies[number];
export type CommunityRole = "member" | "moderator" | "admin" | "owner";
export type CommunityInput = {
  name: string; slug: string; description: string; visibility: Visibility; join_policy: JoinPolicy;
};
export type CommunitySettingsInput = Omit<CommunityInput, "slug">;

function invalidName(name: string) {
  return !name || [...name].length > 80 || /[\u0000-\u001f\u007f]/.test(name);
}

function invalidDescription(description: string) {
  return [...description].length > 500 || /[\u0000-\u001f\u007f]/.test(description);
}

export function parseCommunitySettings(form: FormData): { input: CommunitySettingsInput; communityId: string; error?: never } | { error: string; input?: never; communityId?: never } {
  const allowed = new Set(["community_id", "name", "description", "visibility", "join_policy"]);
  for (const [key, value] of form) {
    // React adds transport metadata to progressive-enhancement submissions.
    // It is never interpreted as a settings field or forwarded to the RPC.
    if (key.startsWith("$ACTION_")) continue;
    if (!allowed.has(key) || typeof value !== "string" || form.getAll(key).length !== 1) {
      return { error: "Invalid settings fields. Refresh the page and try again." };
    }
  }
  const communityId = form.get("community_id");
  if (typeof communityId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(communityId)) {
    return { error: "Invalid community. Refresh the page and try again." };
  }
  // Match PostgreSQL btrim (outer ASCII spaces) and its existing constraints.
  const name = (form.get("name") as string | null ?? "").replace(/^ +| +$/g, "");
  const description = (form.get("description") as string | null ?? "").replace(/^ +| +$/g, "");
  const visibility = form.get("visibility");
  const joinPolicy = form.get("join_policy");
  if (invalidName(name)) {
    return { error: "Enter a name of 1–80 characters without control characters." };
  }
  if (invalidDescription(description)) {
    return { error: "Use a description of up to 500 characters on one line." };
  }
  if (!visibilities.some((value) => value === visibility)) return { error: "Choose a visibility." };
  if (!joinPolicies.some((value) => value === joinPolicy)) return { error: "Choose a join policy." };
  return { communityId, input: { name, description, visibility: visibility as Visibility, join_policy: joinPolicy as JoinPolicy } };
}

const reservedSlugs = new Set(["new", "admin", "api", "auth", "account", "communities", "settings", "support", "help", "growup", "www"]);
export function isCommunitySlug(slug: string) {
  return slug.length >= 3 && slug.length <= 48 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && !reservedSlugs.has(slug);
}

export function parseCommunityInput(form: FormData): { input: CommunityInput; error?: never } | { error: string; input?: never } {
  const field = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };
  const name = field("name").trim();
  const slug = field("slug").trim().toLowerCase();
  const description = field("description").trim();
  const visibility = field("visibility");
  const joinPolicy = field("join_policy");
  if (invalidName(name)) {
    return { error: "Enter a name of 1–80 characters without control characters." };
  }
  if (!isCommunitySlug(slug)) {
    return { error: "Use 3–48 letters, numbers, or single hyphens for the URL. Reserved names are unavailable." };
  }
  if (invalidDescription(description)) {
    return { error: "Use a description of up to 500 characters on one line." };
  }
  if (!visibilities.some((value) => value === visibility)) return { error: "Choose a visibility." };
  if (!joinPolicies.some((value) => value === joinPolicy)) return { error: "Choose a join policy." };
  return { input: { name, slug, description, visibility: visibility as Visibility, join_policy: joinPolicy as JoinPolicy } };
}
