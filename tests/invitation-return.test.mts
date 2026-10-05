import { beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { applicationLoader } from "./helpers/application-loader.mts";
const values = new Map<string, string>();
const set = mock.fn((name: string, value: string, options: unknown) => { void options; values.set(name, value); });
const remove = mock.fn((name: string) => { values.delete(name); });
const store = { set, delete: remove, get: (name: string) => values.has(name) ? { value: values.get(name)! } : undefined };
applicationLoader({ "next/headers": { cookies: async () => store } });
const { clearInvitationReturn, consumeInvitationReturn, invitationCookieOptions, invitationReturnCookie, startInvitationReturn } = await import("../src/lib/auth/invitation-return.ts");
const raw = "ab".repeat(32);
function form(token = raw, destination = "sign-in") { const f = new FormData(); f.set("token", token); f.set("destination", destination); return f; }
describe("narrow invitation authentication return cookie", () => {
    beforeEach(() => { values.clear(); set.mock.resetCalls(); remove.mock.resetCalls(); process.env.APP_URL = "http://localhost:3000"; });
    it("sets only canonical token with HttpOnly host-only Lax 60-minute loopback flags", async () => { assert.equal(await startInvitationReturn(form()), "/sign-in"); assert.deepEqual(set.mock.calls[0].arguments, [invitationReturnCookie, raw, { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 3600 }]); });
    it("HTTPS is Secure independent of NODE_ENV; loopback HTTP supports production-build validation", () => { for (const origin of ["https://app.example.test", "https://localhost"])
        assert.equal(invitationCookieOptions(origin).secure, true); for (const origin of ["http://localhost:3010", "http://127.0.0.1:3000", "http://[::1]:3000"])
        assert.equal(invitationCookieOptions(origin).secure, false); assert.throws(() => invitationCookieOptions("http://untrusted.test")); });
    it("sign-up survives until successful sign-in consumes and deletes fixed relative route", async () => { assert.equal(await startInvitationReturn(form(raw, "sign-up")), "/sign-up"); assert.equal(await consumeInvitationReturn(), `/invite/${raw}`); assert.equal(values.size, 0); assert.equal(await consumeInvitationReturn(), "/account"); });
    it("last-started tab replaces prior context; failed-login callers leave original expiry unchanged", async () => { await startInvitationReturn(form()); await startInvitationReturn(form("cd".repeat(32))); assert.equal(set.mock.callCount(), 2); assert.equal(values.get(invitationReturnCookie), "cd".repeat(32)); assert.equal(await consumeInvitationReturn(), `/invite/${"cd".repeat(32)}`); });
    for (const token of ["", raw.toUpperCase(), raw + "\n", "https://evil.test/", `//evil.test/${raw}`, `%2finvite%2f${raw}`])
        it(`malformed return token length ${token.length} denies and cannot redirect`, async () => { assert.equal(await startInvitationReturn(form(token)), null); values.set(invitationReturnCookie, token); assert.equal(await consumeInvitationReturn(), "/account"); assert.equal(values.size, 0); assert.equal(set.mock.callCount(), 0); });
    for (const destination of ["/sign-in", "https://evil.test", "//evil.test", "account", "/invite/" + raw])
        it(`denies arbitrary destination of length ${destination.length}`, async () => { assert.equal(await startInvitationReturn(form(raw, destination)), null); assert.equal(set.mock.callCount(), 0); });
    for (const mode of ["duplicate", "file", "extra", "missing"])
        it(`rejects ${mode} return fields`, async () => { const f = form(); if (mode === "duplicate")
            f.append("token", raw); if (mode === "file")
            f.set("token", new Blob([raw]), "token.txt"); if (mode === "extra")
            f.set("next", "https://evil.test"); if (mode === "missing")
            f.delete("token"); assert.equal(await startInvitationReturn(f), null); assert.equal(set.mock.callCount(), 0); });
    it("logout deletes return credential", async () => { await startInvitationReturn(form()); await clearInvitationReturn(); assert.equal(values.size, 0); });
});
