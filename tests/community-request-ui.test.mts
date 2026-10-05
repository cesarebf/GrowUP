import { beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { ReactNode } from "react";
import type { RequestActionState, RequestReceipt } from "../src/lib/communities/request-validation.ts";
import { requestOutcomeMessage, requestPageInput, nextRequestPage } from "../src/lib/communities/request-presentation.ts";
import { applicationLoader } from "./helpers/application-loader.mts";

const require = createRequire(import.meta.url);
const React = require("../node_modules/react/index.js") as typeof import("react");
let hookState: unknown;
let hookPending = false;
let reducer: (previous: unknown, form: FormData) => Promise<unknown>;
const communityId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const stamp = "2026-09-29T10:01:02.123456+00:00";
const base = { id: communityId, name: "Grow together", slug: "grow-together", description: "Community", visibility: "public", join_policy: "approval_required", viewer_role: null };
let community: Record<string, unknown> | null;
let user: unknown;
let receipts: RequestReceipt[];
let queue: unknown[];
let readError: unknown;
let mutation: unknown;
const rpc = mock.fn(async (name: string, ...args: unknown[]) => {
  void args;
  if (name === "get_community_landing") return { data: community ? [community] : [], error: null };
  if (name === "get_my_community_membership_requests") return { data: receipts, error: readError };
  if (name === "list_community_membership_requests") return { data: queue, error: readError };
  return mutation;
});
const client = { auth: { getUser: async () => ({ data: { user }, error: null }) }, rpc };
applicationLoader({
  react: { ...React, useActionState: (run: typeof reducer, initial: unknown) => { reducer = run; return [hookState ?? initial, () => {}, hookPending]; } },
  "next/link": { default: ({ children, prefetch, ...props }: { children: ReactNode; prefetch?: boolean }) => { void prefetch; return React.createElement("a", props, children); } },
  "next/navigation": { redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not-found"); } },
  "next/cache": { revalidatePath: () => {} },
  "@/lib/supabase/server": { createClient: async () => client },
  "@/lib/supabase/config": { isSupabaseConfigured: () => true, parseOrigin: () => "http://localhost:3000" },
}, true);
const { renderToStaticMarkup } = await import("react-dom/server");
const { default: Landing } = await import("../src/app/c/[slug]/page.tsx");
const { default: ReviewPage } = await import("../src/app/c/[slug]/requests/page.tsx");
const { default: HistoryPage } = await import("../src/app/communities/requests/page.tsx");
const { MembershipRequestForm } = await import("../src/components/membership-request-form.tsx");
const { MembershipRequestReview } = await import("../src/components/membership-request-review.tsx");
const { MembershipRequestHistory } = await import("../src/components/membership-request-history.tsx");
const { CommunityForm } = await import("../src/components/community-form.tsx");
const { CommunitySettingsForm } = await import("../src/components/community-settings-form.tsx");
const render = renderToStaticMarkup;
const params = Promise.resolve({ slug: base.slug });
const searchParams = Promise.resolve({});
const receipt: RequestReceipt = { request_id: requestId, community_id: communityId, requester_display_name: "Shared label", status: "pending", created_at: stamp, resolved_at: null, cancellation_reason: null, community_name: base.name, community_slug: base.slug };
const pendingRequest = { request_id: requestId, requester_display_name: "Shared label", status: "pending" as const, created_at: stamp };
const renderForm = (latest: RequestReceipt | null = null) => render(React.createElement(MembershipRequestForm, { communityId, latest }));
const renderReview = () => render(React.createElement(MembershipRequestReview, { communityId, requests: [pendingRequest] }));
function form(operation: "submit" | "withdraw" | "approve" | "reject", name = "Shared label") {
  const data = new FormData(); data.set("community_id", communityId);
  if (operation === "submit") data.set("display_name", name);
  else data.set("request_id", requestId);
  if (operation === "approve" || operation === "reject") data.set("decision", operation);
  return data;
}

describe("membership request presentation and page orchestration", () => {
  beforeEach(() => {
    community = { ...base }; user = { id: "private-auth-id", email: "private@example.com", email_confirmed_at: stamp, user_metadata: { display_name: "Private profile name" } };
    receipts = []; queue = [pendingRequest]; readError = null; hookState = undefined; hookPending = false; rpc.mock.resetCalls();
    mutation = { data: [{ request_id: requestId, status: "pending", outcome: "created", cancellation_reason: null }], error: null };
  });
  for (const visibility of ["public", "unlisted"]) {
    it(`${visibility} eligible nonmember sees a blank explicit-sharing form and bounded latest lookup`, async () => {
      community!.visibility = visibility;
      const html = render(await Landing({ params }));
      assert.match(html, /Submit request/);
      assert.match(html, /This name will be shared with this community&#x27;s owner and admins/);
      assert.match(html, /private account profile name and email are not exposed/);
      assert.doesNotMatch(html, /Private profile name|private@example.com|private-auth-id|value="Shared/);
      assert.deepEqual(rpc.mock.calls.find((call) => call.arguments[0] === "get_my_community_membership_requests")!.arguments[1], {
        p_community_id: communityId, p_before_created_at: undefined, p_before_id: undefined, p_limit: 1,
      });
    });
  }
  it("pending requester sees the snapshot and withdraw targeting the exact attempt", async () => {
    receipts = [receipt];
    const html = render(await Landing({ params }));
    assert.match(html, /Approval pending/); assert.match(html, /Shared label/); assert.match(html, /Withdraw request/);
    assert.match(html, new RegExp(`name="request_id" value="${requestId}"`)); assert.doesNotMatch(html, /Submit request|name="display_name"/);
  });
  for (const role of ["member", "moderator", "admin", "owner"]) {
    it(`${role} membership takes precedence over stale requests`, async () => {
      community!.viewer_role = role; receipts = [receipt];
      const html = render(await Landing({ params }));
      assert.match(html, new RegExp(`Your role: ${role}`));
      assert.doesNotMatch(html, /Submit request|Withdraw request|Approval pending/);
      assert.equal(rpc.mock.calls.some((call) => call.arguments[0] === "get_my_community_membership_requests"), false);
      if (role === "owner") assert.match(html, /Community settings/);
      else assert.match(html, /Leave community/);
      if (["admin", "owner"].includes(role)) {
        assert.match(html, /Review membership requests/);
        assert.match(html, /Manage invitations/);
      } else assert.doesNotMatch(html, /Review membership requests|Manage invitations/);
    });
  }
  for (const visibility of ["public", "unlisted", "private"]) {
    for (const policy of ["instant", "approval_required", "invitation_only"]) {
      it(`${visibility}/${policy} selects only its permitted nonmember admission control`, async () => {
        community!.visibility = visibility; community!.join_policy = policy;
        const html = render(await Landing({ params }));
        assert.equal(html.includes("Submit request"), visibility !== "private" && policy === "approval_required");
        assert.equal(html.includes("Join community"), visibility !== "private" && policy === "instant");
      });
    }
  }
  it("private unavailable landing never requests or renders metadata", async () => {
    community = null;
    await assert.rejects(Landing({ params }), /not-found/);
    assert.equal(rpc.mock.callCount(), 1);
  });
  it("a newly redacted receipt suppresses an earlier landing preview", async () => {
    receipts = [{ ...receipt, community_name: null, community_slug: null }];
    await assert.rejects(Landing({ params }), /not-found/);
  });
  it("anonymous/ineligible visitors see sign-in guidance without request reads", async () => {
    for (const candidate of [null, { id: "unverified" }, { id: "banned", email_confirmed_at: stamp, banned_until: "2999-01-01T00:00:00Z" }]) {
      user = candidate;
      const html = render(await Landing({ params }));
      assert.match(html, /Sign in with a verified, eligible account/); assert.doesNotMatch(html, /Submit request/);
    }
    assert.equal(rpc.mock.calls.some((call) => call.arguments[0] === "get_my_community_membership_requests"), false);
  });
  it("failed latest lookup requires refresh and does not offer another submission", async () => {
    readError = { code: "42501" };
    const logger = mock.method(console, "error", () => {});
    try {
      const html = render(await Landing({ params }));
      assert.match(html, /status could not be loaded/); assert.match(html, /Refresh status/); assert.doesNotMatch(html, /Submit request/);
    } finally { logger.mock.restore(); }
  });
  for (const role of ["owner", "admin"]) {
    it(`${role} receives a bounded pending queue and review controls`, async () => {
      community!.viewer_role = role;
      const html = render(await ReviewPage({ params, searchParams }));
      assert.match(html, /Shared label/); assert.match(html, /Approve/); assert.match(html, /Reject/); assert.match(html, /Sep 29, 2026/);
      assert.doesNotMatch(html, /private@example.com|private-auth-id|Private profile name/);
      assert.deepEqual(rpc.mock.calls.find((call) => call.arguments[0] === "list_community_membership_requests")!.arguments[1], {
        p_community_id: communityId, p_after_created_at: undefined, p_after_id: undefined, p_limit: 20,
      });
    });
  }
  for (const role of ["moderator", "member", null]) {
    it(`${role ?? "nonmember/requester"} cannot load the review route or queue`, async () => {
      community!.viewer_role = role;
      await assert.rejects(ReviewPage({ params, searchParams }), /not-found/);
      assert.equal(rpc.mock.calls.some((call) => call.arguments[0] === "list_community_membership_requests"), false);
    });
  }
  it("lost reviewer authority at the queue read produces safe refresh guidance without controls", async () => {
    community!.viewer_role = "admin"; readError = { code: "42501", message: "private payload" };
    const logger = mock.method(console, "error", () => {});
    try {
      const html = render(await ReviewPage({ params, searchParams }));
      assert.match(html, /unavailable/); assert.match(html, /Refresh status/); assert.doesNotMatch(html, /value="approve"|private payload|Shared label/);
    } finally { logger.mock.restore(); }
  });
  it("history is own-only, bounded, dynamic and carries exact microsecond cursors", async () => {
    receipts = Array.from({ length: 20 }, () => receipt);
    const html = render(await HistoryPage({ searchParams }));
    assert.match(html, /Older requests/); assert.match(html, /123456/);
    assert.equal(rpc.mock.calls[0].arguments[0], "get_my_community_membership_requests");
    assert.equal((rpc.mock.calls[0].arguments[1] as { p_limit: number }).p_limit, 20);
    assert.equal((await import("../src/app/communities/requests/page.tsx")).dynamic, "force-dynamic");
    const next = nextRequestPage("/communities/requests", receipt);
    const search = Object.fromEntries(new URL(next, "http://localhost").searchParams);
    assert.deepEqual(requestPageInput(search), { status: "success", data: { limit: 20, cursorCreatedAt: stamp, cursorId: requestId } });
  });
  it("private receipts render only generic community text, own snapshot and terminal status", () => {
    const html = render(React.createElement(MembershipRequestHistory, { requests: [{ ...receipt, community_name: null, community_slug: null, status: "cancelled", cancellation_reason: "policy_changed", resolved_at: stamp }] }));
    assert.match(html, /Community details unavailable/); assert.match(html, /Request cancelled/); assert.match(html, /Shared label/);
    assert.doesNotMatch(html, /href=|grow-together|Grow together|11111111|22222222|reviewer/);
  });
  it("history and queue names render escaped text", () => {
    const name = '<img src=x onerror="alert(1)">';
    const history = render(React.createElement(MembershipRequestHistory, { requests: [{ ...receipt, requester_display_name: name, community_name: name }] }));
    const review = render(React.createElement(MembershipRequestReview, { communityId, requests: [{ ...pendingRequest, requester_display_name: name }] }));
    for (const html of [history, review]) { assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/); }
  });
  for (const status of ["approved", "rejected", "withdrawn", "cancelled"] as const) {
    it(`renders ${status} history accurately and allows explicit reapplication for nonmembers`, () => {
      const row = { ...receipt, status, resolved_at: stamp, cancellation_reason: status === "cancelled" ? "policy_changed" as const : null };
      const html = renderForm(row);
      assert.match(html, new RegExp(`Request ${status}`)); assert.match(html, /Submit request/); assert.match(html, /not currently a member/);
      assert.doesNotMatch(html, /value="Shared label"/);
    });
  }
  it("messages distinguish already resolved, already member and unavailable cancellation", () => {
    assert.match(requestOutcomeMessage({ request_id: requestId, status: "rejected", outcome: "already_resolved", cancellation_reason: null }), /already resolved\. Request rejected/);
    for (const [reason, expected] of [["already_member", /membership already existed/], ["cannot_be_admitted", /could not be admitted/], ["policy_changed", /settings changed/]] as const) {
      assert.match(requestOutcomeMessage({ request_id: requestId, status: "cancelled", outcome: "cancelled", cancellation_reason: reason }), expected);
    }
  });
  for (const operation of ["submit", "withdraw", "approve", "reject"] as const) {
    it(`${operation} pending state disables controls and displays a textual loading state`, () => {
      hookPending = true;
      const html = operation === "submit" ? renderForm() : operation === "withdraw" ? renderForm(receipt) : renderReview();
      assert.match(html, /aria-busy="true"/); assert.match(html, /disabled=""/);
      assert.match(html, operation === "submit" ? /Submitting…/ : operation === "withdraw" ? /Withdrawing…/ : /Reviewing…/);
      const buttons = html.match(/<button[^>]*type="submit"[^>]*>/g)!;
      assert.ok(buttons.every((button) => button.includes('disabled=""')));
    });
  }
  it("client validation uses backend Unicode and control-character rules without submitting invalid names", async () => {
    renderForm(); const initial = { result: { status: "idle" }, refreshRequired: false };
    for (const name of [" ", "bad\nname", "🌱".repeat(81)]) {
      const result = await reducer(initial, form("submit", name)) as { result: RequestActionState; refreshRequired: boolean };
      assert.equal(result.result.status, "error"); assert.equal(result.refreshRequired, false);
    }
    assert.equal(rpc.mock.callCount(), 0);
    await reducer(initial, form("submit", "🌱".repeat(80)));
    assert.equal(rpc.mock.callCount(), 1);
  });
  it("duplicate pending result does not offer another attempt or invent a different snapshot", async () => {
    mutation = { data: [{ request_id: requestId, status: "pending", outcome: "already_pending", cancellation_reason: null }], error: null };
    renderForm(); hookState = await reducer({ result: { status: "idle" }, refreshRequired: false }, form("submit"));
    const html = renderForm();
    assert.match(html, /no new attempt was created/); assert.match(html, /Approval pending/); assert.match(html, /disabled=""/);
    assert.doesNotMatch(html, /Shared name for this attempt/);
    await reducer(hookState, form("submit")); assert.equal(rpc.mock.callCount(), 1);
  });
  it("withdraw reports confirmed actual resolution instead of an optimistic withdrawal", async () => {
    mutation = { data: [{ request_id: requestId, status: "approved", outcome: "already_resolved", cancellation_reason: null }], error: null };
    renderForm(receipt); hookState = await reducer({ result: { status: "idle" }, refreshRequired: false }, form("withdraw"));
    const html = renderForm(receipt);
    assert.match(html, /already resolved\. Request approved/); assert.doesNotMatch(html, /Request withdrawn|Approval pending/);
  });
  it("review dispatch targets the exact attempt and renders the actual resolved status", async () => {
    mutation = { data: [{ request_id: requestId, status: "rejected", outcome: "already_resolved", cancellation_reason: null }], error: null };
    renderReview(); hookState = await reducer({ status: "idle" }, form("approve"));
    const html = renderReview();
    assert.match(html, /already resolved\. Request rejected/); assert.doesNotMatch(html, /Request approved/);
    assert.deepEqual(rpc.mock.calls[0].arguments, ["approve_community_membership_request", { p_community_id: communityId, p_request_id: requestId }]);
    await reducer(hookState, form("reject")); assert.equal(rpc.mock.callCount(), 1);
  });
  it("review rejection dispatches the fixed reject action without browser authority", async () => {
    mutation = { data: [{ request_id: requestId, status: "rejected", outcome: "resolved", cancellation_reason: null }], error: null };
    renderReview(); hookState = await reducer({ status: "idle" }, form("reject"));
    assert.match(renderReview(), /Request rejected/);
    assert.equal(rpc.mock.calls[0].arguments[0], "reject_community_membership_request");
  });
  it("review feedback survives a refreshed queue with the resolved row removed", async () => {
    mutation = { data: [{ request_id: requestId, status: "approved", outcome: "resolved", cancellation_reason: null }], error: null };
    renderReview(); hookState = await reducer({ status: "idle" }, form("approve"));
    const html = render(React.createElement(MembershipRequestReview, { communityId, requests: [] }));
    assert.match(html, /Last review: Request approved/); assert.match(html, /No pending requests/); assert.match(html, /Refresh status/);
  });
  it("subsequent history and queue pages send paired cursors in the correct direction", async () => {
    const search = Promise.resolve({ at: stamp, id: requestId });
    await HistoryPage({ searchParams: search });
    assert.deepEqual(rpc.mock.calls[0].arguments[1], { p_community_id: undefined, p_before_created_at: stamp, p_before_id: requestId, p_limit: 20 });
    community!.viewer_role = "owner";
    await ReviewPage({ params, searchParams: search });
    assert.deepEqual(rpc.mock.calls.at(-1)!.arguments[1], { p_community_id: communityId, p_after_created_at: stamp, p_after_id: requestId, p_limit: 20 });
  });
  it("uncertain/request-stale/authority failures lock controls and require refresh without replay", async () => {
    const logger = mock.method(console, "error", () => {});
    try {
      for (const code of ["42501", "40001"]) {
        mutation = { data: null, error: { code, message: "private provider message" } };
        hookState = undefined; renderReview(); hookState = await reducer({ status: "idle" }, form("approve"));
        const html = renderReview(); assert.match(html, /Refresh status/); assert.match(html, /disabled=""/); assert.doesNotMatch(html, /Request approved|private provider/);
        hookState = undefined; renderForm(); hookState = await reducer({ result: { status: "idle" }, refreshRequired: false }, form("submit"));
        const requester = renderForm(); assert.match(requester, /Refresh status/); assert.match(requester, /disabled=""/); assert.doesNotMatch(requester, /Approval pending/);
      }
    } finally { logger.mock.restore(); }
  });
  it("malformed and duplicate URL cursors fail before history reads", async () => {
    for (const search of [{ at: stamp }, { id: requestId }, { at: [stamp, stamp], id: requestId }, { role: "owner" }]) {
      const html = render(await HistoryPage({ searchParams: Promise.resolve(search) }));
      assert.match(html, /Invalid request page/);
    }
    assert.equal(rpc.mock.callCount(), 0);
  });
  it("history and review require authentication", async () => {
    user = null;
    await assert.rejects(HistoryPage({ searchParams }), /redirect:\/sign-in/);
    await assert.rejects(ReviewPage({ params, searchParams }), /redirect:\/sign-in/);
    assert.equal(rpc.mock.callCount(), 0);
  });
  it("creation and settings help explain every admission policy and private restriction", () => {
    const settings = { id: communityId, name: base.name, description: "", visibility: "public" as const, join_policy: "approval_required" as const };
    for (const html of [render(React.createElement(CommunityForm)), render(React.createElement(CommunitySettingsForm, { community: settings }))]) {
      assert.match(html, /join public\/unlisted communities immediately/); assert.match(html, /owner or admin must approve/);
      assert.match(html, /Invitation only: users cannot request access/); assert.match(html, /Private communities accept no unsolicited/);
      assert.match(html, /single-use invitation link/); assert.match(html, /limited preview available with a valid invitation/);
      assert.doesNotMatch(html, /Approval requests and invitations are not available yet/);
    }
  });
});
