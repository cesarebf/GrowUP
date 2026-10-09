import { describe, it, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { applicationLoader } from "./helpers/application-loader.mts";
const community = "11111111-1111-4111-8111-111111111111", membership = "22222222-2222-4222-8222-222222222222";
let candidate: unknown, data: unknown, error: unknown, cacheFailure = false;
const rpc = mock.fn(async () => ({ data, error })), factory = mock.fn(async (writable: boolean) => {
  assert.equal(writable, true);
  return { auth: { getUser: async () => ({ data: { user: candidate }, error: null }) }, rpc };
});
const invalidate = mock.fn((...args: unknown[]) => { void args; if (cacheFailure) throw new Error("PRIVATE cache error"); });
const loader = applicationLoader({
  "next/navigation": { redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } },
  "next/cache": { revalidatePath: invalidate },
  "@/lib/supabase/server": { createClient: factory },
});
const { setCommunityMemberRoleAction, removeCommunityMemberAction, setMyCommunityManagementNameAction } = await import("../src/app/communities/member-actions.ts");
after(() => loader.deregister());
beforeEach(() => { candidate = { id: "verified", email_confirmed_at: "2026-01-01" }; data = null; error = null; cacheFailure = false; rpc.mock.resetCalls(); factory.mock.resetCalls(); invalidate.mock.resetCalls(); });
function form(extra: Record<string, string> = {}) { const f = new FormData(); for (const [key, value] of Object.entries({ community_id: community, membership_id: membership, ...extra })) f.set(key, value); return f; }
describe("community role Server Actions use cookie-bound services", () => {
  for (const [name, action, fields, result] of [
    ["role", setCommunityMemberRoleAction, { role: "moderator" }, { outcome: "changed" }],
    ["remove", removeCommunityMemberAction, {}, { outcome: "removed" }],
    ["name", setMyCommunityManagementNameAction, { name: "Name" }, { management_display_name: "Name" }],
  ] as const) {
    it(`${name} runs real service with writable cookie client and invalidates related reads`, async () => {
      data = [result]; assert.deepEqual(await action({ status: "idle" }, form(fields)), { status: "success", data: result });
      assert.equal(factory.mock.callCount(), 1); assert.equal(rpc.mock.callCount(), 1);
      assert.deepEqual(invalidate.mock.calls.map(c => c.arguments[0]), ["/communities", "/c/[slug]", "/c/[slug]/requests", "/communities/requests", "/c/[slug]/invitations", "/invite/[token]"]);
    });
    it(`${name} redirects unauthenticated caller without sending mutation`, async () => {
      candidate = null; await assert.rejects(action({ status: "idle" }, form(fields)), /REDIRECT:\/sign-in/); assert.equal(rpc.mock.callCount(), 0);
    });
    for (const mode of ["extra", "missing", "duplicate", "file"]) it(`${name} rejects ${mode} fields`, async () => {
      const f = form(fields); if (mode === "extra") f.set("user_id", "forged"); if (mode === "missing") f.delete("membership_id");
      if (mode === "duplicate") f.append("membership_id", membership); if (mode === "file") f.set("membership_id", new Blob([membership]), "id.txt");
      assert.equal((await action({ status: "idle" }, f)).status, "error"); assert.equal(rpc.mock.callCount(), 0);
    });
    it(`${name} ignores React transport metadata but never forwards it`, async () => {
      data = [result]; const f = form(fields); f.set("$ACTION_transport", "opaque"); assert.equal((await action({ status: "idle" }, f)).status, "success");
    });
    for (const failure of ["rpc", "cache"]) it(`${name} ${failure} failure is redacted and never retried`, async () => {
      data = [result]; if (failure === "rpc") error = { message: "PRIVATE rpc error" }; else cacheFailure = true;
      const logger = mock.method(console, "error", () => {});
      try { const response = await action({ status: "idle" }, form(fields)); assert.equal(response.status, "error"); if (response.status === "error") assert.equal(response.code, "reconciliation_required"); assert.equal(rpc.mock.callCount(), 1); assert.ok(!JSON.stringify([response, logger.mock.calls]).includes("PRIVATE")); } finally { logger.mock.restore(); }
    });
  }
  it("action cannot accept owner destination", async () => { assert.equal((await setCommunityMemberRoleAction({ status: "idle" }, form({ role: "owner" }))).status, "error"); assert.equal(rpc.mock.callCount(), 0); });
  it("blank label clears through action", async () => { data = [{ management_display_name: null }]; assert.deepEqual(await setMyCommunityManagementNameAction({ status: "idle" }, form({ name: "   " })), { status: "success", data: { management_display_name: null } }); });
});
