// Opt-in real PostgreSQL tests. Requires an explicitly selected local disposable
// server and psql, no application driver or hosted credentials. Never targets a
// supplied hostname/database: creates and drops only its own random local DB.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const psql = process.env.GROWUP_TEST_PSQL;
const port = process.env.GROWUP_TEST_PG_PORT;
const enabled = !!psql && !!port;
const database = `growup_requests_${randomUUID().replaceAll("-", "")}`;
const owner = "11111111-1111-4111-8111-111111111111";
const applicant = "22222222-2222-4222-8222-222222222222";
const admin = "33333333-3333-4333-8333-333333333333";
const outsider = "44444444-4444-4444-8444-444444444444";
const extra = "66666666-6666-4666-8666-666666666666";
const community = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const request = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const otherRequest = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
type Result = { code: string; output: string; errors: string };
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
        clearTimeout(timer); this.process.stdout.off("data", onData); this.process.stderr.off("data", onErrorData);
        this.process.off("error", onError); this.process.off("exit", onExit);
      };
      const onError = (error: Error) => { finish(); reject(error); };
      const onExit = () => onError(new Error(`psql exited: ${errors}`));
      const onErrorData = (chunk: Buffer) => { errors += chunk.toString(); };
      const onData = (chunk: Buffer) => {
        output += chunk.toString();
        const match = new RegExp(`${marker} ([A-Z0-9]{5})\\r?\\n`).exec(output);
        if (match) { finish(); resolve({ code: match[1], output: output.slice(0, match.index).trim(), errors }); }
      };
      const timer = setTimeout(() => { onError(new Error(`psql timed out: ${errors}`)); this.process.kill(); }, 15000);
      this.process.stdout.on("data", onData); this.process.stderr.on("data", onErrorData);
      this.process.on("error", onError); this.process.on("exit", onExit);
      this.process.stdin.write(`${sql};\n\\echo ${marker} :SQLSTATE\n`);
    });
  }
  async ok(sql: string) {
    const result = await this.query(sql); assert.equal(result.code, "00000", result.errors || result.output); return result.output;
  }
  async close() {
    if (this.process.exitCode !== null) return;
    await new Promise<void>((resolve) => { this.process.once("exit", () => resolve()); this.process.stdin.end("\\q\n"); });
  }
}

describe("membership requests with independent PostgreSQL sessions", { skip: !enabled, concurrency: false }, () => {
  let maintenance: Session, observer: Session, a: Session, b: Session;
  let databaseCreated = false;
  let otherBefore: string;
  before(async () => {
    maintenance = new Session("growup_requests_maintenance", "postgres");
    // Roles are cluster-scoped. Reuse Supabase-like roles if already present.
    await maintenance.ok(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    end $$`);
    await maintenance.ok(`create database ${database}`);
    databaseCreated = true;
    observer = new Session("growup_requests_observer");
    a = new Session("growup_requests_a"); b = new Session("growup_requests_b");
    await observer.ok(`create schema auth;
      create table auth.users(id uuid primary key,email_confirmed_at timestamptz,banned_until timestamptz,
        raw_user_meta_data jsonb default '{}',is_anonymous boolean default false,deleted_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
      alter default privileges in schema public grant all on tables to public,anon,authenticated;
      alter default privileges in schema public grant execute on functions to public,anon,authenticated`);
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
      const sql = await readFile(new URL(file, directory), "utf8");
      // ON_ERROR_STOP applies inside each migration too, so a trailing COMMIT
      // cannot disguise an earlier failure in this fresh disposable database.
      await observer.ok(`\\set ON_ERROR_STOP on\n${sql}`);
    }
    await observer.ok("\\set ON_ERROR_STOP off\nselect 1");
    for (const session of [a, b]) await session.ok("set lock_timeout='8s'; set statement_timeout='10s'");
  });
  after(async () => {
    await Promise.all([a?.close(), b?.close(), observer?.close()]);
    if (databaseCreated) await maintenance.ok(`drop database ${database}`);
    await maintenance?.close();
  });
  beforeEach(async () => {
    await observer.ok(`truncate public.community_membership_requests,public.community_memberships,public.communities,public.private_profiles,auth.users;
      insert into auth.users(id,email_confirmed_at) values ('${owner}',now()),('${applicant}',now()),('${admin}',now()),('${outsider}',now()),('${extra}',now());
      begin;
      insert into public.communities(id,owner_user_id,name,slug,visibility,join_policy) values
        ('${community}','${owner}','Community','race-community','public','approval_required'),
        ('${other}','${outsider}','Other','race-other','unlisted','approval_required');
      insert into public.community_memberships(community_id,user_id,role) values
        ('${community}','${owner}','owner'),('${community}','${admin}','admin'),('${other}','${outsider}','owner');
      insert into public.community_membership_requests(id,community_id,requester_user_id,requester_display_name) values
        ('${request}','${community}','${applicant}','Shared'),('${otherRequest}','${other}','${extra}','Other');
      commit`);
    otherBefore = await otherSnapshot();
  });
  afterEach(async () => { await a.ok("rollback"); await b.ok("rollback"); });

  const submit = `select row_to_json(r) from public.request_community_membership('${community}','Shared') r`;
  const decision = (operation: string, tenant = community, id = request) => `select row_to_json(r) from public.${operation}_community_membership_request('${tenant}','${id}') r`;
  const closeSettings = `select public.update_community_settings('${community}','{"name":"Closed","visibility":"private","join_policy":"approval_required"}')`;
  const openSettings = `select public.update_community_settings('${community}','{"name":"Open","visibility":"public","join_policy":"approval_required"}')`;
  async function begin(session: Session, actor: string, privileged = false) {
    await session.ok(`begin; select set_config('request.jwt.claim.sub','${actor}',true)${privileged ? "" : "; set local role authenticated"}`);
  }
  async function otherSnapshot() {
    return observer.ok(`select json_build_object('community',(select row_to_json(c) from public.communities c where id='${other}'),
      'memberships',(select json_agg(m order by user_id) from public.community_memberships m where community_id='${other}'),
      'requests',(select json_agg(r order by id) from public.community_membership_requests r where community_id='${other}'))`);
  }
  async function invariants(checkOther = true) {
    const count = await observer.ok(`select count(*) from (
      select community_id,requester_user_id from public.community_membership_requests where status='pending' group by 1,2 having count(*)>1
      union all select community_id,user_id from public.community_memberships group by 1,2 having count(*)>1
      union all select c.id,c.owner_user_id from public.communities c where (select count(*) from public.community_memberships m where m.community_id=c.id and m.role='owner')<>1
        or not exists(select 1 from public.community_memberships m where m.community_id=c.id and m.user_id=c.owner_user_id and m.role='owner')
      union all select r.community_id,r.requester_user_id from public.community_membership_requests r join public.communities c on c.id=r.community_id
        where r.status='pending' and (c.visibility='private' or c.join_policy<>'approval_required')
    ) violations`);
    assert.equal(count, "0");
    assert.equal(await observer.ok(`select role from public.community_memberships where community_id='${community}' and user_id='${owner}'`), "owner");
    if (checkOther) assert.equal(await otherSnapshot(), otherBefore);
  }
  async function blockedByA() {
    for (let i = 0; i < 400; i++) {
      const blocked = await observer.ok(`select exists(select 1 from pg_stat_activity a,pg_stat_activity b
        where a.datname='${database}' and b.datname='${database}' and a.application_name='growup_requests_a'
          and b.application_name='growup_requests_b' and a.pid=any(pg_blocking_pids(b.pid)))`);
      if (blocked === "t") return;
      await delay(10);
    }
    assert.fail("Expected B to block on A before commit; no timing-only race assertion");
  }
  type Operation = { actor: string; sql: string; privileged?: boolean };
  async function race(first: Operation, second: Operation, secondCode = "00000") {
    await begin(a, first.actor, first.privileged); const resultA = await a.ok(first.sql);
    await begin(b, second.actor, second.privileged);
    const resultB = b.query(second.sql);
    await blockedByA(); await a.ok("commit");
    const result = await resultB; assert.equal(result.code, secondCode, result.errors || result.output);
    await b.ok(secondCode === "00000" ? "commit" : "rollback");
    await invariants(); return [resultA, result.output];
  }
  async function state() {
    return JSON.parse(await observer.ok(`select json_build_object('status',(select status from public.community_membership_requests where id='${request}'),
      'reason',(select cancellation_reason from public.community_membership_requests where id='${request}'),
      'role',(select role from public.community_memberships where community_id='${community}' and user_id='${applicant}'),
      'pending',(select count(*) from public.community_membership_requests where community_id='${community}' and requester_user_id='${applicant}' and status='pending'))`)) as
      { status: string; reason: string | null; role: string | null; pending: number };
  }
  it("submit/submit creates exactly one attempt and returns the same ID after blocking", async () => {
    await observer.ok(`delete from public.community_membership_requests where id='${request}'`);
    const [first, second] = await race({ actor: applicant, sql: submit }, { actor: applicant, sql: submit });
    assert.equal(JSON.parse(first).request_id, JSON.parse(second).request_id);
    assert.equal(JSON.parse(first).outcome, "created"); assert.equal(JSON.parse(second).outcome, "already_pending");
    assert.equal((await state()).pending, 1);
  });
  for (const reverse of [false, true]) it(`submit/withdraw (${reverse ? "withdraw" : "submit"} first) never withdraws a later attempt`, async () => {
    const pair = [{ actor: applicant, sql: submit }, { actor: applicant, sql: decision("withdraw") }];
    if (reverse) pair.reverse(); await race(pair[0], pair[1]);
    assert.equal((await state()).status, "withdrawn"); assert.equal((await state()).pending, reverse ? 1 : 0);
  });
  for (const [left, right] of [["approve", "withdraw"], ["approve", "reject"], ["approve", "approve"], ["withdraw", "reject"]]) {
    for (const reverse of [false, true]) it(`${left}/${right} (${reverse ? right : left} first, ${reverse ? "owner" : "admin"} reviewer first) has exactly one terminal winner`, async () => {
      const pair = [left, right]; if (reverse) pair.reverse();
      const actor = (op: string, index: number) => op === "withdraw" ? applicant : (index === 0) !== reverse ? admin : owner;
      await begin(a, actor(pair[0], 0)); await a.ok(decision(pair[0]));
      const resolved = await a.ok(`reset role; select row_to_json(r) from public.community_membership_requests r where id='${request}'`);
      await begin(b, actor(pair[1], 1)); const pendingB = b.query(decision(pair[1]));
      await blockedByA(); await a.ok("commit"); const result = await pendingB;
      assert.equal(result.code, "00000"); assert.equal(JSON.parse(result.output).outcome, "already_resolved"); await b.ok("commit");
      assert.equal(await observer.ok(`select row_to_json(r) from public.community_membership_requests r where id='${request}'`), resolved);
      assert.equal((await state()).role, pair[0] === "approve" ? "member" : null); await invariants();
    });
  }
  for (const operation of ["submit", "approve", "withdraw", "reject"]) for (const reverse of [false, true]) {
    it(`${operation}/settings (${reverse ? "settings" : operation} first) observes a permitted serial outcome`, async () => {
      if (operation === "submit") await observer.ok(`delete from public.community_membership_requests where id='${request}'`);
      const pair = [{ actor: operation === "submit" || operation === "withdraw" ? applicant : admin, sql: operation === "submit" ? submit : decision(operation) }, { actor: owner, sql: closeSettings }];
      if (reverse) pair.reverse(); await race(pair[0], pair[1], reverse && operation === "submit" ? "42501" : "00000");
      const result = await state(); assert.equal(result.pending, 0);
      assert.equal(result.role, !reverse && operation === "approve" ? "member" : null);
      if (operation !== "submit") assert.equal(result.status, reverse ? "cancelled" : operation === "approve" ? "approved" : operation === "withdraw" ? "withdrawn" : "rejected");
    });
  }
  it("close/reopen before a stale approval never revives the cancelled attempt", async () => {
    await race({ actor: owner, sql: `${closeSettings}; ${openSettings}` }, { actor: admin, sql: decision("approve") });
    assert.deepEqual(await state(), { status: "cancelled", reason: "policy_changed", role: null, pending: 0 });
  });
  for (const kind of ["leave", "demotion", "account", "insert"]) for (const reverse of [false, true]) {
    it(`approval/${kind} (${reverse ? kind : "approval"} first) rechecks current authority/account/membership`, async () => {
      const sql = kind === "leave" ? `select public.leave_community('${community}')`
        : kind === "demotion" ? `select 1 from auth.users where id='${admin}' for update;
          select 1 from public.communities where id='${community}' for share;
          update public.community_memberships set role='member' where community_id='${community}' and user_id='${admin}'`
        : kind === "account" ? `update auth.users set email_confirmed_at=null where id='${applicant}'`
        : `select 1 from auth.users where id='${applicant}' for update;
          select 1 from public.communities where id='${community}' for share;
          insert into public.community_memberships(community_id,user_id,role) values ('${community}','${applicant}','moderator') on conflict(community_id,user_id) do nothing`;
      const pair = [{ actor: admin, sql: decision("approve"), privileged: false }, { actor: kind === "leave" || kind === "demotion" ? admin : applicant, sql, privileged: kind !== "leave" }];
      if (reverse) pair.reverse(); await race(pair[0], pair[1], reverse && ["leave", "demotion"].includes(kind) ? "42501" : "00000");
      const result = await state();
      if (!reverse) { assert.equal(result.status, "approved"); assert.equal(result.role, "member"); }
      else if (["leave", "demotion"].includes(kind)) { assert.equal(result.status, "pending"); assert.equal(result.role, null); }
      else { assert.equal(result.status, "cancelled"); assert.equal(result.reason, kind === "account" ? "requester_unavailable" : "already_member"); assert.equal(result.role, kind === "account" ? null : "moderator"); }
    });
  }
  for (const reverse of [false, true]) it(`approved replay/leave (${reverse ? "leave" : "replay"} first) never re-enrolls`, async () => {
    await begin(a, admin); await a.ok(decision("approve")); await a.ok("commit");
    const pair = [{ actor: admin, sql: decision("approve") }, { actor: applicant, sql: `select public.leave_community('${community}')` }];
    if (reverse) pair.reverse(); await race(pair[0], pair[1]);
    assert.equal((await state()).role, null); assert.equal((await state()).status, "approved");
  });
  for (const reverse of [false, true]) it(`settings/settings (${reverse ? "open" : "close"} first) serializes settings and preserves cancellation`, async () => {
    const pair = [{ actor: owner, sql: closeSettings }, { actor: owner, sql: openSettings }];
    if (reverse) pair.reverse(); await race(pair[0], pair[1]);
    assert.equal((await state()).status, "cancelled");
    assert.equal(await observer.ok(`select visibility from public.communities where id='${community}'`), reverse ? "private" : "public");
  });
  it("cross-reviewers in different tenants acquire Auth UUIDs in the same order without deadlock", async () => {
    await observer.ok(`delete from public.community_membership_requests where id='${otherRequest}';
      insert into public.community_memberships(community_id,user_id,role) values ('${other}','${applicant}','admin');
      insert into public.community_membership_requests(id,community_id,requester_user_id,requester_display_name)
        values ('${otherRequest}','${other}','${admin}','Admin applicant')`);
    // Force both calls to reach the lower UUID first. If reviewer-first locking
    // were used, B would hold admin while blocked; A would then deadlock on admin.
    await observer.ok(`begin; select 1 from auth.users where id='${applicant}' for update`);
    await begin(a, admin); await begin(b, applicant);
    const pendingA = a.query(decision("approve"));
    const pendingB = b.query(decision("approve", other, otherRequest));
    for (let i = 0; i < 400; i++) {
      const count = await observer.ok(`select count(*) from pg_stat_activity where datname='${database}' and application_name in ('growup_requests_a','growup_requests_b') and wait_event_type='Lock'`);
      if (count === "2") break;
      assert.ok(i < 399, "Both reviewers must wait for the lower UUID barrier"); await delay(10);
    }
    await observer.ok("commit");
    const first = await Promise.race([pendingA.then((r) => ({ session: a, result: r })), pendingB.then((r) => ({ session: b, result: r }))]);
    assert.equal(first.result.code, "00000", first.result.errors); await first.session.ok("commit");
    const second = await (first.session === a ? pendingB : pendingA);
    assert.equal(second.code, "00000", second.errors); await (first.session === a ? b : a).ok("commit");
    await invariants(false);
    assert.equal((await state()).status, "approved"); assert.equal((await state()).role, "member");
    assert.equal(await observer.ok(`select status from public.community_membership_requests where id='${otherRequest}'`), "approved");
    assert.equal(await observer.ok(`select role from public.community_memberships where community_id='${other}' and user_id='${admin}'`), "member");
  });
  it("unrelated accounts and tenants proceed while another community has uncommitted work", async () => {
    await begin(a, applicant); await a.ok(submit);
    await begin(b, outsider); await b.ok(decision("approve", other, otherRequest)); await b.ok("commit");
    await a.ok("commit"); await invariants(false);
    assert.equal(await observer.ok(`select role from public.community_memberships where community_id='${other}' and user_id='${extra}'`), "member");
  });
});
