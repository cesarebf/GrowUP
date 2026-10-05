import { beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { applicationLoader } from "./helpers/application-loader.mts";
const tenant = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222", raw = "ab".repeat(32);
const receipt = { invitation_id: id, created_at: "2026-09-30T12:00:00Z", expires_at: "2026-10-07T12:00:00Z" };
const history = { ...receipt, status: "revoked", accepted_at: null, revoked_at: "2026-09-30T13:00:00Z" };
const user = { id: "verified-user", email_confirmed_at: "2026-09-30T12:00:00Z" };
let candidate: unknown = user, rpcResult: unknown, authError: unknown = null;
const rpc = mock.fn(async (...args: unknown[]) => { void args; return rpcResult; });
const signInWithPassword = mock.fn(async (...args: unknown[]) => { void args; return { error: authError }; });
const signOut = mock.fn(async () => ({ error: null }));
const client = { auth: { getUser: async () => ({ data: { user: candidate }, error: null }), signInWithPassword, signOut }, rpc };
const createClient = mock.fn(async (writable?: boolean) => { void writable; return client; });
const revalidatePath = mock.fn((...args: unknown[]) => { void args; });
// The stub throws a generic control-flow sentinel, never the secret destination.
const redirect = mock.fn((path: string) => { void path; throw new Error("test redirect"); });
const values = new Map<string, string>();
const set = mock.fn((name: string, value: string, options: unknown) => { void options; values.set(name, value); });
const remove = mock.fn((name: string) => { values.delete(name); });
applicationLoader({ "@/lib/supabase/server": { createClient }, "next/cache": { revalidatePath }, "next/navigation": { redirect }, "next/headers": { cookies: async () => ({ set, delete: remove, get: (name: string) => values.has(name) ? { value: values.get(name)! } : undefined }) } });
const actions = await import("../src/app/communities/invitation-actions.ts");
const authActions = await import("../src/app/auth/actions.ts");
const { invitationReturnCookie } = await import("../src/lib/auth/invitation-return.ts");
function form(fields: Record<string, string>) { const f = new FormData(); for (const [k, v] of Object.entries(fields))
    f.set(k, v); return f; }
describe("invitation Server Actions and Auth continuation", () => {
    beforeEach(() => { candidate = user; authError = null; values.clear(); for (const fn of [rpc, signInWithPassword, signOut, createClient, revalidatePath, redirect, set, remove])
        fn.mock.resetCalls(); process.env.APP_URL = "http://localhost:3000"; });
    const operations = [
        ["create", actions.createInvitationAction, { community_id: tenant }, receipt, "create_community_invitation"],
        ["revoke", actions.revokeInvitationAction, { community_id: tenant, invitation_id: id }, history, "revoke_community_invitation"],
        ["accept", actions.acceptInvitationAction, { token: raw }, { outcome: "accepted", community_slug: "invite-tenant" }, "accept_community_invitation"],
    ] as const;
    for (const [name, action, fields, result, rpcName] of operations) {
        it(`${name} creates writable ordinary client, calls fixed RPC and invalidates only token-free patterns`, async () => {
            rpcResult = { data: [result], error: null };
            assert.equal((await action({ status: "idle" }, form(fields))).status, "success");
            assert.deepEqual(createClient.mock.calls[0].arguments, [true]);
            assert.equal(rpc.mock.calls[0].arguments[0], rpcName);
            assert.deepEqual(revalidatePath.mock.calls.map(c => c.arguments), [["/communities"], ["/communities/requests"], ["/c/[slug]", "page"], ["/c/[slug]/requests", "page"], ["/c/[slug]/invitations", "page"], ["/invite/[token]", "page"]]);
            assert.ok(!JSON.stringify(revalidatePath.mock.calls).includes(raw));
        });
        it(`${name} rejects forged identity/role before RPC`, async () => { rpcResult = { data: [result], error: null }; assert.equal((await action({ status: "idle" }, form({ ...fields, role: "owner" }))).status, "error"); assert.equal(rpc.mock.callCount(), 0); assert.equal(revalidatePath.mock.callCount(), 0); });
        it(`${name} safe provider error has no raw token and no automatic retry`, async () => { rpcResult = { data: null, error: { code: raw, message: raw, details: raw } }; const logger = mock.method(console, "error", () => { }); try {
            const output = await action({ status: "idle" }, form(fields));
            assert.equal(output.status, "error");
            assert.ok(!JSON.stringify([output, logger.mock.calls.map(c => c.arguments)]).includes(raw));
            assert.equal(rpc.mock.callCount(), 1);
            assert.equal(revalidatePath.mock.callCount(), 0);
        }
        finally {
            logger.mock.restore();
        } });
        it(`${name} session expiry redirects fixed sign-in; accept alone preserves bounded return cookie`, async () => { candidate = null; await assert.rejects(action({ status: "idle" }, form(fields)), /test redirect/); assert.equal(redirect.mock.calls[0].arguments[0], "/sign-in"); assert.equal(rpc.mock.callCount(), 0); assert.equal(set.mock.callCount(), name === "accept" ? 1 : 0); assert.equal(revalidatePath.mock.callCount(), 0); });
    }
    it("explicit start Auth action sets cookie and redirects only sign-up without preview or admission", async () => { await assert.rejects(actions.startInvitationAuthAction({ status: "idle" }, form({ token: raw, destination: "sign-up" })), /test redirect/); assert.equal(redirect.mock.calls[0].arguments[0], "/sign-up"); assert.equal(values.get(invitationReturnCookie), raw); assert.equal(rpc.mock.callCount(), 0); });
    it("start Auth rejects open redirect and unexpected fields without cookie mutation", async () => { assert.equal((await actions.startInvitationAuthAction({ status: "idle" }, form({ token: raw, destination: "//evil.test" }))).status, "error"); assert.equal((await actions.startInvitationAuthAction({ status: "idle" }, form({ token: raw, destination: "sign-in", next: "/account" }))).status, "error"); assert.equal(set.mock.callCount(), 0); assert.equal(redirect.mock.callCount(), 0); });
    it("successful authoritative signin clears cookie and returns invite without automatic acceptance", async () => { values.set(invitationReturnCookie, raw); await assert.rejects(authActions.signInAction({ status: "idle", message: "" }, form({ email: "test@example.test", password: "good-password-123" })), /test redirect/); assert.equal(redirect.mock.calls[0].arguments[0], `/invite/${raw}`); assert.equal(values.size, 0); assert.equal(rpc.mock.callCount(), 0); });
    it("failed signin retains original return cookie expiry", async () => { values.set(invitationReturnCookie, raw); authError = { status: 400, code: "invalid_credentials" }; assert.equal((await authActions.signInAction({ status: "idle", message: "" }, form({ email: "test@example.test", password: "bad" }))).status, "error"); assert.equal(values.get(invitationReturnCookie), raw); assert.equal(set.mock.callCount(), 0); assert.equal(remove.mock.callCount(), 0); });
    for (const cookie of [undefined, "//evil.test", "%2finvite%2f" + raw])
        it(`successful signin with ${cookie === undefined ? "missing" : "invalid"} cookie falls back to account`, async () => { if (cookie !== undefined)
            values.set(invitationReturnCookie, cookie); await assert.rejects(authActions.signInAction({ status: "idle", message: "" }, form({ email: "test@example.test", password: "good-password-123" })), /test redirect/); assert.equal(redirect.mock.calls[0].arguments[0], "/account"); assert.equal(values.size, 0); });
    it("successful logout clears return credential", async () => { values.set(invitationReturnCookie, raw); await assert.rejects(authActions.signOutAction(), /test redirect/); assert.equal(values.size, 0); assert.equal(redirect.mock.calls[0].arguments[0], "/sign-in?notice=signed-out"); });
});
