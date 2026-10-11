import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { ReactNode } from "react";
import type { CommunityMember } from "../src/lib/communities/member-validation.ts";
import type { CommunityRole } from "../src/lib/communities/validation.ts";
import { applicationLoader } from "./helpers/application-loader.mts";
const require = createRequire(import.meta.url);
const React = require("../node_modules/react/index.js") as typeof import("react");
const tenant = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
const stamp = "2026-10-08T12:00:00.123456Z";
const row: CommunityMember = { membership_id: id, management_display_name: "River", role: "member", joined_at: stamp, is_self: false };
const base = { id: tenant, name: "Garden", slug: "garden", description: null, visibility: "private", join_policy: "invitation_only", viewer_role: "owner" };
let community: Record<string, unknown> | null, user: unknown, rows: unknown[], readError: unknown, mutation: unknown, own: unknown;
let hookState: unknown, pending = false, effects: (() => void)[];
let reducer: (previous: unknown, form: FormData) => Promise<{ status: string; message?: string }>;
const refresh = mock.fn();
const router = { refresh };
const rpc = mock.fn(async (name: string, ...args: unknown[]) => {
  void args;
  if (name === "get_community_landing") return { data: community ? [community] : [], error: null };
  if (name === "list_community_members") return { data: rows, error: readError };
  return mutation;
});
const select = mock.fn((value: string) => { void value; return query; });
const eq = mock.fn((key: string, value: string) => { void key; void value; return query; });
const query = { select, eq, maybeSingle: async () => ({ data: own, error: readError }) };
const from = mock.fn((table: string) => { assert.equal(table, "community_memberships"); return query; });
applicationLoader({
  react: { ...React, useActionState: (run: typeof reducer, initial: unknown) => { reducer = run; return [hookState ?? initial, () => {}, pending]; }, useEffect: (run: () => void) => { effects.push(run); } },
  "next/link": { useLinkStatus: () => ({ pending }), default: ({ children, prefetch, ...props }: { children: ReactNode; prefetch?: boolean }) => { assert.equal(prefetch, false); return React.createElement("a", props, children); } },
  "next/navigation": { useRouter: () => router, redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not-found"); } },
  "next/cache": { revalidatePath: () => {} },
  "@/lib/supabase/server": { createClient: async () => ({ rpc, from, auth: { getUser: async () => ({ data: { user }, error: null }) } }) },
  "@/lib/supabase/config": { isSupabaseConfigured: () => true },
}, true);
const { renderToStaticMarkup: render } = await import("react-dom/server");
const pageModule = await import("../src/app/c/[slug]/members/page.tsx");
const { default: selfPage } = await import("../src/app/c/[slug]/membership/page.tsx");
const { default: Loading } = await import("../src/app/c/[slug]/members/loading.tsx");
const { CommunityMembers } = await import("../src/components/community-members.tsx");
const { CommunityManagementName } = await import("../src/components/community-management-name.tsx");
const { MemberPageLink } = await import("../src/components/member-page-link.tsx");
const { memberRoleChoices, nextMemberPage } = await import("../src/lib/communities/member-presentation.ts");
const { readMyManagementName } = await import("../src/lib/communities/my-management-name.ts");
const params = Promise.resolve({ slug: "garden" });
const page = (search = {}) => pageModule.default({ params, searchParams: Promise.resolve(search) });
const roster = (actorRole: CommunityRole = "owner", members = [row]) => render(React.createElement(CommunityMembers, { communityId: tenant, actorRole, members }));
const nameForm = (currentName: string | null = "Old name") => render(React.createElement(CommunityManagementName, { communityId: tenant, membershipId: id, currentName }));
function form(extra: Record<string, string>) { const value = new FormData(); for (const [key, text] of Object.entries({ community_id: tenant, membership_id: id, ...extra })) value.set(key, text); return value; }
const idle = { status: "idle" };
beforeEach(() => {
  community = { ...base }; user = { id: "PRIVATE-auth-id", email: "PRIVATE@example.test", email_confirmed_at: stamp };
  rows = [row]; readError = null; mutation = { data: [{ outcome: "changed" }], error: null };
  own = { membership_id: id, management_display_name: "My name" };
  hookState = undefined; pending = false; effects = [];
  for (const fn of [rpc, select, eq, from, refresh]) fn.mock.resetCalls();
});

describe("member management UI", () => {
  for (const role of ["owner", "admin"]) it(`${role} renders safe authorized roster`, async () => {
    community!.viewer_role = role;
    const html = render(await page()); assert.match(html, /River|Joined|Member|End of the current roster/);
    assert.doesNotMatch(html, /PRIVATE|owner_user_id|email|eligibility|audit/);
    assert.deepEqual(rpc.mock.calls.at(-1)!.arguments[1], { p_community_id: tenant, p_after_created_at: undefined, p_after_membership_id: undefined, p_limit: 20 });
    assert.equal(from.mock.callCount(), 0);
  });
  for (const role of ["member", "moderator", null]) it(`${role} cannot load management`, async () => {
    community!.viewer_role = role; await assert.rejects(page(), /not-found/); assert.equal(rpc.mock.callCount(), 1);
  });
  it("anonymous viewer redirects before reads", async () => { user = null; await assert.rejects(page(), /redirect:\/sign-in/); assert.equal(rpc.mock.callCount(), 0); });
  for (const actor of ["owner", "admin", "moderator", "member"] as const)
    for (const target of ["owner", "admin", "moderator", "member"] as const)
      for (const self of [false, true]) it(`${actor} controls for ${target}, self=${self}`, () => {
        const targetRow = { ...row, role: target, is_self: self };
        const expected = !self && target !== "owner" && (actor === "owner" || actor === "admin" && target !== "admin")
          ? (actor === "owner" ? ["member", "moderator", "admin"] : ["member", "moderator"]).filter(role => role !== target) : [];
        assert.deepEqual(memberRoleChoices(actor, targetRow), expected);
        const html = roster(actor, [targetRow]);
        for (const role of ["member", "moderator", "admin"]) assert.equal(html.includes(`Make ${role}`), expected.includes(role));
        assert.equal(html.includes("Remove member"), expected.length > 0);
      });
  it("neutral names, escaping, and no visible locator", () => {
    assert.match(roster("owner", [{ ...row, management_display_name: null }]), /Unnamed member/);
    const html = roster("owner", [{ ...row, management_display_name: "<img src=x>" }]);
    assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/);
    assert.equal(html.replace(/<[^>]*>/g, "").includes(id), false);
  });
  it("role submission calls the existing action with only approved fields", async () => {
    roster(); hookState = await reducer(idle, form({ operation: "role", role: "moderator" }));
    assert.deepEqual(rpc.mock.calls[0].arguments, ["set_community_member_role", { p_community_id: tenant, p_membership_id: id, p_role: "moderator" }]);
    assert.match(roster(), /Member role updated/); effects.forEach(run => run()); assert.equal(refresh.mock.callCount(), 1);
    await reducer(hookState, form({ operation: "role", role: "moderator" })); assert.equal(rpc.mock.callCount(), 1);
  });
  it("same-role and invalid choices do not submit", async () => {
    for (const role of ["member", "owner"]) { roster(); assert.equal((await reducer(idle, form({ operation: "role", role }))).status, "error"); }
    assert.equal(rpc.mock.callCount(), 0);
  });
  it("removal requires explicit confirmation and explains return eligibility", async () => {
    const html = roster(); assert.match(html, /type="checkbox"[^>]*required/); assert.match(html, /not a ban/); assert.match(html, /may join again/);
    assert.equal((await reducer(idle, form({ operation: "remove" }))).status, "error"); assert.equal(rpc.mock.callCount(), 0);
  });
  for (const outcome of ["removed", "already_absent"]) it(`${outcome} removes row and refreshes without error or replay`, async () => {
    mutation = { data: [{ outcome }], error: null }; roster(); hookState = await reducer(idle, form({ operation: "remove", confirm: "yes" }));
    const html = roster(); assert.doesNotMatch(html, /River|role="alert"/); assert.match(html, outcome === "removed" ? /Member removed/ : /already absent/);
    effects.forEach(run => run()); assert.equal(refresh.mock.callCount(), 1);
    assert.deepEqual(rpc.mock.calls[0].arguments, ["remove_community_member", { p_community_id: tenant, p_membership_id: id }]);
  });
  for (const code of ["42501", "22023", "503"]) it(`${code} is safe and hides stale roster while refreshing`, async () => {
    mutation = { data: null, error: { code, message: "PRIVATE SQL detail" } };
    const log = mock.method(console, "error", () => {});
    try { roster(); hookState = await reducer(idle, form({ operation: "role", role: "admin" })); const html = roster();
      assert.match(html, /role="alert"/); assert.doesNotMatch(html, /PRIVATE|River|Make admin/); effects.forEach(run => run()); assert.equal(refresh.mock.callCount(), 1);
      await reducer(hookState, form({ operation: "role", role: "admin" })); assert.equal(rpc.mock.callCount(), 1);
    } finally { log.mock.restore(); }
  });
  it("authoritative roster denial renders no names or controls", async () => {
    readError = { code: "42501", message: "PRIVATE" }; const log = mock.method(console, "error", () => {});
    try { const html = render(await page()); assert.match(html, /management is unavailable/); assert.doesNotMatch(html, /River|Make admin|PRIVATE/); } finally { log.mock.restore(); }
  });
  for (const field of ["email", "user_id", "owner_user_id", "location", "eligibility", "audit"])
    it(`rejects unexpected ${field} in projection`, async () => {
      rows = [{ ...row, [field]: "PRIVATE" }]; const log = mock.method(console, "error", () => {});
      try { assert.doesNotMatch(render(await page()), /PRIVATE|River|Make admin/); } finally { log.mock.restore(); }
    });
  it("pagination preserves exact paired keyset and uses 20 rows", async () => {
    rows = Array.from({ length: 20 }, (_, index) => ({ ...row, membership_id: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}` }));
    assert.match(render(await page()), /Next page/);
    const search = Object.fromEntries(new URL(nextMemberPage("/c/garden/members", row), "http://localhost").searchParams);
    rows = []; const html = render(await page(search)); assert.match(html, /No members on this page|End of the current roster/); assert.doesNotMatch(html, /Next page/);
    assert.deepEqual(rpc.mock.calls.at(-1)!.arguments[1], { p_community_id: tenant, p_after_created_at: stamp, p_after_membership_id: id, p_limit: 20 });
  });
  for (const search of [{ at: stamp }, { id }, { at: [stamp, stamp], id }, { offset: "20" }]) it("invalid cursor offers recovery without a list read", async () => {
    assert.match(render(await page(search)), /Invalid member page|First page/); assert.equal(rpc.mock.callCount(), 1);
  });
  it("loading and pending controls are accessible", () => {
    assert.match(render(React.createElement(Loading)), /role="status"/);
    pending = true; const html = roster(); assert.match(html, /aria-busy="true"/); assert.match(html, /Updating membership/);
    assert.match(render(MemberPageLink({ href: "/c/garden/members", children: "Next page" })), /Loading members/);
    assert.ok([...html.matchAll(/<button[^>]*>/g)].every(match => match[0].includes("disabled")));
  });
});

describe("own management name UI", () => {
  for (const role of ["owner", "admin", "moderator", "member"]) it(`${role} can read only own current name`, async () => {
    community!.viewer_role = role; const html = render(await selfPage({ params })); assert.match(html, /value="My name"/); assert.doesNotMatch(html, /PRIVATE/);
    assert.deepEqual(select.mock.calls[0].arguments, ["membership_id, management_display_name"]);
    assert.deepEqual(eq.mock.calls.map(call => call.arguments), [["community_id", tenant], ["user_id", "PRIVATE-auth-id"]]);
  });
  it("stale membership produces not found and no form", async () => { own = null; await assert.rejects(selfPage({ params }), /not-found/); });
  it("nonmember cannot read own settings", async () => { community!.viewer_role = null; await assert.rejects(selfPage({ params }), /not-found/); assert.equal(from.mock.callCount(), 0); });
  it("label, notice, current value, and clear control are present", () => {
    const html = nameForm(); assert.match(html, /value="Old name"/); assert.match(html, /Visible to you and this community/); assert.match(html, /current owner and admins/); assert.match(html, /Clear field/); assert.match(html, /<label[^>]*for=/);
  });
  for (const name of ["New name", "Changed name", "   ", "", "😀".repeat(80)]) it(`saves or clears valid name (${Array.from(name).length} codepoints)`, async () => {
    const normalized = name.replace(/^ +| +$/g, "") || null;
    mutation = { data: [{ management_display_name: normalized }], error: null }; nameForm(); hookState = await reducer(idle, form({ name }));
    assert.deepEqual(rpc.mock.calls[0].arguments, ["set_my_community_management_name", { p_community_id: tenant, p_membership_id: id, p_name: normalized }]);
    assert.match(nameForm(), normalized ? /Management name saved/ : /Management name cleared/);
    effects.forEach(run => run()); assert.equal(refresh.mock.callCount(), 1);
  });
  for (const name of ["😀".repeat(81), "a\nb", "a\u0000b", "\t"]) it("invalid names fail locally without mutation", async () => {
    nameForm(); hookState = await reducer(idle, form({ name })); assert.equal((hookState as { status: string }).status, "invalid"); assert.equal(rpc.mock.callCount(), 0); assert.match(nameForm(), /without control characters/);
  });
  it("client count treats supplementary characters as one and does not impose UTF-16 maxLength", () => {
    const html = nameForm("😀".repeat(80)); assert.match(html, /80\/80/); assert.doesNotMatch(html, /maxLength|aria-invalid="true"/);
    assert.match(nameForm("😀".repeat(81)), /aria-invalid="true"/);
  });
  it("safe error locks and refreshes stale self state", async () => {
    mutation = { data: null, error: { code: "42501", message: "PRIVATE" } }; const log = mock.method(console, "error", () => {});
    try { nameForm(); hookState = await reducer(idle, form({ name: "New" })); assert.doesNotMatch(nameForm(), /PRIVATE/); effects.forEach(run => run()); assert.equal(refresh.mock.callCount(), 1);
      await reducer(hookState, form({ name: "New" })); assert.equal(rpc.mock.callCount(), 1);
    } finally { log.mock.restore(); }
  });
  it("own reader rejects malformed and expanded projections safely", async () => {
    const log = mock.method(console, "error", () => {});
    try {
      for (const value of [{ membership_id: id, management_display_name: "Name", email: "PRIVATE" }, { membership_id: id, management_display_name: undefined }]) {
        own = value; await assert.rejects(selfPage({ params }), /temporarily unavailable/);
      }
      assert.doesNotMatch(JSON.stringify(log.mock.calls), /PRIVATE/);
    } finally { log.mock.restore(); }
  });
  it("own reader rejects unauthenticated identity before a query", async () => {
    const client = { auth: { getUser: async () => ({ data: { user: null }, error: null }) }, from };
    await assert.rejects(readMyManagementName(client as never, tenant)); assert.equal(from.mock.callCount(), 0);
  });
});
