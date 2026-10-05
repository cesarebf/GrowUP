import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
const owner = "11111111-1111-4111-8111-111111111111", applicant = "22222222-2222-4222-8222-222222222222";
const admin = "33333333-3333-4333-8333-333333333333", outsider = "44444444-4444-4444-8444-444444444444";
const moderator = "55555555-5555-4555-8555-555555555555", missing = "99999999-9999-4999-8999-999999999999";
const raw = "ab".repeat(32), hash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
const createSql = "select * from public.create_community_invitation($1,$2)", acceptSql = "select * from public.accept_community_invitation($1)";
const previewSql = "select * from public.get_community_invitation_preview($1)", revokeSql = "select * from public.revoke_community_invitation($1,$2)";
const unavailable = { outcome: "unavailable", community_name: null, community_description: null, expires_at: null, already_member: null, community_slug: null };
let db: PGlite, community: string, other: string;
type Receipt = {
    invitation_id: string;
    created_at: Date;
    expires_at: Date;
};
describe("invitation database state machine, cryptography and privacy", { concurrency: false }, () => {
    before(async () => {
        db = new PGlite({ extensions: { pgcrypto } });
        await db.exec(`create schema extensions; create extension pgcrypto with schema extensions;
      create role anon nologin; create role authenticated nologin; create schema auth;
      create table auth.users(id uuid primary key,email_confirmed_at timestamptz,banned_until timestamptz,
        raw_user_meta_data jsonb default '{}',is_anonymous boolean default false,deleted_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
      alter default privileges in schema public grant all on tables to public,anon,authenticated;
      alter default privileges in schema public grant execute on functions to public,anon,authenticated`);
        const directory = new URL("../supabase/migrations/", import.meta.url);
        for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort())
            await db.exec(await readFile(new URL(file, directory), "utf8"));
        for (const id of [owner, applicant, admin, outsider, moderator])
            await db.query<Record<string, unknown>>("insert into auth.users(id,email_confirmed_at) values ($1,now())", [id]);
    });
    after(async () => { await db?.close(); });
    beforeEach(async () => {
        await db.exec("begin");
        await asUser(owner);
        community = (await db.query<{
            id: string;
        }>("select public.create_community('Private tenant','invite-tenant','Bounded description','private','invitation_only') id")).rows[0].id;
        await asUser(outsider);
        other = (await db.query<{
            id: string;
        }>("select public.create_community('Other tenant','other-tenant','','public','approval_required') id")).rows[0].id;
        await member(admin, "admin");
        await member(moderator, "moderator");
        await db.exec("set constraints all immediate; set constraints all deferred");
    });
    afterEach(async () => { await db.exec("rollback"); });
    async function asUser(id: string | null, role = "authenticated") {
        await db.exec("reset role");
        await db.query<Record<string, unknown>>("select set_config('request.jwt.claim.sub',$1,true)", [id ?? ""]);
        await db.exec(`set local role ${role}`);
    }
    async function denied(sql: string, params: unknown[] = [], code = "42501") {
        await db.exec("savepoint denied");
        try {
            await assert.rejects(db.query<Record<string, unknown>>(sql, params), (error: unknown) => {
                const e = error as {
                    code: string;
                    message: string;
                    detail?: string;
                };
                assert.equal(e.code, code);
                assert.ok(!JSON.stringify({ message: e.message, detail: e.detail }).includes(raw));
                return true;
            });
        }
        finally {
            await db.exec("rollback to savepoint denied; release savepoint denied");
        }
    }
    async function create(actor = owner, token = raw, tenant = community) { await asUser(actor); return (await db.query<Receipt>(createSql, [tenant, hash(token)])).rows[0]; }
    async function accept(actor = applicant, token = raw) { await asUser(actor); return (await db.query<Record<string, unknown>>(acceptSql, [token])).rows[0]; }
    async function preview(actor: string | null = null, token = raw) { await asUser(actor, actor ? "authenticated" : "anon"); return (await db.query<Record<string, unknown>>(previewSql, [token])).rows[0]; }
    async function member(actor: string, role = "member", tenant = community) { await db.exec("reset role"); await db.query<Record<string, unknown>>("insert into public.community_memberships(community_id,user_id,role) values ($1,$2,$3)", [tenant, actor, role]); }
    async function snapshot(table: string) { await db.exec("reset role"); return (await db.query<Record<string, unknown>>(`select * from public.${table} order by 1`)).rows; }
    async function inviteFixture(delta: string) {
        await db.exec("reset role");
        return (await db.query<{
            id: string;
        }>(`insert into public.community_invitations(community_id,token_hash,created_by_user_id,created_at,expires_at)
      select $1,decode($2,'hex'),$3,t-interval '168 hours',t from (select clock_timestamp()+$4::interval t) d returning id`, [community, hash(raw), owner, delta])).rows[0].id;
    }
    async function settings(visibility: string, policy: string) { await asUser(owner); await db.query<Record<string, unknown>>("select public.update_community_settings($1,$2::jsonb)", [community, JSON.stringify({ name: "Private tenant", description: "Bounded description", visibility, join_policy: policy })]); }
    async function pending() { await settings("public", "approval_required"); await asUser(applicant); return (await db.query<{
        request_id: string;
    }>("select * from public.request_community_membership($1,'Shared name')", [community])).rows[0].request_id; }
    for (const actor of [owner, admin])
        it(`${actor === owner ? "owner" : "admin"} creates hash-only invitations with exactly 168 elapsed hours`, async () => {
            const receipt = await create(actor);
            assert.equal(receipt.expires_at.getTime() - receipt.created_at.getTime(), 168 * 3600000);
            const rows = await snapshot("community_invitations");
            assert.equal(rows.length, 1);
            assert.equal(rows[0].created_by_user_id, actor);
            assert.equal(Buffer.from(rows[0].token_hash as Uint8Array).toString("hex"), hash(raw));
            assert.ok(!JSON.stringify(rows).includes(raw));
            assert.equal(Object.keys(rows[0]).length, 10);
        });
    it("Node UTF-8 SHA-256 agrees with real pgcrypto for independent known vectors", async () => {
        await db.exec("reset role");
        for (const token of [raw, "0".repeat(64), "1234567890abcdef".repeat(4)])
            assert.equal((await db.query<{
                hash: string;
            }>("select encode(extensions.digest($1,'sha256'),'hex') hash", [token])).rows[0].hash, hash(token));
    });
    it("DST regression: 168 hours crosses spring and fall at a different local hour; seven calendar days violates the constraint", async () => {
        await db.exec("reset role; set local timezone='America/New_York'");
        for (const start of ["2026-03-07 12:00:00-05", "2026-10-31 12:00:00-04"]) {
            const row = (await db.query<{
                elapsed: number;
                calendar: number;
            }>("select extract(epoch from (($1::timestamptz+interval '168 hours')-$1::timestamptz))/3600 elapsed, extract(epoch from (($1::timestamptz+interval '7 days')-$1::timestamptz))/3600 calendar", [start])).rows[0];
            assert.equal(Number(row.elapsed), 168);
            assert.notEqual(Number(row.calendar), 168);
            await denied("insert into public.community_invitations(community_id,token_hash,created_by_user_id,created_at,expires_at) values ($1,decode($2,'hex'),$3,$4::timestamptz,$4::timestamptz+interval '7 days')", [community, hash(raw), owner, start], "23514");
        }
    });
    it("globally unique digest rejects duplicates without modifying another tenant", async () => {
        await create();
        const before = await snapshot("community_invitations");
        await asUser(outsider);
        await denied(createSql, [other, hash(raw)], "23505");
        assert.deepEqual(await snapshot("community_invitations"), before);
    });
    it("independently random hashes create distinct invitations", async () => {
        const receipts = [];
        for (let i = 0; i < 8; i++)
            receipts.push(await create(owner, randomBytes(32).toString("hex")));
        assert.equal(new Set(receipts.map((r) => r.invitation_id)).size, 8);
    });
    for (const actor of [moderator, applicant, outsider, null, missing])
        it(`denies management for ${actor ?? "anonymous"}`, async () => {
            const invite = await create();
            await asUser(actor, actor ? "authenticated" : "anon");
            await denied(createSql, [community, hash("cd".repeat(32))]);
            await denied("select * from public.list_community_invitations($1)", [community]);
            await denied(revokeSql, [community, invite.invitation_id]);
        });
    it("denies ordinary member management", async () => { const invite = await create(); await member(applicant); await asUser(applicant); await denied(createSql, [community, hash(raw)]); await denied(revokeSql, [community, invite.invitation_id]); await denied("select * from public.list_community_invitations($1)", [community]); });
    for (const change of ["email_confirmed_at=null", "is_anonymous=true", "deleted_at=now()", "banned_until=now()+interval '1 day'"])
        it(`rechecks current eligibility for all authenticated surfaces: ${change}`, async () => {
            const invite = await create();
            await db.exec("reset role");
            await db.query<Record<string, unknown>>(`update auth.users set ${change} where id=$1`, [admin]);
            await asUser(admin);
            await denied(createSql, [community, hash(raw)]);
            await denied(revokeSql, [community, invite.invitation_id]);
            await denied("select * from public.list_community_invitations($1)", [community]);
            await denied(acceptSql, [raw]);
            assert.deepEqual((await db.query<Record<string, unknown>>(previewSql, [raw])).rows[0], unavailable);
        });
    it("private active capability exposes exactly limited metadata with no slug or identifiers", async () => {
        await create();
        const result = await preview();
        assert.deepEqual(Object.keys(result).sort(), Object.keys(unavailable).sort());
        assert.equal(result.outcome, "active");
        assert.equal(result.community_name, "Private tenant");
        assert.equal(result.community_slug, null);
        assert.equal(result.already_member, false);
        assert.equal((await preview(owner)).already_member, true);
        await asUser(applicant);
        assert.deepEqual((await db.query<Record<string, unknown>>("select * from public.get_community_landing('invite-tenant')")).rows, []);
    });
    for (const token of ["", "A".repeat(64), raw + "\n", " " + raw, "%61".repeat(64), "a".repeat(63)])
        it(`rejects malformed token of length ${token.length} without echo`, async () => {
            await asUser(applicant);
            await denied(previewSql, [token], "22023");
            await denied(acceptSql, [token], "22023");
        });
    for (const kind of ["invalid", "expired", "revoked", "other-accepter"])
        it(`${kind} has identical unavailable preview and no acceptance effects`, async () => {
            if (kind === "expired")
                await inviteFixture("0 seconds");
            else {
                const invite = await create();
                if (kind === "revoked") {
                    await asUser(owner);
                    await db.query<Record<string, unknown>>(revokeSql, [community, invite.invitation_id]);
                }
                if (kind === "other-accepter")
                    await accept(outsider);
            }
            const token = kind === "invalid" ? "cd".repeat(32) : raw;
            const before = await snapshot("community_memberships");
            assert.deepEqual(await preview(applicant, token), unavailable);
            assert.deepEqual(await accept(applicant, token), { outcome: "unavailable", community_slug: null });
            assert.deepEqual(await snapshot("community_memberships"), before);
        });
    it("hash is never a redeemable credential", async () => { await create(); assert.deepEqual(await preview(null, hash(raw)), unavailable); assert.deepEqual(await accept(applicant, hash(raw)), { outcome: "unavailable", community_slug: null }); });
    for (const offset of ["-1 microsecond", "0 microseconds", "1 microsecond"])
        it(`exact expiration boundary with isolated database clock: decision ${offset}`, async () => {
            // Transaction-local clock/schema injection in this disposable database
            // only; rollback restores the production empty search_path after the test.
            await db.exec("reset role");
            await db.query("select set_config('growup.test_clock', '2026-10-07T12:00:00Z', true)");
            await db.exec(`create schema invitation_test_clock;
      create function invitation_test_clock.clock_timestamp() returns timestamptz language sql volatile as $$
      select current_setting('growup.test_clock')::timestamptz
      $$;
      alter function public.accept_community_invitation(text) set search_path = invitation_test_clock, pg_catalog`);
            await db.query("insert into public.community_invitations(community_id,token_hash,created_by_user_id,created_at,expires_at) values ($1,decode($2,'hex'),$3,'2026-09-30T12:00:00Z','2026-10-07T12:00:00Z')", [community, hash(raw), owner]);
            await db.query("select set_config('growup.test_clock', (timestamptz '2026-10-07T12:00:00Z'+$1::interval)::text, true)", [offset]);
            const result = await accept();
            assert.equal(result.outcome, offset === "-1 microsecond" ? "accepted" : "unavailable");
            assert.equal((await snapshot("community_invitations"))[0].accepted_at !== null, offset === "-1 microsecond");
        });
    for (const actor of [owner, admin])
        it(`${actor === owner ? "owner" : "admin"} revocation is terminal and idempotent with original audit`, async () => {
            const invite = await create(actor === owner ? admin : owner);
            await asUser(actor);
            const first = (await db.query<Record<string, unknown>>(revokeSql, [community, invite.invitation_id])).rows[0];
            const before = await snapshot("community_invitations");
            await asUser(actor === owner ? admin : owner);
            assert.deepEqual((await db.query<Record<string, unknown>>(revokeSql, [community, invite.invitation_id])).rows[0], first);
            assert.deepEqual(await snapshot("community_invitations"), before);
        });
    for (const kind of ["accepted", "expired"])
        it(`revocation reports ${kind} without rewriting history`, async () => {
            const id = kind === "expired" ? await inviteFixture("-1 second") : (await create()).invitation_id;
            if (kind === "accepted")
                await accept();
            const before = await snapshot("community_invitations");
            await asUser(owner);
            assert.equal((await db.query<Record<string, unknown>>(revokeSql, [community, id])).rows[0].status, kind);
            assert.deepEqual(await snapshot("community_invitations"), before);
        });
    it("wrong-tenant targeting denies even to both tenants' manager", async () => {
        const invite = await create();
        await member(owner, "admin", other);
        await asUser(owner);
        await denied(revokeSql, [other, invite.invitation_id]);
    });
    it("anonymous or deleted stale JWT cannot accept", async () => { await create(); await asUser(null, "anon"); await denied(acceptSql, [raw]); await db.exec("reset role"); await db.query<Record<string, unknown>>("delete from auth.users where id=$1", [applicant]); await asUser(applicant); await denied(acceptSql, [raw]); });
    for (const visibility of ["public", "unlisted", "private"])
        for (const policy of ["instant", "approval_required", "invitation_only"])
            it(`explicit invitation bypasses unsolicited ${visibility}/${policy} policy`, async () => {
                await create();
                await settings(visibility, policy);
                assert.deepEqual(await accept(), { outcome: "accepted", community_slug: "invite-tenant" });
                const members = await snapshot("community_memberships");
                assert.equal(members.find((m) => m.user_id === applicant)?.role, "member");
                const invite = (await snapshot("community_invitations"))[0];
                assert.equal(invite.accepted_by_user_id, applicant);
                assert.equal(invite.revoked_at, null);
            });
    for (const role of ["member", "moderator", "admin", "owner"])
        it(`existing ${role} keeps exact membership and leaves invitation active`, async () => {
            await create();
            const actor = role === "owner" ? owner : applicant;
            if (role !== "owner")
                await member(actor, role);
            const before = await snapshot("community_memberships"), invitations = await snapshot("community_invitations");
            assert.deepEqual(await accept(actor), { outcome: "already_member", community_slug: "invite-tenant" });
            assert.deepEqual(await snapshot("community_memberships"), before);
            assert.deepEqual(await snapshot("community_invitations"), invitations);
        });
    it("same-accepter replay is informational; leave never restores membership or private metadata", async () => {
        await create();
        await accept();
        const before = await snapshot("community_invitations");
        assert.equal((await preview(applicant)).community_slug, "invite-tenant");
        assert.deepEqual(await accept(), { outcome: "accepted", community_slug: "invite-tenant" });
        await db.query<Record<string, unknown>>("select public.leave_community($1)", [community]);
        assert.deepEqual(await preview(applicant), { ...unavailable, outcome: "accepted" });
        assert.deepEqual(await accept(), { outcome: "accepted", community_slug: null });
        assert.deepEqual(await snapshot("community_invitations"), before);
        assert.ok(!(await snapshot("community_memberships")).some((m) => m.user_id === applicant));
    });
    it("pending request is cancelled atomically with preserved name/history and NULL reviewer", async () => {
        const id = await pending();
        await create();
        await accept();
        const row = (await snapshot("community_membership_requests"))[0];
        assert.equal(row.id, id);
        assert.equal(row.status, "cancelled");
        assert.equal(row.cancellation_reason, "already_member");
        assert.equal(row.resolved_by_user_id, null);
        assert.equal(row.requester_display_name, "Shared name");
        await asUser(owner);
        assert.equal((await db.query<Record<string, unknown>>("select * from public.approve_community_membership_request($1,$2)", [community, id])).rows[0].outcome, "already_resolved");
    });
    it("anomalous existing member cancels pending request while invite stays unused", async () => { await pending(); await create(); await member(applicant, "moderator"); assert.equal((await accept()).outcome, "already_member"); assert.equal((await snapshot("community_invitations"))[0].accepted_at, null); assert.equal((await snapshot("community_membership_requests"))[0].cancellation_reason, "already_member"); });
    for (const resolution of ["reject", "withdraw", "policy", "approve"])
        it(`${resolution} request history stays unchanged during invitation acceptance`, async () => {
            const id = await pending();
            await create();
            if (resolution === "policy")
                await settings("private", "invitation_only");
            else {
                await asUser(resolution === "withdraw" ? applicant : owner);
                await db.query<Record<string, unknown>>(`select * from public.${resolution}_community_membership_request($1,$2)`, [community, id]);
            }
            const before = await snapshot("community_membership_requests");
            await accept();
            assert.deepEqual(await snapshot("community_membership_requests"), before);
        });
    for (const kind of ["invalid", "expired", "revoked"])
        it(`${kind} cannot cancel pending requests`, async () => {
            await pending();
            if (kind === "expired")
                await inviteFixture("-1 second");
            else {
                const invite = await create();
                if (kind === "revoked") {
                    await asUser(owner);
                    await db.query<Record<string, unknown>>(revokeSql, [community, invite.invitation_id]);
                }
            }
            const before = await snapshot("community_membership_requests");
            await accept(applicant, kind === "invalid" ? "cd".repeat(32) : raw);
            assert.deepEqual(await snapshot("community_membership_requests"), before);
        });
    for (const kind of ["demote", "leave", "ban", "soft-delete", "hard-delete"])
        it(`creator ${kind} does not invalidate community-owned invitation`, async () => {
            await create(admin);
            await db.exec("reset role");
            if (kind === "demote")
                await db.query<Record<string, unknown>>("update public.community_memberships set role='member' where community_id=$1 and user_id=$2", [community, admin]);
            if (kind === "leave") {
                await asUser(admin);
                await db.query<Record<string, unknown>>("select public.leave_community($1)", [community]);
            }
            if (kind === "ban")
                await db.query<Record<string, unknown>>("update auth.users set banned_until=now()+interval '1 day' where id=$1", [admin]);
            if (kind === "soft-delete")
                await db.query<Record<string, unknown>>("update auth.users set deleted_at=now() where id=$1", [admin]);
            if (kind === "hard-delete")
                await db.query<Record<string, unknown>>("delete from auth.users where id=$1", [admin]);
            assert.equal((await accept()).outcome, "accepted");
            assert.equal((await snapshot("community_invitations"))[0].created_by_user_id, admin);
        });
    it("hard accepter deletion preserves consumed historical UUID without Auth FK", async () => { await create(); await accept(); const before = await snapshot("community_invitations"); await db.query<Record<string, unknown>>("delete from auth.users where id=$1", [applicant]); assert.deepEqual(await snapshot("community_invitations"), before); await asUser(applicant); await denied(acceptSql, [raw]); });
    for (const role of ["anon", "authenticated"])
        for (const operation of ["select *", "select token_hash", "insert", "update", "delete", "truncate"])
            it(`${role} direct ${operation} denied`, async () => {
                await create();
                await asUser(applicant, role);
                const table = "public.community_invitations";
                const sql = operation.startsWith("select") ? `${operation} from ${table}` : operation === "insert" ? `insert into ${table} default values` : operation === "update" ? `update ${table} set accepted_at=now()` : operation === "delete" ? `delete from ${table}` : `truncate ${table}`;
                await denied(sql);
            });
    it("catalog confirms FORCE RLS, zero policies/ordinary column ACLs, narrow EXECUTE and empty search paths", async () => {
        await db.exec("reset role");
        assert.deepEqual((await db.query<Record<string, unknown>>("select relrowsecurity,relforcerowsecurity from pg_class where oid='public.community_invitations'::regclass")).rows[0], { relrowsecurity: true, relforcerowsecurity: true });
        assert.equal((await db.query<{
            count: number;
        }>("select count(*)::int count from pg_policy where polrelid='public.community_invitations'::regclass")).rows[0].count, 0);
        for (const role of ["anon", "authenticated"]) {
            assert.equal((await db.query<{
                allowed: boolean;
            }>("select has_any_column_privilege($1,'public.community_invitations','SELECT,INSERT,UPDATE,REFERENCES') allowed", [role])).rows[0].allowed, false);
            await asUser(applicant, role);
            await denied("select public.authorize_community_invitation_manager($1)", [community]);
            await denied("select public.guard_community_invitation()");
        }
        await db.exec("reset role");
        const functions = (await db.query<{
            proname: string;
            proconfig: string[];
            prosecdef: boolean;
        }>("select proname,proconfig,prosecdef from pg_proc where pronamespace='public'::regnamespace and proname like '%invitation%'")).rows;
        assert.equal(functions.length, 7);
        assert.ok(functions.every((f) => f.proconfig.includes('search_path=""')));
        assert.ok(functions.filter((f) => f.proname !== "guard_community_invitation").every((f) => f.prosecdef));
        const fks = (await db.query<{
            target: string;
            delete_action: string;
        }>("select confrelid::regclass::text target,confdeltype delete_action from pg_constraint where conrelid='public.community_invitations'::regclass and contype='f'")).rows;
        assert.deepEqual(fks, [{ target: "communities", delete_action: "c" }]);
    });
    it("strict RPC signatures cannot take caller identity, role, community on accept, expiry or raw creation token fields", async () => {
        await db.exec("reset role");
        const args = (await db.query<{
            proname: string;
            args: string;
        }>("select proname,pg_get_function_identity_arguments(oid) args from pg_proc where pronamespace='public'::regnamespace and proname in ('accept_community_invitation','get_community_invitation_preview','create_community_invitation') order by proname")).rows;
        assert.deepEqual(args, [{ proname: "accept_community_invitation", args: "p_token text" }, { proname: "create_community_invitation", args: "p_community_id uuid, p_token_hash text" }, { proname: "get_community_invitation_preview", args: "p_token text" }]);
    });
    for (const change of ["id=gen_random_uuid()", "community_id=gen_random_uuid()", "token_hash=decode(repeat('00',32),'hex')", "created_by_user_id=gen_random_uuid()", "created_at=created_at-interval '1 hour'", "expires_at=expires_at+interval '1 hour'", "accepted_at=null"])
        it(`immutable invitation fields reject ${change}`, async () => { await create(); await db.exec("reset role"); await denied(`update public.community_invitations set ${change}`, [], "23514"); });
    it("resolution pair constraints reject NULL actors and accepted/revoked contradiction", async () => {
        await create();
        await db.exec("reset role");
        for (const change of ["accepted_at=clock_timestamp()", "accepted_by_user_id=gen_random_uuid(),revoked_at=clock_timestamp()", "accepted_at=clock_timestamp(),accepted_by_user_id=gen_random_uuid(),revoked_at=clock_timestamp(),revoked_by_user_id=gen_random_uuid()"])
            await denied(`update public.community_invitations set ${change}`, [], "23514");
    });
    for (const terminal of ["accept", "revoke"])
        it(`${terminal} terminal history cannot reset or rewrite`, async () => {
            const invite = await create();
            if (terminal === "accept")
                await accept();
            else {
                await asUser(owner);
                await db.query<Record<string, unknown>>(revokeSql, [community, invite.invitation_id]);
            }
            await db.exec("reset role");
            await denied("update public.community_invitations set accepted_at=null,accepted_by_user_id=null,revoked_at=null,revoked_by_user_id=null", [], "23514");
            await denied("update public.community_invitations set created_by_user_id=gen_random_uuid()", [], "23514");
        });
    for (const target of ["community_memberships", "community_membership_requests", "community_invitations"])
        it(`injected ${target} failure rolls back membership/request/invitation together`, async () => {
            await pending();
            await create();
            const before = await Promise.all([snapshot("community_memberships"), snapshot("community_membership_requests"), snapshot("community_invitations")]);
            await db.exec(`reset role; create function public.invitation_test_fail() returns trigger language plpgsql as $$ begin raise exception 'Injected failure' using errcode='23514'; end $$;
      create trigger invitation_test_failure before ${target === "community_memberships" ? "insert" : "update"} on public.${target} for each row execute function public.invitation_test_fail()`);
            await asUser(applicant);
            await denied(acceptSql, [raw], "23514");
            for (const [i, table] of ["community_memberships", "community_membership_requests", "community_invitations"].entries())
                assert.deepEqual(await snapshot(table), before[i]);
        });
    it("bounded keyset list has safe projections and rejects malformed cursors", async () => {
        for (let i = 0; i < 23; i++)
            await create(owner, randomBytes(32).toString("hex"));
        await asUser(owner);
        const page = (await db.query<{
            invitation_id: string;
            created_at: Date;
        }>("select * from public.list_community_invitations($1)", [community])).rows;
        assert.equal(page.length, 20);
        assert.equal(Object.keys(page[0]).length, 6);
        // Ask PostgreSQL for textual microseconds instead of JS Date rounding.
        await db.exec("reset role");
        const cursor = (await db.query<{
            t: string;
        }>("select created_at::text t from public.community_invitations where id=$1", [page.at(-1)!.invitation_id])).rows[0].t;
        await asUser(owner);
        const rest = (await db.query<Record<string, unknown>>("select * from public.list_community_invitations($1,$2,$3,20)", [community, cursor, page.at(-1)!.invitation_id])).rows;
        assert.equal(rest.length, 3);
        for (const params of [[community, null, null, 0], [community, null, null, 51], [community, null, missing, 20], [community, "infinity", missing, 20]])
            await denied("select * from public.list_community_invitations($1,$2,$3,$4)", params, "22023");
    });
    it("restricted deletion rolls back; account-first privileged cleanup cascades invitations only for target tenant", async () => {
        await create();
        await create(outsider, "cd".repeat(32), other);
        await db.exec("reset role");
        await denied("delete from public.communities where id=$1", [community], "23503");
        await db.query<Record<string, unknown>>("select 1 from auth.users order by id for update");
        await db.query<Record<string, unknown>>("select 1 from public.communities where id=$1 for update", [community]);
        await db.query<Record<string, unknown>>("delete from public.community_memberships where community_id=$1", [community]);
        await db.query<Record<string, unknown>>("delete from public.communities where id=$1", [community]);
        await db.exec("set constraints all immediate");
        const rows = await snapshot("community_invitations");
        assert.equal(rows.length, 1);
        assert.equal(rows[0].community_id, other);
    });
});
