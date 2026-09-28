import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Client } from "../src/lib/auth/service.ts";
import { AuthenticationRequired } from "../src/lib/auth/service.ts";
import { createCommunity, listMyCommunities, readCommunity } from "../src/lib/communities/service.ts";
import { isCommunitySlug, parseCommunityInput } from "../src/lib/communities/validation.ts";

const user = { id: "trusted-user", email_confirmed_at: "2026-09-28T00:00:00Z" };
const fields = { name: " Grow together ", slug: " MY-COMMUNITY ", description: " A place to learn ", visibility: "public", join_policy: "instant" };
function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}
function client(candidate: unknown = user, rpc: unknown = async () => ({ data: "uuid", error: null }), from: unknown = mock.fn()) {
  return { auth: { getUser: async () => ({ data: { user: candidate }, error: null }) }, rpc, from } as unknown as Client;
}

describe("community service boundary", () => {
  it("validates and normalizes metadata, ignoring forged ownership and roles", async () => {
    const rpc = mock.fn(async () => ({ data: "uuid", error: null }));
    const result = await createCommunity(client(user, rpc), form({ ...fields, owner_user_id: "victim", user_id: "victim", role: "owner", id: "forged", next: "//evil.example" }));
    assert.deepEqual(result, { status: "success", slug: "my-community" });
    assert.deepEqual(rpc.mock.calls[0].arguments, ["create_community", { p_name: "Grow together", p_slug: "my-community", p_description: "A place to learn", p_visibility: "public", p_join_policy: "instant" }]);
    assert.equal(rpc.mock.callCount(), 1);
  });
  for (const candidate of [null, { ...user, email_confirmed_at: null }, { ...user, banned_until: "2099-01-01T00:00:00Z" }, { ...user, is_anonymous: true }, { ...user, deleted_at: "2026-09-28T00:00:00Z" }]) {
    it(`denies ineligible creation/listing before database access: ${JSON.stringify(candidate)}`, async () => {
      const rpc = mock.fn();
      const from = mock.fn();
      await assert.rejects(createCommunity(client(candidate, rpc, from), form(fields)), AuthenticationRequired);
      await assert.rejects(listMyCommunities(client(candidate, rpc, from)), AuthenticationRequired);
      assert.equal(rpc.mock.callCount(), 0);
      assert.equal(from.mock.callCount(), 0);
    });
  }
  it("rejects missing or invalid selections and invalid metadata before writing", async () => {
    const rpc = mock.fn();
    for (const overrides of [
      { visibility: "" }, { visibility: "secret" }, { join_policy: "" }, { join_policy: "paid" },
      { name: " " }, { name: "a".repeat(81) }, { name: "bad\nname" },
      { description: "a".repeat(501) }, { description: "bad\u0000description" }, { slug: "../../admin" },
    ]) {
      assert.equal((await createCommunity(client(user, rpc), form({ ...fields, ...overrides }))).status, "error");
    }
    const missing = form(fields);
    missing.delete("visibility");
    assert.equal((await createCommunity(client(user, rpc), missing)).status, "error");
    assert.equal(rpc.mock.callCount(), 0);
  });
  it("handles duplicate slugs safely and redacts database failures", async () => {
    const duplicate = await createCommunity(client(user, async () => ({ data: null, error: { code: "23505", message: "private DB payload" } })), form(fields));
    assert.deepEqual(duplicate, { status: "error", message: "That community URL is unavailable. Choose another." });
    const logger = mock.method(console, "error", () => {});
    try {
      const failed = await createCommunity(client(user, async () => ({ data: null, error: { code: "XX000", message: "private DB payload" } })), form(fields));
      assert.equal(failed.status, "error");
      assert.ok(!JSON.stringify([failed, logger.mock.calls]).includes("private DB payload"));
    } finally { logger.mock.restore(); }
  });
  it("uses exact validated slugs and preserves missing/private indistinguishability", async () => {
    const rpc = mock.fn(async () => ({ data: [], error: null }));
    assert.equal(await readCommunity(client(null, rpc), "../invalid"), null);
    assert.equal(rpc.mock.callCount(), 0);
    assert.equal(await readCommunity(client(null, rpc), "private-community"), null);
    assert.deepEqual(rpc.mock.calls[0].arguments, ["get_community_landing", { p_slug: "private-community" }]);
  });
  it("does not turn a database outage into a missing community", async () => {
    const logger = mock.method(console, "error", () => {});
    try {
      await assert.rejects(readCommunity(client(null, async () => ({ data: null, error: { code: "XX000" } })), "my-community"), /temporarily unavailable/);
    } finally { logger.mock.restore(); }
  });
  it("scopes membership lists to the authoritative user with an explicit relationship", async () => {
    const order = mock.fn(async () => ({ data: [], error: null }));
    const eq = mock.fn(() => ({ order }));
    const select = mock.fn(() => ({ eq }));
    const from = mock.fn(() => ({ select }));
    assert.deepEqual(await listMyCommunities(client(user, undefined, from)), []);
    assert.deepEqual(from.mock.calls[0].arguments, ["community_memberships"]);
    assert.deepEqual(eq.mock.calls[0].arguments, ["user_id", user.id]);
    assert.deepEqual(select.mock.calls[0].arguments, ["role, communities!community_memberships_community_id_fkey(id, name, slug, visibility)"]);
  });
});

describe("community input validation", () => {
  it("accepts bounded Unicode names and descriptions without turning them into markup", () => {
    const parsed = parseCommunityInput(form({ ...fields, name: "🌱".repeat(80), description: "<script>alert(1)</script>" }));
    assert.ok(parsed.input);
    assert.equal(parsed.input.description, "<script>alert(1)</script>");
  });
  it("rejects reserved paths, encoded separators, control characters, and invalid bounds", () => {
    for (const slug of ["ab", "a".repeat(49), "a/b", "abc%2fdef", "abc--def", "-abc", "abc-", "admin", "settings", "new", "héllo", "abc\n"]) assert.equal(isCommunitySlug(slug), false, slug);
    for (const slug of ["abc", "a".repeat(48), "grow-with-us", "123"]) assert.equal(isCommunitySlug(slug), true, slug);
  });
});
