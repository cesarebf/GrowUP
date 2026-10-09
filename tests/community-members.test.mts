import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createClient, type User } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types.ts";
import { AuthenticationRequired, type Client } from "../src/lib/auth/service.ts";
import { listCommunityMembers, removeCommunityMember, setCommunityMemberRole, setMyCommunityManagementName } from "../src/lib/communities/members.ts";
import { normalizeManagementName, type MemberPageInput, type RoleInput, type NameInput, type MemberLocator } from "../src/lib/communities/member-validation.ts";
const communityId = "11111111-1111-4111-8111-111111111111", membershipId = "22222222-2222-4222-8222-222222222222";
const locator = { communityId, membershipId }, roleInput: RoleInput = { ...locator, role: "moderator" }, nameInput = { ...locator, name: "Name" };
const user = { id: "verified-by-getUser", email_confirmed_at: "2026-01-01T00:00:00Z" };
function client(data: unknown, error: unknown = null, candidate: unknown = user, throws = false) {
  const rpc = mock.fn(async (...args: unknown[]) => { void args; if (throws) throw error; return { data, error }; });
  return { rpc, value: { auth: { getUser: async () => ({ data: { user: candidate }, error: null }) }, rpc } as unknown as Client };
}
const row = { membership_id: membershipId, management_display_name: null, role: "member", joined_at: "2026-10-08T01:02:03.123456Z", is_self: false };
describe("member-management services and strict boundaries", () => {
  const operations = [
    { name: "role", input: roleInput, run: (c: Client, input: unknown) => setCommunityMemberRole(c, input as RoleInput), result: { outcome: "changed" }, rpc: "set_community_member_role", args: { p_community_id: communityId, p_membership_id: membershipId, p_role: "moderator" } },
    { name: "remove", input: locator, run: (c: Client, input: unknown) => removeCommunityMember(c, input as MemberLocator), result: { outcome: "removed" }, rpc: "remove_community_member", args: { p_community_id: communityId, p_membership_id: membershipId } },
    { name: "name", input: nameInput, run: (c: Client, input: unknown) => setMyCommunityManagementName(c, input as NameInput), result: { management_display_name: "Name" }, rpc: "set_my_community_management_name", args: { p_community_id: communityId, p_membership_id: membershipId, p_name: "Name" } },
  ];
  for (const op of operations) {
    for (const response of ["503", "520", "network"]) it(`${op.name} installed SDK POST has no automatic retry after ${response}`, async () => {
      const fetcher = mock.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        assert.equal(init?.method, "POST"); assert.deepEqual(JSON.parse(String(init?.body)), op.args);
        if (response === "network") throw new Error("PRIVATE transport failure");
        return Response.json({ message: "PRIVATE failure" }, { status: Number(response) });
      });
      const real = createClient<Database>("https://project.example.test", "sb_publishable_fixture", {
        global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      mock.method(real.auth, "getUser", async () => ({ data: { user: user as User }, error: null }));
      const log = mock.method(console, "error", () => {});
      try {
        const result = await op.run(real, op.input); assert.equal(result.status, "error");
        if (result.status === "error") assert.equal(result.code, "reconciliation_required");
        assert.equal(fetcher.mock.callCount(), 1); assert.ok(!JSON.stringify([result, log.mock.calls]).includes("PRIVATE"));
      } finally { log.mock.restore(); }
    });
    it(`${op.name} verifies identity and sends only minimal RPC inputs`, async () => {
      const c = client([op.result]); assert.deepEqual(await op.run(c.value, op.input), { status: "success", data: op.result }); assert.deepEqual(c.rpc.mock.calls[0].arguments, [op.rpc, op.args]);
    });
    for (const candidate of [null, { id: "unverified" }, { ...user, is_anonymous: true }]) it(`${op.name} rejects missing/unverified/anonymous session ${JSON.stringify(candidate)}`, async () => {
      const c = client([op.result], null, candidate); await assert.rejects(op.run(c.value, op.input), AuthenticationRequired); assert.equal(c.rpc.mock.callCount(), 0);
    });
    for (const key of ["user_id", "actorId", "actorRole", "targetUserId", "owner_user_id", "occurred_at", "audit", "created_at", "unexpected"])
      it(`${op.name} rejects forged ${key}`, async () => { const c = client([op.result]); assert.equal((await op.run(c.value, { ...op.input, [key]: "forged" })).status, "error"); assert.equal(c.rpc.mock.callCount(), 0); });
    for (const input of [null, [], {}, "bad", { ...op.input, communityId: null }, { ...op.input, membershipId: "not-uuid" }, { ...op.input, communityId: communityId + "\n" }])
      it(`${op.name} rejects malformed input ${JSON.stringify(input)}`, async () => { const c = client([op.result]); assert.equal((await op.run(c.value, input)).status, "error"); assert.equal(c.rpc.mock.callCount(), 0); });
    for (const result of [null, [], [op.result, op.result], [{}], [{ ...op.result, target_user_id: "private" }], [{ outcome: "owner" }]])
      it(`${op.name} malformed response requires reconciliation ${JSON.stringify(result)}`, async () => {
        const c = client(result); const log = mock.method(console, "error", () => {});
        try { const actual = await op.run(c.value, op.input); assert.equal(actual.status, "error"); if (actual.status === "error") assert.equal(actual.code, "reconciliation_required"); assert.equal(c.rpc.mock.callCount(), 1); } finally { log.mock.restore(); }
      });
    for (const throws of [false, true]) it(`${op.name} lost response is redacted and never replayed (${throws ? "throw" : "return"})`, async () => {
      const c = client(null, { message: "PRIVATE name/email/token", code: "network" }, user, throws), log = mock.method(console, "error", () => {});
      try { const result = await op.run(c.value, op.input); assert.equal(result.status, "error"); if (result.status === "error") assert.equal(result.code, "reconciliation_required"); assert.ok(!JSON.stringify(result).includes("PRIVATE")); assert.ok(!JSON.stringify(log.mock.calls).includes("PRIVATE")); assert.equal(c.rpc.mock.callCount(), 1); } finally { log.mock.restore(); }
    });
    for (const code of ["42501", "22023"]) it(`${op.name} SQL denial maps to generic unavailable ${code}`, async () => {
      const c = client(null, { code, message: "banned/deleted/unverified/private SQL" }), log = mock.method(console, "error", () => {});
      try { const result = await op.run(c.value, op.input); assert.deepEqual(result, { status: "error", code: "unavailable", message: "Community management is unavailable." }); } finally { log.mock.restore(); }
    });
  }
  for (const role of ["owner", "superadmin", null, "Member", "member ", 1]) it(`rejects destination ${role}`, async () => {
    const c = client([{ outcome: "changed" }]); assert.equal((await setCommunityMemberRole(c.value, { ...locator, role } as RoleInput)).status, "error"); assert.equal(c.rpc.mock.callCount(), 0);
  });
  it("unchanged and already_absent remain distinct successful results", async () => {
    assert.deepEqual(await setCommunityMemberRole(client([{ outcome: "unchanged" }]).value, roleInput), { status: "success", data: { outcome: "unchanged" } });
    assert.deepEqual(await removeCommunityMember(client([{ outcome: "already_absent" }]).value, locator), { status: "success", data: { outcome: "already_absent" } });
  });
  for (const [input, expected] of [[null, null], ["", null], ["   ", null], ["  José 🐱  ", "José 🐱"], ["🐱".repeat(80), "🐱".repeat(80)], ["\u00a0", "\u00a0"]] as const)
    it(`name normalization ${JSON.stringify(input).slice(0, 25)}`, async () => { assert.equal(normalizeManagementName(input), expected); const c = client([{ management_display_name: expected }]); assert.equal((await setMyCommunityManagementName(c.value, { ...locator, name: input })).status, "success"); assert.equal((c.rpc.mock.calls[0].arguments[1] as Record<string, unknown>).p_name, expected); });
  for (const name of [undefined, 1, {}, "a".repeat(81), "🐱".repeat(81), "a\n", "\u0085", "\ud800"]) it(`name rejected ${JSON.stringify(name)?.slice(0, 25)}`, () => { assert.equal(normalizeManagementName(name), undefined); });
  it("name mismatching normalized proposed value is rejected", async () => {
    const log = mock.method(console, "error", () => {}); try { assert.equal((await setMyCommunityManagementName(client([{ management_display_name: "Other" }]).value, nameInput)).status, "error"); } finally { log.mock.restore(); }
  });
  it("listing requires verified identity before RPC", async () => { const c = client([], null, null); await assert.rejects(listCommunityMembers(c.value, { communityId }), AuthenticationRequired); assert.equal(c.rpc.mock.callCount(), 0); });
  it("listing preserves exact microsecond cursor strings and default page size", async () => {
    const cursor = "2026-10-08T01:02:03.123455Z", c = client([row]);
    assert.deepEqual(await listCommunityMembers(c.value, { communityId, cursorCreatedAt: cursor, cursorId: membershipId }), { status: "success", data: [row] });
    assert.deepEqual(c.rpc.mock.calls[0].arguments, ["list_community_members", { p_community_id: communityId, p_after_created_at: cursor, p_after_membership_id: membershipId, p_limit: 20 }]);
  });
  for (const input of [{}, { communityId, cursorId: membershipId }, { communityId, cursorCreatedAt: row.joined_at }, { communityId, limit: 51 }, { communityId, limit: 0 }, { communityId, limit: 2.5 }, { communityId, total: true }, { communityId, cursorCreatedAt: "infinity", cursorId: membershipId }, { communityId, cursorCreatedAt: "2026-02-30T00:00:00Z", cursorId: membershipId }])
    it(`listing rejects malformed page ${JSON.stringify(input)}`, async () => { const c = client([]); assert.equal((await listCommunityMembers(c.value, input as MemberPageInput)).status, "error"); assert.equal(c.rpc.mock.callCount(), 0); });
  for (const rows of [null, {}, [{ ...row, user_id: "leak" }], [{ ...row, email: "leak" }], [{ ...row, role: "superadmin" }], [{ ...row, joined_at: "infinity" }], [{ ...row, management_display_name: " x " }], [{ ...row, is_self: "false" }], [row, row], [{ ...row, joined_at: "2026-10-08T01:02:03.123457Z" }, row], Array.from({ length: 21 }, () => row)])
    it(`listing rejects invalid projection/order/size ${JSON.stringify(rows)?.slice(0, 90)}`, async () => { const log = mock.method(console, "error", () => {}); try { assert.equal((await listCommunityMembers(client(rows).value, { communityId })).status, "error"); } finally { log.mock.restore(); } });
  it("equal timestamps sort by UUID, exact cursor exclusivity and timezone equivalence", async () => {
    const next = { ...row, membership_id: "33333333-3333-4333-8333-333333333333", joined_at: "2026-10-07T22:02:03.123456-03:00" };
    assert.equal((await listCommunityMembers(client([row, next]).value, { communityId })).status, "success");
    assert.equal((await listCommunityMembers(client([next]).value, { communityId, cursorCreatedAt: row.joined_at, cursorId: row.membership_id })).status, "success");
    const log = mock.method(console, "error", () => {}); try { assert.equal((await listCommunityMembers(client([row]).value, { communityId, cursorCreatedAt: row.joined_at, cursorId: row.membership_id })).status, "error"); } finally { log.mock.restore(); }
  });
});
