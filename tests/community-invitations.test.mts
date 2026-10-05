import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { acceptInvitation, createInvitation, generateInvitationToken, hashInvitationToken, listInvitations, previewInvitation, revokeInvitation } from "../src/lib/communities/invitations.ts";
import { AuthenticationRequired, type Client } from "../src/lib/auth/service.ts";
import { invitationPath, invitationUnavailable, isInvitationToken, parseInvitationPage } from "../src/lib/communities/invitation-validation.ts";
const tenant = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222", raw = "ab".repeat(32);
const receipt = { invitation_id: id, created_at: "2026-09-30T12:00:00.123456Z", expires_at: "2026-10-07T12:00:00.123456Z" };
const history = { ...receipt, status: "active", accepted_at: null, revoked_at: null };
const user = { id: "authoritative", email_confirmed_at: "2026-09-30T12:00:00Z" };
function client(result: unknown, candidate: unknown = user) { const rpc = mock.fn(async (...args: unknown[]) => { void args; return result; }); return { rpc, value: { auth: { getUser: async () => ({ data: { user: candidate }, error: null }) }, rpc } as unknown as Client }; }
function form(fields: Record<string, string>) { const f = new FormData(); for (const [k, v] of Object.entries(fields))
    f.set(k, v); return f; }
describe("invitation microsecond service-boundary regression", () => {
    const boundaries = [
        { name: "accepted history", status: "accepted", field: "accepted_at", revoke: false },
        { name: "revoked history", status: "revoked", field: "revoked_at", revoke: false },
        { name: "revoke response", status: "revoked", field: "revoked_at", revoke: true },
    ] as const;
    const cases = [
        ["one microsecond before expiry", "2026-10-07T12:00:00.123455Z", true],
        ["exactly at expiry", receipt.expires_at, false],
        ["one microsecond after expiry", "2026-10-07T12:00:00.123457Z", false],
        ["one microsecond before creation", "2026-09-30T12:00:00.123455Z", false],
        ["exactly at creation", receipt.created_at, true],
        ["one microsecond after creation", "2026-09-30T12:00:00.123457Z", true],
        ["whole seconds", "2026-10-07T12:00:00Z", true],
        ["one fractional digit", "2026-10-07T12:00:00.1Z", true],
        ["two fractional digits", "2026-10-07T12:00:00.12Z", true],
        ["three fractional digits", "2026-10-07T12:00:00.123Z", true],
        ["four fractional digits", "2026-10-07T12:00:00.1234Z", true],
        ["five fractional digits", "2026-10-07T12:00:00.12345Z", true],
        ["positive offset before expiry", "2026-10-07T14:30:00.123455+02:30", true],
        ["negative offset equal to expiry", "2026-10-07T08:30:00.123456-03:30", false],
        ["invalid calendar date", "2026-09-31T12:00:00.123455Z", false],
        ["excess fractional precision", "2026-10-07T12:00:00.1234550Z", false],
        ["missing timezone", "2026-10-07T12:00:00.123455", false],
    ] as const;
    for (const boundary of boundaries) {
        for (const [name, resolved, valid] of cases) {
            it(`${boundary.name}: ${name}`, async () => {
                const row = { ...history, status: boundary.status, [boundary.field]: resolved };
                const c = client({ data: [row], error: null });
                const logger = mock.method(console, "error", () => {});
                try {
                    const result = boundary.revoke
                        ? await revokeInvitation(c.value, form({ community_id: tenant, invitation_id: id }))
                        : await listInvitations(c.value, { communityId: tenant });
                    assert.equal(result.status, valid ? "success" : "error");
                    if (valid) assert.deepEqual(result, { status: "success", data: boundary.revoke ? row : [row] });
                    assert.equal(c.rpc.mock.callCount(), 1);
                } finally { logger.mock.restore(); }
            });
        }
        it(`${boundary.name}: equivalent fractional precision and timezone representations`, async () => {
            const row = {
                ...history, status: boundary.status,
                created_at: "2026-09-30T12:00:00.123Z",
                expires_at: "2026-10-07T14:00:00.123000+02:00",
                [boundary.field]: "2026-10-07T12:00:00.122999Z",
            };
            const c = client({ data: [row], error: null });
            const result = boundary.revoke
                ? await revokeInvitation(c.value, form({ community_id: tenant, invitation_id: id }))
                : await listInvitations(c.value, { communityId: tenant });
            assert.deepEqual(result, { status: "success", data: boundary.revoke ? row : [row] });
        });
    }
    for (const [name, expires, valid] of [
        ["exact 168 hours", receipt.expires_at, true],
        ["168 hours minus one microsecond", "2026-10-07T12:00:00.123455Z", false],
        ["168 hours plus one microsecond", "2026-10-07T12:00:00.123457Z", false],
        ["equivalent offset", "2026-10-07T09:00:00.123456-03:00", true],
    ] as const) {
        it(`creation receipt: ${name}`, async () => {
            const c = client({ data: [{ ...receipt, expires_at: expires }], error: null });
            const logger = mock.method(console, "error", () => {});
            try {
                assert.equal((await createInvitation(c.value, form({ community_id: tenant }))).status, valid ? "success" : "error");
                assert.equal(c.rpc.mock.callCount(), 1);
            } finally { logger.mock.restore(); }
        });
    }
});

describe("invitation server services and strict boundaries", () => {
    it("uses built-in CSPRNG and deterministic UTF-8 SHA-256 with 256-bit canonical tokens", () => { const tokens = Array.from({ length: 100 }, generateInvitationToken); assert.equal(new Set(tokens).size, 100); for (const t of tokens) {
        assert.equal(t.length, 64);
        assert.equal(isInvitationToken(t), true);
        assert.equal(hashInvitationToken(t), createHash("sha256").update(t, "utf8").digest("hex"));
    } });
    for (const value of [undefined, null, [], {}, "", raw.toUpperCase(), raw + "\n", " " + raw, "%61".repeat(64), "a".repeat(63), "a".repeat(65), "https://evil.test/" + raw])
        it(`denies malformed token type ${typeof value} length ${typeof value === "string" ? value.length : 0}`, () => { assert.equal(isInvitationToken(value), false); assert.equal(invitationPath(value), null); });
    it("create sends only digest and tenant and delivers relative path once", async () => { const c = client({ data: [receipt], error: null }); const result = await createInvitation(c.value, form({ community_id: tenant })); assert.equal(result.status, "success"); if (result.status !== "success")
        return; const token = result.data.path.slice(8); assert.equal(isInvitationToken(token), true); assert.deepEqual(c.rpc.mock.calls[0].arguments, ["create_community_invitation", { p_community_id: tenant, p_token_hash: hashInvitationToken(token) }]); assert.ok(!JSON.stringify(c.rpc.mock.calls).includes(token)); assert.equal(c.rpc.mock.callCount(), 1); });
    const operations = [
        ["create", createInvitation, { community_id: tenant }, receipt],
        ["revoke", revokeInvitation, { community_id: tenant, invitation_id: id }, history],
        ["accept", acceptInvitation, { token: raw }, { outcome: "accepted", community_slug: "invite-tenant" }],
    ] as const;
    for (const [name, operation, fields, result] of operations) {
        it(`${name} requires authoritative getUser before RPC`, async () => { const c = client({ data: [result], error: null }, null); await assert.rejects(operation(c.value, form(fields)), AuthenticationRequired); assert.equal(c.rpc.mock.callCount(), 0); });
        for (const key of ["user_id", "created_by_user_id", "accepted_by_user_id", "role", "expires_at", "status", "next", "origin", "p_community_id"])
            it(`${name} rejects forged ${key}`, async () => { const c = client({ data: [result], error: null }); assert.equal((await operation(c.value, form({ ...fields, [key]: "forged" }))).status, "error"); assert.equal(c.rpc.mock.callCount(), 0); });
        for (const mode of ["missing", "duplicate", "file"])
            it(`${name} rejects ${mode} fields`, async () => { const c = client({ data: [result], error: null }); const f = form(fields); const key = Object.keys(fields)[0]; if (mode === "missing")
                f.delete(key); if (mode === "duplicate")
                f.append(key, "duplicate"); if (mode === "file")
                f.set(key, new Blob([raw]), "input.txt"); assert.equal((await operation(c.value, f)).status, "error"); assert.equal(c.rpc.mock.callCount(), 0); });
        it(`${name} maps errors safely including capability-shaped error codes and never retries`, async () => { const logger = mock.method(console, "error", () => { }); try {
            for (const error of [{ code: raw, message: raw, details: raw, hint: raw }, { code: "42501", message: raw }, { code: "22023", message: raw }, { code: "40P01", message: raw }]) {
                const c = client({ data: null, error });
                const output = await operation(c.value, form(fields));
                assert.equal(output.status, "error");
                assert.ok(!JSON.stringify(output).includes(raw));
                assert.equal(c.rpc.mock.callCount(), 1);
            }
            assert.ok(!JSON.stringify(logger.mock.calls.map(c => c.arguments)).includes(raw));
        }
        finally {
            logger.mock.restore();
        } });
        it(`${name} rejects secret/identity extras in returned projection`, async () => { const logger = mock.method(console, "error", () => { }); try {
            for (const extra of ["token", "token_hash", "user_id"]) {
                const c = client({ data: [{ ...result, [extra]: raw }], error: null });
                const output = await operation(c.value, form(fields));
                assert.equal(output.status, "error");
                assert.ok(!JSON.stringify(output).includes(raw));
            }
        }
        finally {
            logger.mock.restore();
        } });
    }
    it("malformed preview returns uniform unavailable without RPC", async () => { const c = client({}); assert.deepEqual(await previewInvitation(c.value, "invalid"), { status: "success", data: invitationUnavailable }); assert.equal(c.rpc.mock.callCount(), 0); });
    it("preview passes raw token only in POST RPC arguments and enforces private shape", async () => { const active = { outcome: "active", community_name: "Name", community_description: "Description", expires_at: receipt.expires_at, already_member: false, community_slug: null }; const c = client({ data: [active], error: null }, null); assert.deepEqual(await previewInvitation(c.value, raw), { status: "success", data: active }); assert.deepEqual(c.rpc.mock.calls[0].arguments, ["get_community_invitation_preview", { p_token: raw }]); const logger = mock.method(console, "error", () => { }); try {
        for (const invalid of [{ ...active, community_slug: "private-tenant" }, { ...invitationUnavailable, community_name: "Leaked" }, { ...active, outcome: "accepted" }, { ...active, owner_id: id }])
            assert.equal((await previewInvitation(client({ data: [invalid], error: null }).value, raw)).status, "error");
    }
    finally {
        logger.mock.restore();
    } });
    it("accept/replay validates slug and never accepts arbitrary destinations", async () => { for (const row of [{ outcome: "accepted", community_slug: null }, { outcome: "already_member", community_slug: "invite-tenant" }, { outcome: "unavailable", community_slug: null }])
        assert.deepEqual(await acceptInvitation(client({ data: [row], error: null }).value, form({ token: raw })), { status: "success", data: row }); const logger = mock.method(console, "error", () => { }); try {
        for (const row of [{ outcome: "accepted", community_slug: "//evil.test" }, { outcome: "already_member", community_slug: null }, { outcome: "unavailable", community_slug: "private-tenant" }])
            assert.equal((await acceptInvitation(client({ data: [row], error: null }).value, form({ token: raw }))).status, "error");
    }
    finally {
        logger.mock.restore();
    } });
    it("bounded history preserves microsecond cursor and fixed RPC arguments", async () => { const c = client({ data: [history], error: null }); const input = { communityId: tenant, cursorCreatedAt: receipt.created_at, cursorId: id, limit: 20 }; assert.equal((await listInvitations(c.value, input)).status, "success"); assert.deepEqual(c.rpc.mock.calls[0].arguments, ["list_community_invitations", { p_community_id: tenant, p_before_created_at: receipt.created_at, p_before_id: id, p_limit: 20 }]); });
    for (const input of [{}, { communityId: tenant, limit: 51 }, { communityId: tenant, limit: 0 }, { communityId: tenant, cursorId: id }, { communityId: tenant, cursorCreatedAt: "infinity", cursorId: id }, { communityId: tenant, origin: "http://evil.test" }])
        it(`denies invalid pagination ${Object.keys(input).join(",")}`, () => { assert.equal(parseInvitationPage(input).status, "error"); });
    it("invalid receipts reject wrong duration and mismatched revoke target", async () => { const logger = mock.method(console, "error", () => { }); try {
        assert.equal((await createInvitation(client({ data: [{ ...receipt, expires_at: "2026-10-07T11:00:00Z" }], error: null }).value, form({ community_id: tenant }))).status, "error");
        assert.equal((await revokeInvitation(client({ data: [{ ...history, invitation_id: tenant }], error: null }).value, form({ community_id: tenant, invitation_id: id }))).status, "error");
    }
    finally {
        logger.mock.restore();
    } });
});
