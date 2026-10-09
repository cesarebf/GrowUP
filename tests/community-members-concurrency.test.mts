// Independent local PostgreSQL sessions only; never infer a server from application env.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
const psql = process.env.GROWUP_TEST_PSQL, port = process.env.GROWUP_TEST_PG_PORT;
const enabled = !!psql && !!port;
const database = `growup_members_${randomUUID().replaceAll("-", "")}`;
const owner = "11111111-1111-4111-8111-111111111111", admin = "22222222-2222-4222-8222-222222222222";
const target = "33333333-3333-4333-8333-333333333333", outsider = "44444444-4444-4444-8444-444444444444";
const extra = "55555555-5555-4555-8555-555555555555";
const community = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const targetId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", adminId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const requestId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", otherId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
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
describe("role management with independent PostgreSQL sessions", { skip: !enabled, concurrency: false }, () => {
  let maintenance: Session, observer: Session, a: Session, b: Session, c: Session;
  let created = false, otherBefore: string;
  before(async () => {
    maintenance = new Session("growup_members_maintenance", "postgres");
    await maintenance.ok(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    end $$`);
    await maintenance.ok(`create database ${database}`); created = true;
    observer = new Session("growup_members_observer"); a = new Session("growup_members_a"); b = new Session("growup_members_b"); c = new Session("growup_members_c");
    await observer.ok(`create schema extensions; create extension pgcrypto with schema extensions;
      create schema auth; create table auth.users(id uuid primary key,email_confirmed_at timestamptz,banned_until timestamptz,
        raw_user_meta_data jsonb default '{}',is_anonymous boolean default false,deleted_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
      alter default privileges in schema public grant all on tables to public,anon,authenticated;
      alter default privileges in schema public grant execute on functions to public,anon,authenticated`);
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort())
      await observer.ok(`\\set ON_ERROR_STOP on\n${await readFile(new URL(file, directory), "utf8")}`);
    await observer.ok("\\set ON_ERROR_STOP off\nselect 1");
    for (const s of [a, b, c]) await s.ok("set lock_timeout='8s'; set statement_timeout='10s'");
  });
  after(async () => {
    await Promise.all([a?.close(), b?.close(), c?.close(), observer?.close()]);
    if (created) await maintenance.ok(`drop database ${database}`);
    await maintenance?.close();
  });
  beforeEach(async () => {
    await observer.ok(`truncate public.community_member_management_events,public.community_invitations,public.community_membership_requests,public.community_memberships,public.communities,public.private_profiles,auth.users;
      insert into auth.users(id,email_confirmed_at) values ('${owner}',now()),('${admin}',now()),('${target}',now()),('${outsider}',now()),('${extra}',now());
      begin;
      insert into public.communities(id,owner_user_id,name,slug,visibility,join_policy) values
        ('${community}','${owner}','Tenant','roles-race','public','instant'),('${other}','${outsider}','Other','other-race','public','instant');
      insert into public.community_memberships(community_id,user_id,role) values ('${community}','${owner}','owner'),('${other}','${outsider}','owner');
      insert into public.community_memberships(community_id,user_id,role,membership_id) values
        ('${community}','${admin}','admin','${adminId}'),('${community}','${target}','member','${targetId}'),('${other}','${extra}','member','${otherId}');
      commit`);
    otherBefore = await otherSnapshot();
  });
  afterEach(async () => { await a.ok("rollback"); await b.ok("rollback"); await c.ok("rollback"); });
  const set = (role = "moderator", id = targetId, tenant = community) => `select outcome from public.set_community_member_role('${tenant}','${id}','${role}')`;
  const remove = (id = targetId, tenant = community) => `select outcome from public.remove_community_member('${tenant}','${id}')`;
  const leave = `select public.leave_community('${community}')`;
  const join = `select public.join_community('${community}')`;
  const approve = `select outcome from public.approve_community_membership_request('${community}','${requestId}')`;
  const withdraw = `select outcome from public.withdraw_community_membership_request('${community}','${requestId}')`;
  const settings = `select public.update_community_settings('${community}','{"name":"Tenant","description":"","visibility":"private","join_policy":"approval_required"}'::jsonb)`;
  const accept = `select outcome from public.accept_community_invitation('${"ab".repeat(32)}')`;
  async function pending() { await observer.ok(`update public.communities set join_policy='approval_required' where id='${community}'; insert into public.community_membership_requests(id,community_id,requester_user_id,requester_display_name) values ('${requestId}','${community}','${target}','Shared')`); }
  async function invitation() { await observer.ok(`insert into public.community_invitations(community_id,token_hash,created_by_user_id,created_at,expires_at) select '${community}',extensions.digest('${"ab".repeat(32)}','sha256'),'${owner}',t,t+interval '168 hours' from (select clock_timestamp() t) x`); }
  async function begin(s: Session, actor: string, privileged = false) { await s.ok(`begin; select set_config('request.jwt.claim.sub','${actor}',true)${privileged ? "" : "; set local role authenticated"}`); }
  async function otherSnapshot() { return observer.ok(`select json_build_object('c',(select row_to_json(c) from public.communities c where id='${other}'),'m',(select json_agg(m order by user_id) from public.community_memberships m where community_id='${other}'),'e',(select json_agg(e order by id) from public.community_member_management_events e where community_id='${other}'))`); }
  async function state() { return JSON.parse(await observer.ok(`select json_build_object(
    'role',(select role from public.community_memberships where community_id='${community}' and user_id='${target}'),
    'id',(select membership_id from public.community_memberships where community_id='${community}' and user_id='${target}'),
    'admin_role',(select role from public.community_memberships where community_id='${community}' and user_id='${admin}'),
    'events',(select count(*) from public.community_member_management_events),
    'request',(select status from public.community_membership_requests where id='${requestId}'),
    'reason',(select cancellation_reason from public.community_membership_requests where id='${requestId}'))`)) as {
      role: string | null; id: string | null; admin_role: string | null; events: number; request: string | null; reason: string | null;
    }; }
  async function invariants(unchangedOther = true) {
    assert.equal(await observer.ok(`select count(*) from (
      select c.id from public.communities c where (select count(*) from public.community_memberships m where m.community_id=c.id and m.role='owner')<>1
        or not exists(select 1 from public.community_memberships m where m.community_id=c.id and m.user_id=c.owner_user_id and m.role='owner')
      union all select community_id from public.community_memberships group by community_id,user_id having count(*)>1
      union all select community_id from public.community_membership_requests where status='pending' group by community_id,requester_user_id having count(*)>1
    ) violations`), "0");
    if (unchangedOther) assert.equal(await otherSnapshot(), otherBefore);
  }
  async function blockedByA() {
    for (let i = 0; i < 400; i++) {
      if (await observer.ok(`select exists(select 1 from pg_stat_activity a,pg_stat_activity b where a.datname='${database}' and b.datname='${database}' and a.application_name='growup_members_a' and b.application_name='growup_members_b' and a.pid=any(pg_blocking_pids(b.pid)))`) === "t") return;
      await delay(10);
    }
    assert.fail("Expected observed PostgreSQL blocking before releasing transaction A");
  }
  type Operation = { actor: string; sql: string; privileged?: boolean };
  async function race(first: Operation, second: Operation, code = "00000", rollback = false, unchangedOther = true) {
    await begin(a, first.actor, first.privileged); const firstResult = await a.ok(first.sql);
    await begin(b, second.actor, second.privileged); const waiting = b.query(second.sql);
    await blockedByA(); await a.ok(rollback ? "rollback" : "commit");
    const result = await waiting; assert.equal(result.code, code, result.errors);
    await b.ok(code === "00000" ? "commit" : "rollback"); await invariants(unchangedOther);
    return [firstResult, result.output];
  }
  for (const reverse of [false, true]) it(`set/set reauthorizes and later assignment wins (${reverse})`, async () => {
    const assignments = reverse ? ["admin", "moderator"] : ["moderator", "admin"];
    await race({ actor: owner, sql: set(assignments[0]) }, { actor: owner, sql: set(assignments[1]) });
    const s = await state(); assert.equal(s.role, assignments[1]); assert.equal(s.events, 2);
  });
  for (const reverse of [false, true]) it(`set/remove (${reverse ? "remove" : "set"} first)`, async () => {
    const pair = [{ actor: owner, sql: set() }, { actor: admin, sql: remove() }];
    if (reverse) pair.reverse();
    await race(pair[0], pair[1], reverse ? "42501" : "00000");
    const s = await state(); assert.equal(s.role, null); assert.equal(s.events, reverse ? 1 : 2);
  });
  it("promotion to admin wins: later admin remover rechecks and is denied", async () => {
    await race({ actor: owner, sql: set("admin") }, { actor: admin, sql: remove() }, "42501"); assert.equal((await state()).role, "admin"); assert.equal((await state()).events, 1);
  });
  for (const reverse of [false, true]) it(`remove/remove has one audit and generic absence (${reverse})`, async () => {
    const actors = reverse ? [admin, owner] : [owner, admin];
    assert.deepEqual(await race({ actor: actors[0], sql: remove() }, { actor: actors[1], sql: remove() }), ["removed", "already_absent"]);
    assert.equal((await state()).events, 1);
  });
  for (const op of ["set", "remove"]) for (const demoteFirst of [false, true]) it(`manager demotion vs ${op}, demotion first=${demoteFirst}`, async () => {
    const demote = { actor: owner, sql: set("member", adminId) }, manage = { actor: admin, sql: op === "set" ? set() : remove() };
    await race(demoteFirst ? demote : manage, demoteFirst ? manage : demote, demoteFirst ? "42501" : "00000");
    const s = await state(); assert.equal(s.admin_role, "member"); assert.equal(s.events, demoteFirst ? 1 : 2); assert.equal(s.role, demoteFirst ? "member" : op === "set" ? "moderator" : null);
  });
  for (const leaveFirst of [false, true]) it(`manager leave vs management, leave first=${leaveFirst}`, async () => {
    const leaveOp = { actor: admin, sql: leave }, manage = { actor: admin, sql: set() };
    await race(leaveFirst ? leaveOp : manage, leaveFirst ? manage : leaveOp, leaveFirst ? "42501" : "00000");
    const s = await state(); assert.equal(s.admin_role, null); assert.equal(s.events, leaveFirst ? 0 : 1);
  });
  for (const op of ["set", "remove"]) for (const leaveFirst of [false, true]) it(`target leave vs ${op}, leave first=${leaveFirst}`, async () => {
    const leaveOp = { actor: target, sql: leave }, manage = { actor: owner, sql: op === "set" ? set() : remove() };
    const result = await race(leaveFirst ? leaveOp : manage, leaveFirst ? manage : leaveOp, leaveFirst && op === "set" ? "42501" : "00000");
    const s = await state(); assert.equal(s.id, null); assert.equal(s.events, leaveFirst ? 0 : 1);
    if (leaveFirst && op === "remove") assert.equal(result[1], "already_absent");
  });
  for (const op of ["set", "remove"]) it(`leave/rejoin wins while stale ${op} waits; replacement lifetime untouched`, async () => {
    const result = await race({ actor: target, sql: `${leave}; ${join}` }, { actor: owner, sql: op === "set" ? set() : remove() }, op === "set" ? "42501" : "00000");
    const s = await state(); assert.notEqual(s.id, targetId); assert.equal(s.role, "member"); assert.equal(s.events, 0);
    if (op === "remove") assert.equal(result[1], "already_absent");
  });
  for (const admission of ["instant", "invitation", "approval"]) for (const removeFirst of [false, true]) it(`remove vs ${admission}, removal first=${removeFirst}`, async () => {
    if (admission === "invitation") await invitation(); if (admission === "approval") await pending();
    const admit = { actor: admission === "approval" ? owner : target, sql: admission === "instant" ? join : admission === "invitation" ? accept : approve };
    const removal = { actor: admin, sql: remove() };
    await race(removeFirst ? removal : admit, removeFirst ? admit : removal);
    const s = await state(); assert.equal(s.events, 1);
    if (removeFirst && admission !== "approval") { assert.equal(s.role, "member"); assert.notEqual(s.id, targetId); }
    else assert.equal(s.id, null);
    if (admission === "approval") { assert.equal(s.request, "cancelled"); assert.equal(s.reason, "already_member"); }
  });
  for (const interaction of ["review", "withdraw", "settings"]) for (const removeFirst of [false, true]) it(`pending cancellation vs ${interaction}, removal first=${removeFirst}`, async () => {
    await pending();
    const counterpart = { actor: interaction === "withdraw" ? target : owner, sql: interaction === "review" ? approve : interaction === "withdraw" ? withdraw : settings };
    const removal = { actor: admin, sql: remove() };
    await race(removeFirst ? removal : counterpart, removeFirst ? counterpart : removal);
    const s = await state(); assert.equal(s.id, null); assert.equal(s.events, 1);
    assert.equal(s.request, !removeFirst && interaction === "withdraw" ? "withdrawn" : "cancelled");
    assert.equal(s.reason, !removeFirst && interaction === "withdraw" ? null : !removeFirst && interaction === "settings" ? "policy_changed" : "already_member");
  });
  for (const reverse of [false, true]) it(`inverse account locks use UUID order with ${reverse ? "larger" : "smaller"} actor first`, async () => {
    await observer.ok(`insert into public.community_memberships(community_id,user_id,role) values ('${other}','${admin}','admin');
      insert into public.community_memberships(community_id,user_id,role,membership_id) values ('${other}','${owner}','member','${requestId}')`);
    const smaller = owner, larger = admin;
    assert.ok(smaller < larger, "Fixture UUIDs must have deterministic database ordering");
    const pair = [{ actor: owner, sql: set("moderator", adminId) }, { actor: admin, sql: set("moderator", requestId, other) }];
    if (reverse) pair.reverse();
    const membershipsSql = `select coalesce(json_agg(x order by community_id,user_id),'[]') from (
      select community_id,user_id,membership_id,role,management_display_name,created_at::text
      from public.community_memberships) x`;
    const beforeMemberships = JSON.parse(await observer.ok(membershipsSql)) as { membership_id: string; role: string }[];
    const communitiesSql = "select json_agg(c order by id) from public.communities c";
    const beforeCommunities = await observer.ok(communitiesSql);
    // Transaction-ID waits distinguish the holder from a tuple-lock queue waiter:
    // pg_blocking_pids alone could report A ahead of B on C's larger row.
    async function observeChain(includeB: boolean) {
      const deadline = Date.now() + 3000;
      do {
        if (await observer.ok(`select exists(
          select 1 from pg_stat_activity a,pg_stat_activity b,pg_stat_activity c
          where a.datname='${database}' and b.datname='${database}' and c.datname='${database}'
            and a.application_name='growup_members_a' and b.application_name='growup_members_b'
            and c.application_name='growup_members_c'
            and c.pid=any(pg_blocking_pids(a.pid)) and cardinality(pg_blocking_pids(c.pid))=0
            and exists(select 1 from pg_locks l where l.pid=a.pid and not l.granted
              and l.locktype='transactionid' and l.transactionid=c.backend_xid)
            ${includeB ? `and a.pid=any(pg_blocking_pids(b.pid))
              and not c.pid=any(pg_blocking_pids(b.pid))
              and exists(select 1 from pg_locks l where l.pid=b.pid and not l.granted
                and l.locktype='transactionid' and l.transactionid=a.backend_xid)` : ""}
        )`) === "t") return;
        await delay(10);
      } while (Date.now() < deadline);
      assert.fail(`Expected transaction waits ${includeB ? "B -> A -> C" : "A -> C"} before releasing C`);
    }
    let pendingA: Promise<PromiseSettledResult<string>[]> | undefined;
    let pendingB: Promise<PromiseSettledResult<string>[]> | undefined;
    try {
      await begin(c, owner, true);
      assert.equal(await c.ok(`select id from auth.users where id='${larger}' for update`), larger);
      await begin(a, pair[0].actor);
      // Attach rejection handlers immediately, including on assertion-failure paths.
      pendingA = Promise.allSettled([a.ok(pair[0].sql)]);
      await observeChain(false);
      await observer.ok("begin");
      try {
        const probe = await observer.query(`select id from auth.users where id='${smaller}' for update nowait`);
        assert.equal(probe.code, "55P03", "A must already hold smaller while C holds only larger");
      } finally { await observer.ok("rollback"); }
      await begin(b, pair[1].actor);
      pendingB = Promise.allSettled([b.ok(pair[1].sql)]);
      await observeChain(true);
      await c.ok("commit");
      const [first] = await pendingA;
      assert.equal(first.status, "fulfilled", first.status === "rejected" ? String(first.reason) : "");
      if (first.status === "fulfilled") assert.equal(first.value, "changed");
      await a.ok("commit");
      const [second] = await pendingB;
      assert.equal(second.status, "fulfilled", second.status === "rejected" ? String(second.reason) : "");
      if (second.status === "fulfilled") assert.equal(second.value, "changed");
      await b.ok("commit");
      // Demotion in community does not revoke admin authority in other.
      assert.deepEqual(JSON.parse(await observer.ok(membershipsSql)), beforeMemberships.map(row =>
        row.membership_id === adminId || row.membership_id === requestId ? { ...row, role: "moderator" } : row));
      assert.equal(await observer.ok(communitiesSql), beforeCommunities);
      assert.deepEqual(JSON.parse(await observer.ok(`select coalesce(json_agg(x order by community_id),'[]') from (
        select community_id,actor_user_id,target_user_id,target_membership_id,old_role,new_role
        from public.community_member_management_events) x`)), [
        { community_id: community, actor_user_id: owner, target_user_id: admin, target_membership_id: adminId, old_role: "admin", new_role: "moderator" },
        { community_id: other, actor_user_id: admin, target_user_id: owner, target_membership_id: requestId, old_role: "member", new_role: "moderator" },
      ]);
      await invariants(false);
    } finally {
      // Release the barrier first; never issue another command on a busy session.
      await Promise.allSettled([c.ok("rollback")]);
      await pendingA;
      await Promise.allSettled([a.ok("rollback")]);
      await pendingB;
      await Promise.allSettled([b.ok("rollback")]);
    }
  });
  for (const subject of ["actor", "target"]) for (const change of ["ban", "soft-delete", "hard-delete"]) for (const accountFirst of [false, true])
    it(`${subject} ${change} race, account change first=${accountFirst}`, async () => {
      const id = subject === "actor" ? admin : target;
      const sql = change === "hard-delete" ? `delete from auth.users where id='${id}'`
        : `update auth.users set ${change === "ban" ? "banned_until=now()+interval '1 day'" : "deleted_at=now()"} where id='${id}'`;
      const account = { actor: owner, sql, privileged: true }, manage = { actor: admin, sql: set() };
      await race(accountFirst ? account : manage, accountFirst ? manage : account, accountFirst ? "42501" : "00000");
      const s = await state(); assert.equal(s.events, accountFirst ? 0 : 1);
      assert.equal(s.role, subject === "target" && change === "hard-delete" ? null : accountFirst ? "member" : "moderator");
    });
  for (const op of ["set", "remove"]) it(`target ban winning still allows cleanup ${op}`, async () => {
    await observer.ok(`update public.community_memberships set role='moderator' where membership_id='${targetId}'`);
    await race({ actor: owner, sql: `update auth.users set banned_until=now()+interval '1 day' where id='${target}'`, privileged: true }, { actor: owner, sql: op === "set" ? set("member") : remove() });
    assert.equal((await state()).events, 1);
  });
  for (const op of ["set", "remove"]) it(`${op} rollback releases waiter and leaves only committed audit`, async () => {
    await pending();
    await race({ actor: owner, sql: op === "set" ? set("admin") : remove() }, { actor: admin, sql: set() }, "00000", true);
    const s = await state(); assert.equal(s.id, targetId); assert.equal(s.role, "moderator"); assert.equal(s.events, 1); assert.equal(s.request, "pending");
  });
  it("unrelated tenant/account operation progresses while same-tenant management is blocked", async () => {
    await begin(a, owner); await a.ok(set()); await begin(b, admin); const waiting = b.query(remove()); await blockedByA();
    await begin(c, outsider); assert.equal(await c.ok(set("moderator", otherId, other)), "changed"); await c.ok("commit");
    await a.ok("commit"); assert.equal((await waiting).output, "removed"); await b.ok("commit"); await invariants(false);
    assert.equal(await observer.ok(`select role from public.community_memberships where membership_id='${otherId}'`), "moderator");
  });
  it("roster does not lock all members: unrelated target can leave before listing transaction commits", async () => {
    await begin(a, owner); await a.ok(`select membership_id from public.list_community_members('${community}')`);
    await begin(b, target); await b.ok(leave); await b.ok("commit"); await a.ok("commit"); await invariants(); assert.equal((await state()).id, null);
  });
});
