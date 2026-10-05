import { beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { ReactNode } from "react";
import { applicationLoader } from "./helpers/application-loader.mts";
import { invitationPresentationUrl, copyInvitationLink, invitationPageInput, nextInvitationPage } from "../src/lib/communities/invitation-presentation.ts";
import { invitationUnavailable, type InvitationPreview, type InvitationHistory } from "../src/lib/communities/invitation-validation.ts";

const require = createRequire(import.meta.url);
const React = require("../node_modules/react/index.js") as typeof import("react");
const tenant = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
const raw = "ab".repeat(32), stamp = "2026-09-30T12:00:00.123456Z", expires = "2026-10-07T12:00:00.123456Z";
const receipt = { invitation_id: id, created_at: stamp, expires_at: expires };
const row: InvitationHistory = { ...receipt, status: "active", accepted_at: null, revoked_at: null };
const active: InvitationPreview = { outcome: "active", community_name: "Private garden", community_description: "A bounded preview", expires_at: expires, already_member: false, community_slug: null };
const base = { id: tenant, name: "Private garden", slug: "private-garden", description: "A bounded preview", visibility: "private", join_policy: "invitation_only", viewer_role: "owner" };
let community: Record<string, unknown> | null, user: unknown, preview: unknown, history: unknown[], readError: unknown, mutation: unknown;
let hookState: unknown, pending = false;
let reducer: (previous: unknown, form: FormData) => Promise<{ status: string }>;
const rpc = mock.fn(async (name: string, ...args: unknown[]) => {
  void args;
  if (name === "get_community_landing") return { data: community ? [community] : [], error: null };
  if (name === "list_community_invitations") return { data: history, error: readError };
  if (name === "get_community_invitation_preview") return { data: [preview], error: readError };
  return mutation;
});
const revalidatePath = mock.fn((...args: unknown[]) => { void args; });
const redirect = mock.fn((path: string) => { void path; throw new Error("test redirect"); });
const setCookie = mock.fn((...args: unknown[]) => { void args; });
applicationLoader({
  react: { ...React, useActionState: (run: typeof reducer, initial: unknown) => { reducer = run; return [hookState ?? initial, () => {}, pending]; } },
  "next/link": { default: ({ children, prefetch, replace, ...props }: { children: ReactNode; prefetch?: boolean; replace?: boolean }) => { assert.equal(prefetch, false); void replace; return React.createElement("a", props, children); } },
  "next/navigation": { redirect, notFound: () => { throw new Error("not-found"); } },
  "next/cache": { revalidatePath },
  "next/headers": { cookies: async () => ({ set: setCookie }) },
  "@/lib/supabase/server": { createClient: async () => ({ rpc, auth: { getUser: async () => ({ data: { user }, error: null }) } }) },
  "@/lib/supabase/config": { isSupabaseConfigured: () => true, parseOrigin: () => "http://localhost:4317" },
}, true);
const { renderToStaticMarkup: render } = await import("react-dom/server");
const managerModule = await import("../src/app/c/[slug]/invitations/page.tsx");
const recipientModule = await import("../src/app/invite/[token]/page.tsx");
const { CommunityInvitations } = await import("../src/components/community-invitations.tsx");
const { CommunityInvitationAccept, InvitationAuth } = await import("../src/components/community-invitation-accept.tsx");
const { default: ErrorPage } = await import("../src/app/invite/[token]/error.tsx");
const params = Promise.resolve({ slug: base.slug });
const page = () => managerModule.default({ params, searchParams: Promise.resolve({}) });
const recipient = (token = raw) => recipientModule.default({ params: Promise.resolve({ token }) });
const manager = (rows = [row]) => render(React.createElement(CommunityInvitations, { communityId: tenant, invitations: rows }));
const accept = (value = active, signedIn = true) => render(React.createElement(CommunityInvitationAccept, { token: raw, preview: value, signedIn }));
function form(values: Record<string, string>) { const result = new FormData(); for (const [key, value] of Object.entries(values)) result.set(key, value); return result; }
const idle = { status: "idle" };

describe("invitation UI and application integration", () => {
  beforeEach(() => {
    process.env.APP_URL = "http://localhost:4317";
    community = { ...base }; user = { id: "private-user-id", email: "private@example.test", email_confirmed_at: stamp };
    preview = { ...active }; history = [row]; readError = null; mutation = { data: [receipt], error: null };
    hookState = undefined; pending = false;
    for (const fn of [rpc, revalidatePath, redirect, setCookie]) fn.mock.resetCalls();
  });
  for (const role of ["owner", "admin"]) it(`${role} receives authorized management and safe history`, async () => {
    community!.viewer_role = role;
    const html = render(await page());
    assert.match(html, /Create invitation/); assert.match(html, /Revoke/); assert.match(html, /Active/);
    assert.doesNotMatch(html, /token_hash|private-user-id|private@example|Copy link/);
    assert.equal(html.includes(raw), false);
    assert.deepEqual(rpc.mock.calls.at(-1)!.arguments[1], { p_community_id: tenant, p_before_created_at: undefined, p_before_id: undefined, p_limit: 20 });
  });
  for (const role of ["moderator", "member", null]) it(`${role ?? "unrelated"} cannot load management`, async () => {
    community!.viewer_role = role;
    await assert.rejects(page(), /not-found/);
    assert.equal(rpc.mock.calls.some(c => c.arguments[0] === "list_community_invitations"), false);
  });
  it("anonymous management redirects before community lookup", async () => { user = null; await assert.rejects(page(), /test redirect/); assert.equal(rpc.mock.callCount(), 0); assert.equal(redirect.mock.calls[0].arguments[0], "/sign-in"); });
  it("lost manager permission at the authoritative list removes all controls", async () => {
    readError = { code: "42501", message: "private detail" };
    const log = mock.method(console, "error", () => {});
    try { const html = render(await page()); assert.match(html, /could not be confirmed/); assert.doesNotMatch(html, /Create invitation|Revoke|private detail/); }
    finally { log.mock.restore(); }
  });
  it("history rejects extra secret or identity fields", async () => {
    const log = mock.method(console, "error", () => {});
    try { for (const key of ["token_hash", "token", "created_by_user_id", "accepted_by_user_id", "email"]) {
      history = [{ ...row, [key]: raw }]; const html = render(await page());
      assert.equal(html.includes(raw), false); assert.doesNotMatch(html, /Create invitation|Revoke/);
    } } finally { log.mock.restore(); }
  });
  it("paired history cursor preserves microseconds and newest-first direction", async () => {
    history = Array.from({ length: 20 }, () => row);
    assert.match(render(await page()), /Older invitations/);
    const path = nextInvitationPage("/c/private-garden/invitations", row);
    const search = Object.fromEntries(new URL(path, "http://localhost").searchParams);
    assert.equal(invitationPageInput(search, tenant).status, "success");
    await managerModule.default({ params, searchParams: Promise.resolve(search) });
    assert.deepEqual(rpc.mock.calls.at(-1)!.arguments[1], { p_community_id: tenant, p_before_created_at: stamp, p_before_id: id, p_limit: 20 });
  });
  for (const search of [{ at: stamp }, { id }, { at: [stamp, stamp], id }, { next: "//evil.test" }]) it("rejects malformed pagination without a history read", async () => {
    const html = render(await managerModule.default({ params, searchParams: Promise.resolve(search) }));
    assert.match(html, /Invalid invitation page/); assert.equal(rpc.mock.callCount(), 1);
  });
  it("create displays only the one-time response, prevents replay, and refresh loses delivery", async () => {
    manager(); hookState = await reducer(idle, form({ operation: "create", community_id: tenant }));
    assert.equal((hookState as { status: string }).status, "created");
    const html = manager(); assert.match(html, /Copy link/); assert.match(html, /cannot recover/); assert.match(html, /168 hours/); assert.match(html, /single-use/);
    await reducer(hookState, form({ operation: "create", community_id: tenant })); assert.equal(rpc.mock.callCount(), 1);
    hookState = undefined; assert.doesNotMatch(manager(), /Copy link|textarea/);
  });
  it("create failure gives safe feedback and blocks repeated submission", async () => {
    mutation = { data: null, error: { code: "42501", message: raw } };
    const log = mock.method(console, "error", () => {});
    try { manager(); hookState = await reducer(idle, form({ operation: "create", community_id: tenant }));
      const html = manager(); assert.match(html, /Refresh/); assert.match(html, /disabled/); assert.equal(html.includes(raw), false);
      await reducer(hookState, form({ operation: "create", community_id: tenant })); assert.equal(rpc.mock.callCount(), 1);
    } finally { log.mock.restore(); }
  });
  for (const status of ["revoked", "accepted", "expired"] as const) it(`revoke reconciles actual ${status} without fabricated success`, async () => {
    mutation = { data: [{ ...row, status, accepted_at: status === "accepted" ? stamp : null, revoked_at: status === "revoked" ? stamp : null }], error: null };
    manager(); hookState = await reducer(idle, form({ operation: "revoke", confirm: "yes", community_id: tenant, invitation_id: id }));
    const html = manager(); assert.doesNotMatch(html, /value="revoke"/);
    assert.match(html, status === "revoked" ? /Invitation revoked/ : /it was not revoked/);
    assert.deepEqual(rpc.mock.calls[0].arguments, ["revoke_community_invitation", { p_community_id: tenant, p_invitation_id: id }]);
    await reducer(hookState, form({ operation: "revoke", confirm: "yes", community_id: tenant, invitation_id: id })); assert.equal(rpc.mock.callCount(), 1);
  });
  it("revocation requires an explicit confirmation", async () => { manager(); const result = await reducer(idle, form({ operation: "revoke", community_id: tenant, invitation_id: id })); assert.equal(result.status, "error"); assert.equal(rpc.mock.callCount(), 0); });
  it("loading disables creation and every revocation together", () => { pending = true; const html = manager(); assert.match(html, /aria-busy="true"/); assert.match(html, /Updating invitation/); assert.ok([...html.matchAll(/<button[^>]*type="submit"[^>]*>/g)].every(m => m[0].includes("disabled"))); });
  for (const status of ["active", "accepted", "revoked", "expired"] as const) it(`history renders authoritative ${status}`, () => { const html = manager([{ ...row, status }]); assert.equal(html.includes('value="revoke"'), status === "active"); assert.equal(html.includes(raw), false); });
  it("private valid preview is bounded and GET never admits", async () => { const html = render(await recipient()); assert.match(html, /Private garden|Accept invitation/); assert.doesNotMatch(html, /\/c\/private-garden|private-user-id|private@example|token_hash/); assert.equal(rpc.mock.callCount(), 1); assert.equal(rpc.mock.calls[0].arguments[0], "get_community_invitation_preview"); });
  it("malformed token is uniform unavailable without provider access or echo", async () => { const html = render(await recipient("malformed-secret")); assert.match(html, /This invitation is unavailable/); assert.doesNotMatch(html, /malformed-secret|Private garden/); assert.equal(rpc.mock.callCount(), 0); });
  for (const reason of ["nonexistent", "expired", "revoked", "accepted by another"]) it(`${reason} uses the same metadata-free unavailable projection`, async () => { preview = invitationUnavailable; const html = render(await recipient()); assert.match(html, /This invitation is unavailable/); assert.doesNotMatch(html, /Private garden|Accept invitation/); assert.equal(html.includes(raw), false); });
  it("read failure exposes no earlier/private preview", async () => { readError = { code: "42501", message: raw }; const log = mock.method(console, "error", () => {}); try { const html = render(await recipient()); assert.match(html, /Refresh status/); assert.doesNotMatch(html, /Private garden/); assert.equal(html.includes(raw), false); } finally { log.mock.restore(); } });
  it("same accepter with current membership receives an informational community link only", async () => { preview = { ...active, outcome: "accepted", already_member: true, community_slug: base.slug }; const html = render(await recipient()); assert.match(html, /Invitation already accepted|Enter community/); assert.doesNotMatch(html, /Accept invitation|name="token"/); assert.equal(rpc.mock.callCount(), 1); });
  it("departed accepter replay reveals no reconstructed community and cannot rejoin", async () => { preview = { ...invitationUnavailable, outcome: "accepted" }; const html = render(await recipient()); assert.match(html, /cannot be used to join again/); assert.doesNotMatch(html, /Private garden|private-garden|Accept invitation|Enter community/); });
  it("signed-out preview offers fixed Auth POST choices and honest signup continuation", async () => { user = null; const html = render(await recipient()); assert.match(html, /Sign in/); assert.match(html, /Sign up/); assert.match(html, /within one hour/); assert.match(html, /reopen the original/); assert.doesNotMatch(html, /href="\/sign-(in|up)\?|next=|returnTo=/); assert.equal(rpc.mock.callCount(), 1); });
  for (const destination of ["sign-in", "sign-up"]) it(`explicit ${destination} sets approved cookie and uses a fixed destination`, async () => { render(React.createElement(InvitationAuth, { token: raw })); await reducer(idle, form({ token: raw, destination })); assert.equal(redirect.mock.calls[0].arguments[0], `/${destination}`); assert.equal(setCookie.mock.callCount(), 1); assert.equal(rpc.mock.callCount(), 0); });
  it("auth controls share semantic pending state", () => { pending = true; const html = render(React.createElement(InvitationAuth, { token: raw })); assert.match(html, /aria-busy="true"/); assert.match(html, /Opening authentication/); assert.ok([...html.matchAll(/<button[^>]*>/g)].every(m => m[0].includes("disabled"))); });
  for (const role of ["member", "moderator", "admin", "owner"]) it(`${role} preview explains unused invite and unchanged role with explicit Continue`, () => { const html = accept({ ...active, already_member: true }); assert.match(html, /remains unused/); assert.match(html, /role is unchanged/); assert.match(html, /Continue to community/); assert.doesNotMatch(html, /Accept invitation/); assert.equal(rpc.mock.callCount(), 0); });
  it("explicit acceptance confirms membership and invalidates pending-request surfaces", async () => {
    mutation = { data: [{ outcome: "accepted", community_slug: base.slug }], error: null };
    accept(); assert.equal(rpc.mock.callCount(), 0); hookState = await reducer(idle, form({ token: raw }));
    const html = accept(); assert.match(html, /membership is confirmed/); assert.match(html, /Enter community/); assert.doesNotMatch(html, /Accept invitation|Request membership|Private garden|name="token"/);
    assert.ok(revalidatePath.mock.calls.some(c => c.arguments[0] === "/communities/requests"));
    assert.ok(revalidatePath.mock.calls.some(c => c.arguments[0] === "/c/[slug]/requests"));
    await reducer(hookState, form({ token: raw })); assert.equal(rpc.mock.callCount(), 1);
  });
  for (const outcome of ["already_member", "unavailable", "accepted"] as const) it(`acceptance reconciles ${outcome} instead of stale private preview`, async () => {
    mutation = { data: [{ outcome, community_slug: outcome === "already_member" ? base.slug : null }], error: null };
    accept(); hookState = await reducer(idle, form({ token: raw })); const html = accept();
    assert.doesNotMatch(html, /Private garden|A bounded preview|name="token"/);
    assert.match(html, outcome === "already_member" ? /remains unused/ : outcome === "unavailable" ? /This invitation is unavailable/ : /cannot be used to join again/);
  });
  it("ambiguous acceptance removes private preview and requires refresh", async () => { mutation = { data: null, error: { code: "40001", message: raw } }; const log = mock.method(console, "error", () => {}); try { accept(); hookState = await reducer(idle, form({ token: raw })); const html = accept(); assert.match(html, /Refresh status/); assert.doesNotMatch(html, /Private garden|Accept invitation/); assert.equal(html.includes(raw), false); } finally { log.mock.restore(); } });
  it("acceptance loading is semantic and disabled", () => { pending = true; const html = accept(); assert.match(html, /aria-busy="true"/); assert.match(html, /Checking invitation/); assert.match(html, /disabled/); });
  it("names/descriptions escape markup and expose no identities", () => { const html = accept({ ...active, community_name: '<img src=x onerror="alert(1)">', community_description: "<script>alert(1)</script>" }); assert.match(html, /&lt;img/); assert.match(html, /&lt;script/); assert.doesNotMatch(html, /<img|<script>alert|private@example|private-user-id/); });
  it("routes are dynamic with generic noindex/no-referrer metadata and safe error page", () => { assert.equal(managerModule.dynamic, "force-dynamic"); assert.equal(recipientModule.dynamic, "force-dynamic"); assert.equal(recipientModule.metadata.referrer, "no-referrer"); assert.deepEqual(recipientModule.metadata.robots, { index: false, follow: false, nosnippet: true }); const html = render(React.createElement(ErrorPage)); assert.match(html, /temporarily unavailable/); assert.equal(html.includes(raw), false); });
});

describe("browser-origin invitation copying", () => {
  for (const origin of ["http://localhost:3000", "http://127.0.0.1:4317", "http://localhost:65530", "https://future.example"]) it(`uses actual browser origin ${origin}`, () => { assert.equal(invitationPresentationUrl(`/invite/${raw}`, origin), `${origin}/invite/${raw}`); });
  for (const path of ["//evil.test/invite/" + raw, "https://evil.test/invite/" + raw, "/invite/" + raw + "?next=x", "/invite/" + raw.toUpperCase(), "/invite/%61" + raw.slice(1), "/invite/" + raw + "/"]) it("rejects noncanonical relative paths", () => { assert.equal(invitationPresentationUrl(path, "http://localhost:4317"), null); });
  it("clipboard success writes only the validated absolute presentation URL", async () => { const writeText = mock.fn(async (value: string) => { void value; }); assert.equal(await copyInvitationLink(`/invite/${raw}`, "http://localhost:4317", { writeText }), "copied"); assert.equal(writeText.mock.calls[0].arguments[0], `http://localhost:4317/invite/${raw}`); });
  it("clipboard denial and absence return manual-copy fallback", async () => { assert.equal(await copyInvitationLink(`/invite/${raw}`, "http://localhost:4317", { writeText: async () => { throw new Error("denied"); } }), "manual"); assert.equal(await copyInvitationLink(`/invite/${raw}`, "http://localhost:4317"), "manual"); });
  it("invalid link never touches clipboard", async () => { const writeText = mock.fn(async (value: string) => { void value; }); assert.equal(await copyInvitationLink("//evil.test", "http://localhost:4317", { writeText }), "invalid"); assert.equal(writeText.mock.callCount(), 0); });
});
