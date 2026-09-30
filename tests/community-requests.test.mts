import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { AuthenticationRequired, type Client } from "../src/lib/auth/service.ts";
import { approveMembershipRequest, getMyMembershipRequests, listMembershipRequests, rejectMembershipRequest, submitMembershipRequest, withdrawMembershipRequest } from "../src/lib/communities/requests.ts";
import { isRequestDisplayName, isRequestTimestamp, parseRequestPage, type RequestPageInput } from "../src/lib/communities/request-validation.ts";

const community = "11111111-1111-4111-8111-111111111111";
const request = "22222222-2222-4222-8222-222222222222";
const user = { id: "trusted-session-user", email_confirmed_at: "2026-09-29T00:00:00Z" };
const pending = { request_id: request, status: "pending", outcome: "created", cancellation_reason: null };
const stamp = "2026-09-29T01:02:03.123456+00:00";
const receipt = {
  request_id: request, community_id: community, requester_display_name: "Shared name", status: "pending",
  created_at: stamp, resolved_at: null, cancellation_reason: null, community_name: "Community", community_slug: "test-community",
};
const queue = { request_id: request, requester_display_name: "Shared name", status: "pending", created_at: stamp };
function form(values: Record<string, string>) {
  const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data;
}
function client(candidate: unknown = user, rpc: unknown = async () => ({ data: [pending], error: null })) {
  return { auth: { getUser: async () => ({ data: { user: candidate }, error: null }) }, rpc, from: () => { throw new Error("No direct table path permitted"); } } as unknown as Client;
}
const operations = [
  { name: "submit", run: submitMembershipRequest, rpc: "request_community_membership", result: pending, fields: { community_id: community, display_name: "  Shared name  " } },
  { name: "withdraw", run: withdrawMembershipRequest, rpc: "withdraw_community_membership_request", result: { ...pending, status: "withdrawn", outcome: "resolved" }, fields: { community_id: community, request_id: request } },
  { name: "approve", run: approveMembershipRequest, rpc: "approve_community_membership_request", result: { ...pending, status: "approved", outcome: "resolved" }, fields: { community_id: community, request_id: request } },
  { name: "reject", run: rejectMembershipRequest, rpc: "reject_community_membership_request", result: { ...pending, status: "rejected", outcome: "resolved" }, fields: { community_id: community, request_id: request } },
] as const;

describe("membership request authenticated service boundaries", () => {
  for (const operation of operations) {
    it(`${operation.name} uses current session verification, a fixed RPC, and only validated locators/name`, async () => {
      const rpc = mock.fn(async () => ({ data: [operation.result], error: null }));
      const input = form(operation.fields); input.set("$ACTION_REF_fixture", "ignored metadata");
      assert.deepEqual(await operation.run(client(user, rpc), input), { status: "success", data: operation.result });
      assert.deepEqual(rpc.mock.calls[0].arguments, [operation.rpc, operation.name === "submit"
        ? { p_community_id: community, p_display_name: "Shared name" } : { p_community_id: community, p_request_id: request }]);
    });
    it(`${operation.name} rejects forged identity, reviewer authority, status/time/redirect and unknown fields`, async () => {
      const rpc = mock.fn();
      for (const key of ["user_id", "requester_user_id", "owner_user_id", "role", "reviewer_role", "resolved_by_user_id", "created_at", "resolved_at", "status", "cancellation_reason", "next", "slug", "operation", "rpc", "unexpected"]) {
        assert.equal((await operation.run(client(user, rpc), form({ ...operation.fields, [key]: "forged" }))).status, "error");
      }
      assert.equal(rpc.mock.callCount(), 0);
    });
    it(`${operation.name} rejects duplicate/file/missing/malformed values before any RPC`, async () => {
      const rpc = mock.fn();
      for (const key of Object.keys(operation.fields)) {
        const duplicate = form(operation.fields); duplicate.append(key, "duplicate");
        const file = form(operation.fields); file.set(key, new Blob(["file"]), "name.txt");
        const absent = form(operation.fields); absent.delete(key);
        for (const input of [duplicate, file, absent]) assert.equal((await operation.run(client(user, rpc), input)).status, "error");
      }
      for (const id of ["", "invalid", "../escape", `${community}\n`, ` ${community}`, community + "x"]) {
        assert.equal((await operation.run(client(user, rpc), form({ ...operation.fields, community_id: id }))).status, "error");
        if (operation.name !== "submit") assert.equal((await operation.run(client(user, rpc), form({ ...operation.fields, request_id: id }))).status, "error");
      }
      assert.equal(rpc.mock.callCount(), 0);
    });
    it(`${operation.name} denies expired/unverified/anonymous/deleted/banned sessions before database access`, async () => {
      const rpc = mock.fn();
      for (const candidate of [null, {}, { ...user, email_confirmed_at: null }, { ...user, is_anonymous: true }, { ...user, deleted_at: stamp }, { ...user, banned_until: "9999-01-01T00:00:00Z" }]) {
        await assert.rejects(operation.run(client(candidate, rpc), form(operation.fields)), AuthenticationRequired);
      }
      assert.equal(rpc.mock.callCount(), 0);
    });
    it(`${operation.name} safely maps errors/timeouts/network exceptions with no automatic retry or private logs`, async () => {
      const logger = mock.method(console, "error", () => {});
      try {
        for (const code of ["42501", "22023", "23505", "40P01", "55P03", "40001", "57014", "PGRST202", "unknown"]) {
          const rpc = mock.fn(async () => ({ data: null, error: { code, message: "secret provider name/email/account state", details: "secret detail" } }));
          const result = await operation.run(client(user, rpc), form(operation.fields));
          assert.equal(result.status, "error"); assert.equal(rpc.mock.callCount(), 1);
          assert.ok(!JSON.stringify([result, logger.mock.calls]).includes("secret"));
          if (code === "42501") assert.match(result.status === "error" ? result.message : "", /unavailable/);
          else if (code !== "22023") assert.match(result.status === "error" ? result.message : "", /Refresh.*status/);
        }
        const rpc = mock.fn(async () => { throw new Error("secret network payload"); });
        assert.equal((await operation.run(client(user, rpc), form(operation.fields))).status, "error");
        assert.equal(rpc.mock.callCount(), 1); assert.ok(!JSON.stringify(logger.mock.calls).includes("secret"));
      } finally { logger.mock.restore(); }
    });
    it(`${operation.name} fails closed on malformed or excessive RPC results`, async () => {
      const logger = mock.method(console, "error", () => {});
      try {
        for (const data of [null, {}, operation.result, [], [operation.result, operation.result], [{ ...operation.result, request_id: "invalid" }],
          [{ ...operation.result, status: "unknown" }], [{ ...operation.result, outcome: "unknown" }],
          [{ ...operation.result, cancellation_reason: "already_member" }], [{ ...operation.result, requester_user_id: user.id }],
          [{ ...operation.result, resolved_by_user_id: user.id }], [{ ...operation.result, email: "private@example.com" }],
        ]) assert.equal((await operation.run(client(user, async () => ({ data, error: null })), form(operation.fields))).status, "error");
      } finally { logger.mock.restore(); }
    });
  }
  it("accepts Unicode codepoint bounds and ASCII-only trimming, rejecting all control characters", async () => {
    const rpc = mock.fn(async () => ({ data: [pending], error: null }));
    for (const name of ["🌱".repeat(80), "名字", "\u00a0Name\u00a0", "<script>alert(1)</script>"]) {
      assert.equal((await submitMembershipRequest(client(user, rpc), form({ community_id: community, display_name: `  ${name} ` }))).status, "success");
      assert.equal((rpc.mock.calls.at(-1)?.arguments as unknown as [string, { p_display_name: string }])[1].p_display_name, name);
    }
    for (const name of ["", " ", "🌱".repeat(81), "Name\n", "\tName", "x\0", "x\u007f", "x\u0085", "x\u009f"]) {
      assert.equal((await submitMembershipRequest(client(user, rpc), form({ community_id: community, display_name: name }))).status, "error");
    }
    assert.equal(isRequestDisplayName("\ud800"), false);
  });
  it("does not claim a different decision succeeded when the exact request is already resolved", async () => {
    for (const operation of operations.slice(1)) {
      const old = { ...pending, status: "withdrawn", outcome: "already_resolved" };
      assert.deepEqual(await operation.run(client(user, async () => ({ data: [old], error: null })), form(operation.fields)), { status: "success", data: old });
    }
    assert.equal((await submitMembershipRequest(client(user, async () => ({ data: [{ ...pending, outcome: "already_pending" }], error: null })), form(operations[0].fields))).status, "success");
  });
  it("review projections accept only generic requester-unavailable outcome and match the requested ID", async () => {
    const logger = mock.method(console, "error", () => {});
    try {
      const result = { ...pending, status: "cancelled", outcome: "cancelled", cancellation_reason: "cannot_be_admitted" };
      for (const run of [approveMembershipRequest, rejectMembershipRequest]) {
        assert.deepEqual(await run(client(user, async () => ({ data: [result], error: null })), form(operations[1].fields)), { status: "success", data: result });
        for (const invalid of [{ ...result, cancellation_reason: "requester_unavailable" }, { ...result, request_id: community }, { ...pending, outcome: "resolved" }]) {
          assert.equal((await run(client(user, async () => ({ data: [invalid], error: null })), form(operations[1].fields))).status, "error");
        }
      }
    } finally { logger.mock.restore(); }
  });
  it("uses authoritative getUser failures as authentication failures, never a supplied identity", async () => {
    const rpc = mock.fn();
    const expired = { ...client(user, rpc), auth: { getUser: async () => ({ data: { user }, error: { code: "bad_jwt", status: 401 } }) } } as unknown as Client;
    await assert.rejects(submitMembershipRequest(expired, form(operations[0].fields)), AuthenticationRequired);
    assert.equal(rpc.mock.callCount(), 0);
  });

  for (const mode of ["history", "queue"] as const) {
    const read = mode === "history" ? getMyMembershipRequests : listMembershipRequests;
    const row = mode === "history" ? receipt : queue;
    it(`${mode} reads use paired cursor filters and bounded pages, never identity/authority inputs`, async () => {
      const rpc = mock.fn(async () => ({ data: [row], error: null }));
      const input = { communityId: community, cursorCreatedAt: stamp, cursorId: request, limit: 1 };
      assert.deepEqual(await read(client(user, rpc), input), { status: "success", data: [row] });
      assert.deepEqual(rpc.mock.calls[0].arguments, [mode === "history" ? "get_my_community_membership_requests" : "list_community_membership_requests", {
        p_community_id: community, [mode === "history" ? "p_before_created_at" : "p_after_created_at"]: stamp,
        [mode === "history" ? "p_before_id" : "p_after_id"]: request, p_limit: 1,
      }]);
    });
    it(`${mode} rejects malformed paging/forged authority before RPC`, async () => {
      const rpc = mock.fn();
      for (const extra of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { limit: null }, { limit: "20" },
        { cursorCreatedAt: stamp }, { cursorId: request }, { cursorCreatedAt: "infinity", cursorId: request },
        { requester_user_id: user.id }, { role: "owner" }, { communityId: "invalid" },
      ]) assert.equal((await read(client(user, rpc), { communityId: community, ...extra } as RequestPageInput)).status, "error");
      assert.equal(rpc.mock.callCount(), 0);
    });
    it(`${mode} requires authentication and rejects extra sensitive projection fields`, async () => {
      await assert.rejects(read(client(null), { communityId: community }), AuthenticationRequired);
      const logger = mock.method(console, "error", () => {});
      try {
        for (const data of [null, {}, [null], [{ ...row, email: "secret" }], [{ ...row, requester_user_id: user.id }],
          [{ ...row, resolved_by_user_id: user.id }], [{ ...row, status: "bad" }], [{ ...row, created_at: "infinity" }],
          [{ ...row, requester_display_name: "" }], [row, row],
        ]) assert.equal((await read(client(user, async () => ({ data, error: null })), { communityId: community, limit: 1 })).status, "error");
        const failure = await read(client(user, async () => { throw new Error("secret payload"); }), { communityId: community });
        assert.equal(failure.status, "error"); assert.ok(!JSON.stringify([failure, logger.mock.calls]).includes("secret"));
      } finally { logger.mock.restore(); }
    });
  }
  it("own private receipts accept redacted community metadata and never invent a link", async () => {
    const data = [{ ...receipt, status: "cancelled", resolved_at: stamp, cancellation_reason: "policy_changed", community_name: null, community_slug: null }];
    assert.deepEqual(await getMyMembershipRequests(client(user, async () => ({ data, error: null }))), { status: "success", data });
    const logger = mock.method(console, "error", () => {});
    try {
      for (const invalid of [{ ...receipt, community_name: null }, { ...receipt, community_slug: "//evil.example" },
        { ...receipt, status: "cancelled" }, { ...receipt, resolved_at: stamp }, { ...receipt, community_id: request },
      ]) assert.equal((await getMyMembershipRequests(client(user, async () => ({ data: [invalid], error: null })), { communityId: community })).status, "error");
    } finally { logger.mock.restore(); }
  });
  it("validates calendar timestamps without losing microsecond cursor precision", () => {
    for (const value of [stamp, "2024-02-29T00:00:00Z"]) assert.equal(isRequestTimestamp(value), true);
    for (const value of ["infinity", "2026-02-30T00:00:00Z", "2026-09-29", "2026-09-29T24:00:00Z", `${stamp}\n`, "2026-09-29T00:00:00+99:99"]) assert.equal(isRequestTimestamp(value), false);
    assert.deepEqual(parseRequestPage({ cursorCreatedAt: stamp, cursorId: request }, false), { status: "success", data: { cursorCreatedAt: stamp, cursorId: request, limit: 20 } });
    assert.equal(parseRequestPage({}, true).status, "error");
    assert.equal(parseRequestPage(null as unknown as RequestPageInput, false).status, "error");
  });
});
