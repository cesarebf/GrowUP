import { beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { applicationLoader } from "./helpers/application-loader.mts";

const community = "11111111-1111-4111-8111-111111111111";
const request = "22222222-2222-4222-8222-222222222222";
const user = { id: "server-verified-user", email_confirmed_at: "2026-09-29T00:00:00Z" };
let candidate: unknown = user;
let rpcResult: unknown;
const rpc = mock.fn(async (...args: unknown[]) => { void args; return rpcResult; });
const client = { auth: { getUser: async () => ({ data: { user: candidate }, error: null }) }, rpc };
const createClient = mock.fn(async (writable?: boolean) => { void writable; return client; });
const revalidatePath = mock.fn((...args: unknown[]) => { void args; });
const redirect = mock.fn((path: string) => { throw new Error(`redirect:${path}`); });
applicationLoader({ "@/lib/supabase/server": { createClient }, "next/cache": { revalidatePath }, "next/navigation": { redirect } });
const actions = await import("../src/app/communities/request-actions.ts");
const operations = [
  ["submit", actions.submitMembershipRequestAction, "request_community_membership", "pending"],
  ["withdraw", actions.withdrawMembershipRequestAction, "withdraw_community_membership_request", "withdrawn"],
  ["approve", actions.approveMembershipRequestAction, "approve_community_membership_request", "approved"],
  ["reject", actions.rejectMembershipRequestAction, "reject_community_membership_request", "rejected"],
] as const;
function form(operation: string) {
  const data = new FormData(); data.set("community_id", community);
  data.set(operation === "submit" ? "display_name" : "request_id", operation === "submit" ? " Shared name " : request);
  return data;
}
const idle = { status: "idle" } as const;

describe("request Server Actions with real services", () => {
  beforeEach(() => {
    candidate = user; rpc.mock.resetCalls(); createClient.mock.resetCalls(); revalidatePath.mock.resetCalls(); redirect.mock.resetCalls();
  });
  for (const [operation, action, rpcName, status] of operations) {
    it(`${operation} creates a writable authenticated client, calls the fixed RPC, and invalidates routes`, async () => {
      const result = { request_id: request, status, outcome: operation === "submit" ? "created" : "resolved", cancellation_reason: null };
      rpcResult = { data: [result], error: null };
      assert.deepEqual(await action(idle, form(operation)), { status: "success", data: result });
      assert.deepEqual(createClient.mock.calls[0].arguments, [true]);
      assert.deepEqual(rpc.mock.calls[0].arguments, [rpcName, operation === "submit"
        ? { p_community_id: community, p_display_name: "Shared name" } : { p_community_id: community, p_request_id: request }]);
      assert.deepEqual(revalidatePath.mock.calls.map((call) => call.arguments), [["/communities"], ["/c/[slug]", "page"], ["/c/[slug]/requests", "page"]]);
    });
    it(`${operation} redirects unauthenticated users without calling a mutation or invalidation`, async () => {
      candidate = null;
      await assert.rejects(action(idle, form(operation)), /redirect:\/sign-in/);
      assert.equal(rpc.mock.callCount(), 0); assert.equal(revalidatePath.mock.callCount(), 0);
    });
    it(`${operation} rejects malformed, duplicate, file and forged identity/role fields`, async () => {
      for (const key of ["community_id", operation === "submit" ? "display_name" : "request_id"]) {
        for (const mode of ["missing", "duplicate", "file"]) {
          const data = form(operation);
          if (mode === "missing") data.delete(key);
          if (mode === "duplicate") data.append(key, "duplicate");
          if (mode === "file") data.set(key, new Blob(["payload"]), "data.txt");
          assert.equal((await action(idle, data)).status, "error");
        }
      }
      for (const key of ["user_id", "requester_user_id", "reviewer_user_id", "role", "operation", "next"]) {
        const data = form(operation); data.set(key, "forged");
        assert.equal((await action(idle, data)).status, "error");
      }
      assert.equal(rpc.mock.callCount(), 0); assert.equal(revalidatePath.mock.callCount(), 0);
    });
    it(`${operation} safely maps provider denials and ambiguous results without revalidation`, async () => {
      const logger = mock.method(console, "error", () => {});
      try {
        for (const code of ["42501", "22023", "40001", "unexpected"]) {
          rpcResult = { data: null, error: { code, message: "private provider payload" } };
          const result = await action(idle, form(operation));
          assert.equal(result.status, "error");
          assert.ok(!JSON.stringify([result, logger.mock.calls]).includes("private provider payload"));
        }
        assert.equal(revalidatePath.mock.callCount(), 0);
      } finally { logger.mock.restore(); }
    });
  }
  it("returns duplicate pending and already resolved outcomes unchanged and revalidates", async () => {
    for (const [action, operation, status, outcome] of [
      [actions.submitMembershipRequestAction, "submit", "pending", "already_pending"],
      [actions.approveMembershipRequestAction, "approve", "rejected", "already_resolved"],
    ] as const) {
      const result = { request_id: request, status, outcome, cancellation_reason: null };
      rpcResult = { data: [result], error: null };
      assert.deepEqual(await action(idle, form(operation)), { status: "success", data: result });
    }
    assert.equal(revalidatePath.mock.callCount(), 6);
  });
  it("maps writable-client failures to a safe uncertain result and redacted diagnostics", async () => {
    const logger = mock.method(console, "error", () => {});
    createClient.mock.mockImplementationOnce(async () => { throw new Error("private cookie payload"); });
    try {
      const result = await actions.submitMembershipRequestAction(idle, form("submit"));
      assert.equal(result.status, "error");
      assert.match(JSON.stringify(result), /could not be confirmed/);
      assert.ok(!JSON.stringify([result, logger.mock.calls]).includes("private cookie payload"));
      assert.equal(rpc.mock.callCount(), 0); assert.equal(revalidatePath.mock.callCount(), 0);
    } finally { logger.mock.restore(); }
  });
  it("ignores React transport metadata and never trusts a prior browser action state", async () => {
    const result = { request_id: request, status: "pending", outcome: "created", cancellation_reason: null };
    rpcResult = { data: [result], error: null };
    const data = form("submit"); data.set("$ACTION_REF_test", "transport only");
    assert.deepEqual(await actions.submitMembershipRequestAction({ status: "success", data: { ...result, status: "approved", outcome: "resolved", cancellation_reason: null } }, data), { status: "success", data: result });
    assert.deepEqual(rpc.mock.calls[0].arguments, ["request_community_membership", { p_community_id: community, p_display_name: "Shared name" }]);
  });
});
