// Opt-in real PostgreSQL tests. Requires an explicitly selected local disposable
// server and psql, no application driver or hosted credentials. Never targets a
// supplied hostname/database: creates and drops only its own random local DB.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
const psql = process.env.GROWUP_TEST_PSQL;
const port = process.env.GROWUP_TEST_PG_PORT;
const enabled = !!psql && !!port;
const database = `growup_invitations_${randomUUID().replaceAll("-", "")}`;
const owner = "11111111-1111-4111-8111-111111111111";
const applicant = "22222222-2222-4222-8222-222222222222";
const admin = "33333333-3333-4333-8333-333333333333";
const outsider = "44444444-4444-4444-8444-444444444444";
const extra = "66666666-6666-4666-8666-666666666666";
const community = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const request = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const otherRequest = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const invitation = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const token = "ab".repeat(32), secondToken = "cd".repeat(32);
const tokenHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
type Result = {
    code: string;
    output: string;
    errors: string;
};
class Session {
    process: ChildProcessWithoutNullStreams;
    sequence = 0;
    constructor(name: string, db = database) {
        assert.ok(psql && port && /^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535);
        this.process = spawn(psql, ["-X", "-q", "-A", "-t", "-w", "-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", db], {
            windowsHide: true, stdio: "pipe",
            env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("PG"))),
                NODE_ENV: process.env.NODE_ENV, PGAPPNAME: name, PGCONNECT_TIMEOUT: "5", PGCLIENTENCODING: "UTF8" },
        });
    }
    async query(sql: string): Promise<Result> {
        const marker = `__growup_end_${++this.sequence}__`;
        return new Promise((resolve, reject) => {
            let output = "", errors = "";
            const finish = () => {
                clearTimeout(timer);
                this.process.stdout.off("data", onData);
                this.process.stderr.off("data", onErrorData);
                this.process.off("error", onError);
                this.process.off("exit", onExit);
            };
            const onError = (error: Error) => { finish(); reject(error); };
            const onExit = () => onError(new Error(`psql exited: ${errors}`));
            const onErrorData = (chunk: Buffer) => { errors += chunk.toString(); };
            const onData = (chunk: Buffer) => {
                output += chunk.toString();
                const match = new RegExp(`${marker} ([A-Z0-9]{5})\\r?\\n`).exec(output);
                if (match) {
                    finish();
                    resolve({ code: match[1], output: output.slice(0, match.index).trim(), errors });
                }
            };
            const timer = setTimeout(() => { onError(new Error(`psql timed out: ${errors}`)); this.process.kill(); }, 15000);
            this.process.stdout.on("data", onData);
            this.process.stderr.on("data", onErrorData);
            this.process.on("error", onError);
            this.process.on("exit", onExit);
            this.process.stdin.write(`${sql};\n\\echo ${marker} :SQLSTATE\n`);
        });
    }
    async ok(sql: string) {
        const result = await this.query(sql);
        assert.equal(result.code, "00000", result.errors || result.output);
        return result.output;
    }
    async close() {
        if (this.process.exitCode !== null)
            return;
        await new Promise<void>((resolve) => { this.process.once("exit", () => resolve()); this.process.stdin.end("\\q\n"); });
    }
}
describe("invitations with independent PostgreSQL sessions", { skip: !enabled, concurrency: false }, () => {
    let maintenance: Session, observer: Session, a: Session, b: Session;
    let databaseCreated = false;
    let otherBefore: string;
    before(async () => {
        maintenance = new Session("growup_invitations_maintenance", "postgres");
        await maintenance.ok(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    end $$`);
        await maintenance.ok(`create database ${database}`);
        databaseCreated = true;
        observer = new Session("growup_invitations_observer");
        a = new Session("growup_invitations_a");
        b = new Session("growup_invitations_b");
        await observer.ok(`create schema extensions; create extension pgcrypto with schema extensions;
      create schema auth; create table auth.users(id uuid primary key,email_confirmed_at timestamptz,banned_until timestamptz,
        raw_user_meta_data jsonb default '{}',is_anonymous boolean default false,deleted_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
      alter default privileges in schema public grant all on tables to public,anon,authenticated;
      alter default privileges in schema public grant execute on functions to public,anon,authenticated`);
        const directory = new URL("../supabase/migrations/", import.meta.url);
        for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort())
            await observer.ok(`\\set ON_ERROR_STOP on\n${await readFile(new URL(file, directory), "utf8")}`);
        await observer.ok("\\set ON_ERROR_STOP off\nselect 1");
        for (const session of [a, b])
            await session.ok("set lock_timeout='8s'; set statement_timeout='10s'");
    });
    after(async () => { await Promise.all([a?.close(), b?.close(), observer?.close()]); if (databaseCreated)
        await maintenance.ok(`drop database ${database}`); await maintenance?.close(); });
    beforeEach(async () => {
        await observer.ok(`truncate public.community_invitations,public.community_membership_requests,public.community_memberships,public.communities,public.private_profiles,auth.users;
      insert into auth.users(id,email_confirmed_at) values ('${owner}',now()),('${applicant}',now()),('${admin}',now()),('${outsider}',now()),('${extra}',now());
      begin;
      insert into public.communities(id,owner_user_id,name,slug,visibility,join_policy) values ('${community}','${owner}','Tenant','invite-race','public','approval_required'),('${other}','${outsider}','Other','other-race','unlisted','approval_required');
      insert into public.community_memberships(community_id,user_id,role) values ('${community}','${owner}','owner'),('${community}','${admin}','admin'),('${other}','${outsider}','owner');
      insert into public.community_membership_requests(id,community_id,requester_user_id,requester_display_name) values ('${request}','${community}','${applicant}','Shared'),('${otherRequest}','${other}','${extra}','Other');
      insert into public.community_invitations(id,community_id,token_hash,created_by_user_id,created_at,expires_at)
        select '${invitation}','${community}',decode('${tokenHash(token)}','hex'),'${admin}',t,t+interval '168 hours' from (select clock_timestamp() t) d;
      commit`);
        otherBefore = await otherSnapshot();
    });
    afterEach(async () => { await a.ok("rollback"); await b.ok("rollback"); });
    const accept = (value = token) => `select row_to_json(r) from public.accept_community_invitation('${value}') r`;
    const revoke = `select row_to_json(r) from public.revoke_community_invitation('${community}','${invitation}') r`;
    const create = `select row_to_json(r) from public.create_community_invitation('${community}','${tokenHash(secondToken)}') r`;
    const decision = (op: string) => `select row_to_json(r) from public.${op}_community_membership_request('${community}','${request}') r`;
    const memberLock = (actor: string) => `select 1 from auth.users where id='${actor}' for update; select 1 from public.communities where id='${community}' for share`;
    async function begin(session: Session, actor: string, privileged = false) { await session.ok(`begin; select set_config('request.jwt.claim.sub','${actor}',true)${privileged ? "" : "; set local role authenticated"}`); }
    async function otherSnapshot() { return observer.ok(`select json_build_object('c',(select row_to_json(c) from public.communities c where id='${other}'),'m',(select json_agg(m order by user_id) from public.community_memberships m where community_id='${other}'),'r',(select json_agg(r order by id) from public.community_membership_requests r where community_id='${other}'))`); }
    async function state() { return JSON.parse(await observer.ok(`select json_build_object('accepted',(select accepted_by_user_id from public.community_invitations where id='${invitation}'),'revoked',(select revoked_by_user_id from public.community_invitations where id='${invitation}'),'status',(select status from public.community_membership_requests where id='${request}'),'reason',(select cancellation_reason from public.community_membership_requests where id='${request}'),'role',(select role from public.community_memberships where community_id='${community}' and user_id='${applicant}'))`)) as {
        accepted: string | null;
        revoked: string | null;
        status: string | null;
        reason: string | null;
        role: string | null;
    }; }
    async function invariants() {
        assert.equal(await observer.ok(`select count(*) from (
      select id from public.community_invitations where accepted_at is not null and revoked_at is not null
      union all select c.id from public.communities c where (select count(*) from public.community_memberships m where m.community_id=c.id and m.role='owner')<>1
        or not exists(select 1 from public.community_memberships m where m.community_id=c.id and m.user_id=c.owner_user_id and m.role='owner')
      union all select community_id from public.community_memberships group by community_id,user_id having count(*)>1
      union all select community_id from public.community_membership_requests where status='pending' group by community_id,requester_user_id having count(*)>1
    ) violations`), "0");
        assert.equal(await otherSnapshot(), otherBefore);
    }
    async function blockedByA() { for (let i = 0; i < 400; i++) {
        if (await observer.ok(`select exists(select 1 from pg_stat_activity a,pg_stat_activity b where a.datname='${database}' and b.datname='${database}' and a.application_name='growup_invitations_a' and b.application_name='growup_invitations_b' and a.pid=any(pg_blocking_pids(b.pid)))`) === "t")
            return;
        await delay(10);
    } assert.fail("Expected observed PostgreSQL blocker before commit"); }
    type Operation = {
        actor: string;
        sql: string;
        privileged?: boolean;
    };
    async function race(first: Operation, second: Operation, code = "00000") {
        await begin(a, first.actor, first.privileged);
        const firstResult = await a.ok(first.sql);
        await begin(b, second.actor, second.privileged);
        const pending = b.query(second.sql);
        await blockedByA();
        await a.ok("commit");
        const result = await pending;
        assert.equal(result.code, code, result.errors.replaceAll(token, "[redacted]").replaceAll(secondToken, "[redacted]"));
        await b.ok(code === "00000" ? "commit" : "rollback");
        await invariants();
        return [firstResult, result.output];
    }
    it("real PostgreSQL pgcrypto matches Node; hash cannot redeem", async () => { assert.equal(await observer.ok(`select encode(extensions.digest('${token}','sha256'),'hex')`), tokenHash(token)); await begin(a, applicant); assert.equal(JSON.parse(await a.ok(accept(tokenHash(token)))).outcome, "unavailable"); await a.ok("commit"); });
    for (const reverse of [false, true])
        it(`different accounts double acceptance (${reverse ? "outsider" : "applicant"} first) has exactly one new admission`, async () => {
            const actors = reverse ? [outsider, applicant] : [applicant, outsider];
            const results = await race({ actor: actors[0], sql: accept() }, { actor: actors[1], sql: accept() });
            assert.equal(JSON.parse(results[0]).outcome, "accepted");
            assert.equal(JSON.parse(results[1]).outcome, "unavailable");
            const s = await state();
            assert.equal(s.accepted, actors[0]);
            assert.equal(s.status, reverse ? "pending" : "cancelled");
            assert.equal(await observer.ok(`select count(*) from public.community_memberships where community_id='${community}' and user_id in ('${applicant}','${outsider}')`), "1");
        });
    it("same-account double acceptance gives informational replay with no timestamp rewrite", async () => { const results = await race({ actor: applicant, sql: accept() }, { actor: applicant, sql: accept() }); assert.deepEqual(JSON.parse(results[0]), JSON.parse(results[1])); });
    it("two invites same account leaves second unused", async () => { await begin(a, owner); await a.ok(create); await a.ok("commit"); const results = await race({ actor: applicant, sql: accept() }, { actor: applicant, sql: accept(secondToken) }); assert.equal(JSON.parse(results[1]).outcome, "already_member"); assert.equal(await observer.ok(`select count(*) from public.community_invitations where accepted_at is not null`), "1"); });
    for (const reverse of [false, true])
        it(`accept/revoke (${reverse ? "revoke" : "accept"} first) serializes terminal winner`, async () => {
            const pair = [{ actor: applicant, sql: accept() }, { actor: admin, sql: revoke }];
            if (reverse)
                pair.reverse();
            const results = await race(pair[0], pair[1]);
            const s = await state();
            assert.equal(s.accepted, reverse ? null : applicant);
            assert.equal(s.revoked, reverse ? admin : null);
            assert.equal(JSON.parse(results[1])[reverse ? "outcome" : "status"], reverse ? "unavailable" : "accepted");
        });
    for (const reverse of [false, true])
        it(`two managers revoke (${reverse ? "owner" : "admin"} first) preserves first audit`, async () => { const actors = reverse ? [owner, admin] : [admin, owner]; const results = await race({ actor: actors[0], sql: revoke }, { actor: actors[1], sql: revoke }); assert.deepEqual(JSON.parse(results[0]), JSON.parse(results[1])); assert.equal((await state()).revoked, actors[0]); });
    it("accept expiry after observed invitation lock wait denies despite earlier transaction start", async () => {
        await observer.ok(`delete from public.community_invitations; insert into public.community_invitations(id,community_id,token_hash,created_by_user_id,created_at,expires_at) select '${invitation}','${community}',decode('${tokenHash(token)}','hex'),'${owner}',t-interval '168 hours',t from (select clock_timestamp()+interval '800 milliseconds' t) d`);
        await begin(a, owner, true);
        await a.ok(`select 1 from public.community_invitations where id='${invitation}' for update`);
        await begin(b, applicant);
        const pending = b.query(accept());
        await blockedByA();
        while (await observer.ok(`select clock_timestamp() >= expires_at from public.community_invitations where id='${invitation}'`) !== "t")
            await delay(20);
        await a.ok("commit");
        assert.equal(JSON.parse((await pending).output).outcome, "unavailable");
        await b.ok("commit");
        const s = await state();
        assert.equal(s.role, null);
        assert.equal(s.status, "pending");
        await invariants();
    });
    for (const reverse of [false, true])
        it(`instant join/accept (${reverse ? "join" : "invite"} first) preserves membership and consumption rule`, async () => {
            await observer.ok(`update public.communities set join_policy='instant' where id='${community}'`);
            const pair = [{ actor: applicant, sql: accept() }, { actor: applicant, sql: `select public.join_community('${community}')` }];
            if (reverse)
                pair.reverse();
            const results = await race(pair[0], pair[1]);
            assert.equal((await state()).role, "member");
            assert.equal((await state()).accepted, reverse ? null : applicant);
            if (reverse)
                assert.equal(JSON.parse(results[1]).outcome, "already_member");
        });
    for (const operation of ["approve", "reject", "withdraw"])
        for (const reverse of [false, true])
            it(`${operation}/accept (${reverse ? operation : "invite"} first) preserves terminal request history`, async () => {
                const pair = [{ actor: applicant, sql: accept() }, { actor: operation === "withdraw" ? applicant : admin, sql: decision(operation) }];
                if (reverse)
                    pair.reverse();
                await race(pair[0], pair[1]);
                const s = await state();
                assert.equal(s.role, "member");
                assert.equal(s.status, reverse ? operation === "approve" ? "approved" : operation === "reject" ? "rejected" : "withdrawn" : "cancelled");
                assert.equal(s.accepted, reverse && operation === "approve" ? null : applicant);
            });
    for (const reverse of [false, true])
        it(`membership creation/accept (${reverse ? "fixture" : "invite"} first) never replaces a current role`, async () => {
            const pair = [{ actor: applicant, sql: accept() }, { actor: applicant, privileged: true, sql: `${memberLock(applicant)}; insert into public.community_memberships(community_id,user_id,role) values ('${community}','${applicant}','moderator') on conflict do nothing` }];
            if (reverse)
                pair.reverse();
            await race(pair[0], pair[1]);
            assert.equal((await state()).role, reverse ? "moderator" : "member");
            assert.equal((await state()).accepted, reverse ? null : applicant);
        });
    for (const reverse of [false, true])
        it(`role change/accept (${reverse ? "role" : "invite"} first) preserves existing membership`, async () => {
            await observer.ok(`insert into public.community_memberships(community_id,user_id,role) values ('${community}','${applicant}','admin')`);
            const pair = [{ actor: applicant, sql: accept() }, { actor: applicant, privileged: true, sql: `${memberLock(applicant)}; update public.community_memberships set role='moderator' where community_id='${community}' and user_id='${applicant}'` }];
            if (reverse)
                pair.reverse();
            await race(pair[0], pair[1]);
            assert.equal((await state()).role, "moderator");
            assert.equal((await state()).accepted, null);
        });
    for (const reverse of [false, true])
        it(`leave/accept (${reverse ? "leave" : "invite"} first) uses current membership without historical role restoration`, async () => {
            await observer.ok(`insert into public.community_memberships(community_id,user_id,role) values ('${community}','${applicant}','admin')`);
            const pair = [{ actor: applicant, sql: accept() }, { actor: applicant, sql: `select public.leave_community('${community}')` }];
            if (reverse)
                pair.reverse();
            await race(pair[0], pair[1]);
            assert.equal((await state()).role, reverse ? "member" : null);
            assert.equal((await state()).accepted, reverse ? applicant : null);
        });
    for (const operation of ["create", "revoke"])
        for (const reverse of [false, true])
            it(`creator demotion/${operation} (${reverse ? "demotion" : operation} first) checks execution-time authority`, async () => {
                const pair = [{ actor: admin, sql: operation === "create" ? create : revoke }, { actor: admin, privileged: true, sql: `${memberLock(admin)}; update public.community_memberships set role='member' where community_id='${community}' and user_id='${admin}'` }];
                if (reverse)
                    pair.reverse();
                await race(pair[0], pair[1], reverse ? "42501" : "00000");
                assert.equal(await observer.ok(`select count(*) from public.community_invitations`), operation === "create" && !reverse ? "2" : "1");
                if (operation === "create" && !reverse) {
                    await begin(a, applicant);
                    assert.equal(JSON.parse(await a.ok(accept(secondToken))).outcome, "accepted");
                    await a.ok("commit");
                }
            });
    for (const reverse of [false, true])
        it(`settings/accept (${reverse ? "settings" : "invite"} first) preserves active grants and terminal cancellation`, async () => {
            const pair = [{ actor: applicant, sql: accept() }, { actor: owner, sql: `select public.update_community_settings('${community}','{"name":"Private","visibility":"private","join_policy":"invitation_only"}')` }];
            if (reverse)
                pair.reverse();
            await race(pair[0], pair[1]);
            assert.equal((await state()).accepted, applicant);
            assert.equal((await state()).reason, reverse ? "policy_changed" : "already_member");
        });
    for (const kind of ["ban", "soft-delete", "hard-delete"])
        for (const reverse of [false, true])
            it(`account ${kind}/accept (${reverse ? "account" : "invite"} first) never reopens consumed history`, async () => {
                const sql = kind === "hard-delete" ? `delete from auth.users where id='${applicant}'` : `update auth.users set ${kind === "ban" ? "banned_until=now()+interval '1 day'" : "deleted_at=now()"} where id='${applicant}'`;
                const pair = [{ actor: applicant, sql: accept() }, { actor: applicant, privileged: true, sql }];
                if (reverse)
                    pair.reverse();
                await race(pair[0], pair[1], reverse ? "42501" : "00000");
                assert.equal((await state()).accepted, reverse ? null : applicant);
                if (kind === "hard-delete")
                    assert.equal((await state()).role, null);
            });
    for (const reverse of [false, true])
        it(`successful cleanup/accept (${reverse ? "deletion" : "invite"} first) uses ACCOUNT-FIRST community deletion fixture`, async () => {
            const cleanup = `select 1 from auth.users where id in ('${owner}','${applicant}','${admin}') order by id for update;
      select 1 from public.communities where id='${community}' for update;
      delete from public.community_membership_requests where community_id='${community}';
      delete from public.community_memberships where community_id='${community}'; delete from public.communities where id='${community}'`;
            const pair = [{ actor: applicant, sql: accept() }, { actor: owner, privileged: true, sql: cleanup }];
            if (reverse)
                pair.reverse();
            const results = await race(pair[0], pair[1]);
            if (reverse)
                assert.equal(JSON.parse(results[1]).outcome, "unavailable");
            assert.equal(await observer.ok(`select count(*) from public.community_invitations where community_id='${community}'`), "0");
        });
    it("restricted deletion rolls back and waiting admission succeeds", async () => {
        await begin(a, owner, true);
        await a.ok(`select 1 from auth.users where id in ('${owner}','${applicant}') order by id for update; select 1 from public.communities where id='${community}' for update`);
        await begin(b, applicant);
        const pending = b.query(accept());
        await blockedByA();
        assert.equal((await a.query(`delete from public.communities where id='${community}'`)).code, "23503");
        await a.ok("rollback");
        assert.equal(JSON.parse((await pending).output).outcome, "accepted");
        await b.ok("commit");
        await invariants();
    });
    it("unrelated tenant/account progresses without a global lock", async () => {
        await begin(a, applicant);
        await a.ok(accept());
        await begin(b, outsider);
        assert.ok(await b.ok(`select row_to_json(r) from public.create_community_invitation('${other}','${tokenHash(secondToken)}') r`));
        await b.ok("commit");
        await a.ok("commit");
        await invariants();
    });
});
