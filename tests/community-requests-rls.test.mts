import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const owner = "11111111-1111-4111-8111-111111111111";
const applicant = "22222222-2222-4222-8222-222222222222";
const admin = "33333333-3333-4333-8333-333333333333";
const outsider = "44444444-4444-4444-8444-444444444444";
const moderator = "55555555-5555-4555-8555-555555555555";
const missing = "99999999-9999-4999-8999-999999999999";
const submitSql = "select * from public.request_community_membership($1, $2)";
const requestTable = "public.community_membership_requests";
type Mutation = { request_id: string; status: string; outcome: string; cancellation_reason: string | null };
let db: PGlite, community: string, other: string;

describe("membership request database state machine and privacy", { concurrency: false }, () => {
  before(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec("create schema extensions; create extension pgcrypto with schema extensions");
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create schema auth;
      create table auth.users (id uuid primary key, email_confirmed_at timestamptz, banned_until timestamptz,
        raw_user_meta_data jsonb default '{}', is_anonymous boolean default false, deleted_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      grant usage on schema public, auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      alter default privileges in schema public grant all on tables to public, anon, authenticated;
      alter default privileges in schema public grant execute on functions to public, anon, authenticated;
    `);
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const migration of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(migration, directory), "utf8"));
    }
    for (const id of [owner, applicant, admin, outsider, moderator]) await db.query("insert into auth.users(id,email_confirmed_at) values ($1,now())", [id]);
  });
  after(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("begin");
    await asUser(owner);
    community = (await db.query<{ id: string }>("select public.create_community('Visible community','request-community','','public','approval_required') as id")).rows[0].id;
    await asUser(outsider);
    other = (await db.query<{ id: string }>("select public.create_community('Other tenant','other-tenant','','unlisted','approval_required') as id")).rows[0].id;
    await db.exec("reset role");
    for (const [id, role] of [[admin, "admin"], [moderator, "moderator"]]) await member(id, role);
    await db.exec("set constraints all immediate; set constraints all deferred");
  });
  afterEach(async () => { await db.exec("rollback"); });

  async function asUser(id: string | null, role = "authenticated") {
    assert.ok(["anon", "authenticated"].includes(role));
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id ?? ""]);
    await db.exec(`set local role ${role}`);
  }
  async function denied(sql: string, params: unknown[] = [], code = "42501") {
    await db.exec("savepoint denied");
    await assert.rejects(db.query(sql, params), { code });
    await db.exec("rollback to savepoint denied; release savepoint denied");
  }
  async function submit(id = applicant, tenant = community, name = "Shared name") {
    await asUser(id);
    return (await db.query<Mutation>(submitSql, [tenant, name])).rows[0];
  }
  async function resolve(operation: string, id: string, actor = owner, tenant = community) {
    assert.ok(["approve", "reject", "withdraw"].includes(operation));
    await asUser(actor);
    return (await db.query<Mutation>(`select * from public.${operation}_community_membership_request($1,$2)`, [tenant, id])).rows[0];
  }
  async function member(id: string, role = "member", tenant = community) {
    await db.exec("reset role");
    await db.query("insert into public.community_memberships(community_id,user_id,role) values ($1,$2,$3)", [tenant, id, role]);
  }
  async function rows() {
    await db.exec("reset role");
    return (await db.query<Record<string, unknown>>(`select * from ${requestTable} order by created_at,id`)).rows;
  }
  async function membership(id = applicant) {
    await db.exec("reset role");
    return (await db.query<{ role: string }>("select * from public.community_memberships where community_id=$1 and user_id=$2", [community, id])).rows;
  }
  async function settings(visibility = "public", policy = "approval_required", tenant = community, actor = owner) {
    await asUser(actor);
    return db.query("select public.update_community_settings($1,$2::jsonb)", [tenant, JSON.stringify({ name: "Updated", visibility, join_policy: policy })]);
  }

  for (const visibility of ["public", "unlisted", "private"]) for (const policy of ["instant", "approval_required", "invitation_only"]) {
    it(`enforces submission eligibility for ${visibility} + ${policy}`, async () => {
      await settings(visibility, policy);
      await asUser(applicant);
      if (visibility !== "private" && policy === "approval_required") {
        assert.equal((await db.query<Mutation>(submitSql, [community, "Name"])).rows[0].status, "pending");
        assert.deepEqual(await membership(), []);
      } else await denied(submitSql, [community, "Name"]);
    });
  }
  it("snapshots only explicitly shared name and preserves ID/name/time on duplicate submission", async () => {
    await db.query("update public.private_profiles set display_name='Secret private name' where user_id=$1", [applicant]);
    const first = await submit(applicant, community, "  🌱 Shared  ");
    const before = await rows();
    assert.equal(before[0].requester_display_name, "🌱 Shared");
    assert.deepEqual(await submit(applicant, community, "Different name"), { ...first, outcome: "already_pending" });
    assert.deepEqual(await rows(), before);
    await asUser(applicant);
    assert.deepEqual((await db.query("select * from public.community_memberships")).rows, []);
    assert.deepEqual((await db.query("select * from public.communities")).rows, []);
  });
  for (const actor of [owner, admin, moderator]) it(`denies existing ${actor === owner ? "owner" : actor === admin ? "admin" : "moderator"} submission`, async () => {
    await asUser(actor); await denied(submitSql, [community, "Name"]);
  });
  it("denies existing ordinary members even when a pending attempt exists", async () => {
    await submit(); await member(applicant); await asUser(applicant); await denied(submitSql, [community, "Name"]);
  });
  for (const [identity, role] of [[null, "anon"], [null, "authenticated"], [missing, "authenticated"]] as const) {
    it(`denies ${identity ?? "missing identity"}/${role} on every endpoint`, async () => {
      const request = await submit(); await asUser(identity, role);
      await denied(submitSql, [community, "Name"]);
      for (const operation of ["withdraw", "approve", "reject"]) await denied(`select * from public.${operation}_community_membership_request($1,$2)`, [community, request.request_id]);
      await denied("select * from public.get_my_community_membership_requests()");
      await denied("select * from public.list_community_membership_requests($1)", [community]);
    });
  }
  for (const change of ["email_confirmed_at=null", "is_anonymous=true", "deleted_at=now()", "banned_until=now()+interval '1 day'"]) {
    it(`denies account-ineligible submit/withdraw/read: ${change}`, async () => {
      const request = await submit(); await db.exec("reset role");
      await db.query(`update auth.users set ${change} where id=$1`, [applicant]); await asUser(applicant);
      await denied(submitSql, [community, "Name"]);
      await denied("select * from public.withdraw_community_membership_request($1,$2)", [community, request.request_id]);
      await denied("select * from public.get_my_community_membership_requests()");
    });
    it(`cancels approval of an ineligible requester without revealing cause: ${change}`, async () => {
      const request = await submit(); await db.exec("reset role");
      await db.query(`update auth.users set ${change} where id=$1`, [applicant]);
      const result = await resolve("approve", request.request_id);
      assert.deepEqual(result, { request_id: request.request_id, status: "cancelled", outcome: "cancelled", cancellation_reason: "cannot_be_admitted" });
      assert.equal((await rows())[0].cancellation_reason, "requester_unavailable");
      assert.deepEqual(await membership(), []);
      assert.deepEqual(await resolve("reject", request.request_id), { ...result, outcome: "already_resolved" });
    });
    it(`denies ineligible reviewer operations and queue: ${change}`, async () => {
      const request = await submit(); await db.exec("reset role");
      await db.query(`update auth.users set ${change} where id=$1`, [admin]); await asUser(admin);
      for (const operation of ["approve", "reject"]) await denied(`select * from public.${operation}_community_membership_request($1,$2)`, [community, request.request_id]);
      await denied("select * from public.list_community_membership_requests($1)", [community]);
    });
  }
  for (const operation of ["withdraw", "reject"]) it(`reapplies with a new immutable attempt after ${operation}`, async () => {
    const first = await submit();
    assert.equal((await resolve(operation, first.request_id, operation === "withdraw" ? applicant : owner)).status, operation === "withdraw" ? "withdrawn" : "rejected");
    const old = (await rows())[0];
    const next = await submit(applicant, community, "New shared name");
    assert.notEqual(next.request_id, first.request_id);
    assert.equal((await resolve(operation, first.request_id, operation === "withdraw" ? applicant : owner)).outcome, "already_resolved");
    assert.deepEqual((await rows())[0], old);
    assert.equal((await rows())[1].status, "pending");
  });
  it("denies other-user, missing and cross-tenant withdrawal with the same error", async () => {
    const request = await submit(); await asUser(outsider);
    await denied("select * from public.withdraw_community_membership_request($1,$2)", [community, request.request_id]);
    await asUser(applicant);
    for (const [tenant, id] of [[other, request.request_id], [community, missing]]) await denied("select * from public.withdraw_community_membership_request($1,$2)", [tenant, id]);
  });
  for (const actor of [owner, admin]) for (const operation of ["approve", "reject"]) {
    it(`${actor === owner ? "owner" : "admin"} can ${operation} once, without modifying existing staff or tenant fields`, async () => {
      const request = await submit(); await db.exec("reset role");
      const staff = (await db.query("select * from public.community_memberships order by community_id,user_id")).rows;
      const tenants = (await db.query("select * from public.communities order by id")).rows;
      const result = await resolve(operation, request.request_id, actor);
      assert.equal(result.status, operation === "approve" ? "approved" : "rejected");
      const history = await rows();
      assert.equal(history[0].resolved_by_user_id, actor);
      assert.equal((await membership()).length, operation === "approve" ? 1 : 0);
      if (operation === "approve") assert.equal((await membership())[0].role, "member");
      assert.deepEqual((await db.query("select * from public.community_memberships where user_id<>$1 order by community_id,user_id", [applicant])).rows, staff);
      assert.deepEqual((await db.query("select * from public.communities order by id")).rows, tenants);
      for (const retry of ["approve", "reject", "withdraw"]) assert.equal((await resolve(retry, request.request_id, retry === "withdraw" ? applicant : actor)).outcome, "already_resolved");
      assert.deepEqual(await rows(), history);
    });
  }
  for (const actor of [moderator, outsider, applicant]) it(`denies unauthorized review and queue for ${actor}`, async () => {
    const request = await submit(); await asUser(actor);
    for (const operation of ["approve", "reject"]) await denied(`select * from public.${operation}_community_membership_request($1,$2)`, [community, request.request_id]);
    await denied("select * from public.list_community_membership_requests($1)", [community]);
  });
  it("denies ordinary-member review and forged metadata roles/identity", async () => {
    const request = await submit(); await member(outsider);
    await db.query("update auth.users set raw_user_meta_data=$1::jsonb where id=$2", [JSON.stringify({ role: "owner", user_id: owner, community_id: community }), outsider]);
    await asUser(outsider);
    for (const operation of ["approve", "reject"]) await denied(`select * from public.${operation}_community_membership_request($1,$2)`, [community, request.request_id]);
    await denied("select * from public.approve_community_membership_request($1,$2,$3)", [community, request.request_id, owner], "42883");
    await denied("select * from public.request_community_membership($1,$2,$3)", [community, "Name", applicant], "42883");
  });
  it("checks tenant and authority before returning terminal details", async () => {
    const request = await submit(); await resolve("approve", request.request_id);
    await asUser(outsider);
    for (const tenant of [community, other]) for (const operation of ["approve", "reject"]) await denied(`select * from public.${operation}_community_membership_request($1,$2)`, [tenant, request.request_id]);
    await asUser(owner); await denied("select * from public.approve_community_membership_request($1,$2)", [other, request.request_id]);
  });
  it("denies self-review after a requester becomes staff, but permits withdrawal", async () => {
    const request = await submit(); await member(applicant, "admin"); await asUser(applicant);
    for (const operation of ["approve", "reject"]) await denied(`select * from public.${operation}_community_membership_request($1,$2)`, [community, request.request_id]);
    assert.equal((await resolve("withdraw", request.request_id, applicant)).status, "withdrawn");
    assert.equal((await membership())[0].role, "admin");
  });
  it("rechecks admin departure/demotion and actual owner agreement", async () => {
    const request = await submit(); await db.exec("reset role");
    await db.query("update public.community_memberships set role='member' where community_id=$1 and user_id=$2", [community, admin]);
    await asUser(admin); await denied("select * from public.approve_community_membership_request($1,$2)", [community, request.request_id]);
    await db.exec("reset role");
    // Deferred inconsistent ownership fixture: owner role alone cannot authorize.
    await db.query("update public.communities set owner_user_id=$1 where id=$2", [admin, community]);
    await asUser(owner); await denied("select * from public.approve_community_membership_request($1,$2)", [community, request.request_id]);
  });
  for (const role of ["member", "moderator", "admin", "owner"]) for (const operation of ["approve", "reject"]) it(`${operation} cancels already-member ${role} without any membership rewrite`, async () => {
    const request = await submit();
    if (role === "owner") {
      await db.exec("reset role");
      await db.query("update public.community_memberships set role='admin' where community_id=$1 and user_id=$2", [community, owner]);
      await member(applicant, role);
      await db.query("update public.communities set owner_user_id=$1 where id=$2", [applicant, community]);
      await db.exec("set constraints all immediate");
    } else await member(applicant, role);
    const existing = await membership();
    assert.deepEqual(await resolve(operation, request.request_id, admin), { request_id: request.request_id, status: "cancelled", outcome: "cancelled", cancellation_reason: "already_member" });
    assert.deepEqual(await membership(), existing);
  });
  it("old approval replay cannot restore membership after leave, and new approval never restores a historical staff role", async () => {
    const first = await submit(); await resolve("approve", first.request_id); await db.exec("reset role");
    await db.query("update public.community_memberships set role='admin' where community_id=$1 and user_id=$2", [community, applicant]);
    await asUser(applicant); await db.query("select public.leave_community($1)", [community]);
    assert.equal((await resolve("approve", first.request_id)).outcome, "already_resolved");
    assert.deepEqual(await membership(), []);
    const next = await submit(); assert.notEqual(next.request_id, first.request_id);
    await resolve("approve", next.request_id);
    assert.equal((await membership())[0].role, "member");
  });
  it("insertion-conflict fallback cancels without overwriting the concurrently supplied role", async () => {
    const request = await submit(); await db.exec("reset role");
    // Inject a membership after the review's existence check, exercising the
    // final ON CONFLICT guard even though supported admissions serialize earlier.
    await db.exec(`create function public.test_insert_conflict() returns trigger language plpgsql as $$
      begin
        if pg_trigger_depth() = 1 and new.user_id = '${applicant}' then
          insert into public.community_memberships(community_id,user_id,role) values (new.community_id,new.user_id,'moderator');
        end if;
        return new;
      end $$;
      create trigger test_insert_conflict before insert on public.community_memberships
        for each row execute function public.test_insert_conflict();`);
    assert.equal((await resolve("approve", request.request_id)).cancellation_reason, "already_member");
    assert.equal((await membership())[0].role, "moderator");
    assert.equal((await rows())[0].status, "cancelled");
  });
  it("rejection can resolve an ineligible requester without account disclosure", async () => {
    const request = await submit(); await db.exec("reset role");
    await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1", [applicant]);
    assert.equal((await resolve("reject", request.request_id)).status, "rejected");
  });
  for (const [visibility, policy] of [["public", "instant"], ["unlisted", "invitation_only"], ["private", "approval_required"], ["private", "instant"], ["private", "invitation_only"]]) {
    it(`settings ${visibility}/${policy} cancels only pending attempts in its tenant and never revives them`, async () => {
      const approved = await submit(); await resolve("approve", approved.request_id);
      const pending = await submit(outsider);
      await submit(applicant, other);
      const existing = await membership();
      await settings(visibility, policy);
      let history = await rows();
      assert.equal(history.find((r) => r.id === pending.request_id)?.cancellation_reason, "policy_changed");
      assert.equal(history.find((r) => r.id === approved.request_id)?.status, "approved");
      assert.equal(history.find((r) => r.community_id === other)?.status, "pending");
      assert.deepEqual(await membership(), existing);
      await asUser(owner); assert.deepEqual((await db.query("select * from public.list_community_membership_requests($1)", [community])).rows, []);
      await settings();
      assert.equal((await resolve("approve", pending.request_id)).status, "cancelled");
      const next = await submit(outsider); assert.notEqual(next.request_id, pending.request_id);
      history = await rows(); assert.equal(history.filter((r) => r.community_id === community && r.status === "pending").length, 1);
    });
  }
  it("eligible settings/name changes preserve pending; privileged settings updates also cancel", async () => {
    await submit(); const before = await rows();
    await settings("unlisted"); await settings("public"); assert.deepEqual(await rows(), before);
    await db.query("update public.communities set visibility='private' where id=$1", [community]);
    assert.equal((await rows())[0].status, "cancelled");
  });
  it("handles already-ineligible configurations defensively on settings and review", async () => {
    await settings("private"); await db.exec("reset role");
    const insert = async () => (await db.query<{ id: string }>(`insert into ${requestTable}(community_id,requester_user_id,requester_display_name) values ($1,$2,'Fixture') returning id`, [community, applicant])).rows[0].id;
    const first = await insert(); await settings("private");
    assert.equal((await rows())[0].status, "cancelled");
    const next = await insert();
    assert.notEqual(first, next);
    assert.equal((await resolve("approve", next)).cancellation_reason, "policy_changed");
  });
  for (const target of ["membership", "resolution", "cancellation"]) it(`rolls back the entire operation on injected ${target} failure`, async () => {
    const request = await submit(); const before = await rows();
    const tenants = (await db.query("select * from public.communities order by id")).rows;
    const table = target === "membership" ? "public.community_memberships" : requestTable;
    const event = target === "membership" ? "insert" : "update";
    await db.exec(`create function public.test_failure() returns trigger language plpgsql as $$ begin raise exception 'injected' using errcode='P0001'; end; $$;
      create trigger test_failure before ${event} on ${table} for each row execute function public.test_failure();`);
    await asUser(owner);
    if (target === "cancellation") await denied("select public.update_community_settings($1,$2::jsonb)", [community, JSON.stringify({ name: "Closed", visibility: "private", join_policy: "instant" })], "P0001");
    else await denied("select * from public.approve_community_membership_request($1,$2)", [community, request.request_id], "P0001");
    assert.deepEqual(await rows(), before); assert.deepEqual(await membership(), []);
    assert.deepEqual((await db.query("select * from public.communities order by id")).rows, tenants);
  });
  it("invalid settings roll back without cancelling requests", async () => {
    await submit(); const before = await rows(); await asUser(owner);
    await denied("select public.update_community_settings($1,$2::jsonb)", [community, JSON.stringify({ name: "", visibility: "private", join_policy: "instant" })], "23514");
    assert.deepEqual(await rows(), before);
  });
  for (const actor of [applicant, owner, admin, moderator, outsider]) it(`denies every direct-table path for ${actor}`, async () => {
    const request = await submit(); await asUser(actor);
    for (const sql of [`select * from ${requestTable}`, `select requester_display_name from ${requestTable}`, `update ${requestTable} set status='approved'`, `delete from ${requestTable}`, `truncate ${requestTable}`]) await denied(sql);
    await denied(`insert into ${requestTable}(community_id,requester_user_id,requester_display_name) values ($1,$2,'Forged')`, [community, actor]);
    await denied(`insert into ${requestTable}(id,community_id,requester_user_id,requester_display_name) values ($1,$2,$3,'Forged') on conflict(id) do update set status='pending'`, [request.request_id, community, actor]);
  });
  it("FORCE RLS still denies access if ordinary DML/select grants are accidentally broadened", async () => {
    await submit(); await db.exec(`reset role; grant select,insert,update,delete on ${requestTable} to authenticated`); await asUser(owner);
    assert.deepEqual((await db.query(`select * from ${requestTable}`)).rows, []);
    assert.deepEqual((await db.query(`update ${requestTable} set status='approved' returning *`)).rows, []);
    assert.deepEqual((await db.query(`delete from ${requestTable} returning *`)).rows, []);
    await denied(`insert into ${requestTable}(community_id,requester_user_id,requester_display_name) values ($1,$2,'Name')`, [community, owner]);
  });
  it("denies anonymous table reads/writes and catalog column privileges", async () => {
    await submit(); await asUser(null, "anon");
    await denied(`select * from ${requestTable}`);
    await denied(`insert into ${requestTable}(community_id,requester_user_id,requester_display_name) values ($1,$2,'Name')`, [community, applicant]);
    await db.exec("reset role");
    assert.deepEqual((await db.query(`select grantee from information_schema.column_privileges
      where table_schema='public' and table_name='community_membership_requests' and grantee in ('PUBLIC','anon','authenticated')`)).rows, []);
  });
  it("keeps the six application RPC signatures and exact projections synchronized with the maintained contract", async () => {
    const contracts = (await db.query<{ proname: string; proargnames: string[] }>(`select proname,proargnames from pg_proc
      where pronamespace='public'::regnamespace and proname in ('request_community_membership','withdraw_community_membership_request',
        'approve_community_membership_request','reject_community_membership_request','get_my_community_membership_requests','list_community_membership_requests')`)).rows;
    assert.equal(contracts.length, 6);
    for (const contract of contracts) {
      const mutationOutput = ["request_id", "status", "outcome", "cancellation_reason"];
      const expected = contract.proname === "request_community_membership" ? ["p_community_id", "p_display_name", ...mutationOutput]
        : contract.proname === "get_my_community_membership_requests" ? ["p_community_id", "p_before_created_at", "p_before_id", "p_limit", "request_id", "community_id", "requester_display_name", "status", "created_at", "resolved_at", "cancellation_reason", "community_name", "community_slug"]
        : contract.proname === "list_community_membership_requests" ? ["p_community_id", "p_after_created_at", "p_after_id", "p_limit", "request_id", "requester_display_name", "status", "created_at"]
        : ["p_community_id", "p_request_id", ...mutationOutput];
      assert.deepEqual(contract.proargnames, expected);
    }
  });
  it("enforces partial pending uniqueness, membership uniqueness, full FK indexes and no table policies", async () => {
    await submit(); await db.exec("reset role");
    await denied(`insert into ${requestTable}(community_id,requester_user_id,requester_display_name) values ($1,$2,'Name')`, [community, applicant], "23505");
    await denied("insert into public.community_memberships(community_id,user_id,role) values ($1,$2,'member')", [community, admin], "23505");
    assert.equal((await db.query("select * from pg_indexes where tablename='community_membership_requests'")).rows.length, 6);
    assert.deepEqual((await db.query("select * from pg_policies where tablename='community_membership_requests'")).rows, []);
    assert.deepEqual((await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='public.community_membership_requests'::regclass")).rows, [{ relrowsecurity: true, relforcerowsecurity: true }]);
  });
  it("guards every immutable attempt field and same-state metadata writes", async () => {
    await submit(); await db.exec("reset role");
    for (const expression of ["id=gen_random_uuid()", `community_id='${other}'`, `requester_user_id='${outsider}'`, "requester_display_name='Renamed'", "created_at=created_at-interval '1 second'", "status='pending'", "resolved_at=now()", `resolved_by_user_id='${owner}'`]) {
      await denied(`update ${requestTable} set ${expression}`, [], "23514");
    }
    await denied(`update ${requestTable} set status='withdrawn', requester_display_name='Renamed',resolved_at=clock_timestamp(),resolved_by_user_id=requester_user_id`, [], "23514");
  });
  for (const terminal of ["approved", "rejected", "withdrawn", "cancelled"]) it(`prevents initial ${terminal}, terminal rewriting and reopening`, async () => {
    await denied(`insert into ${requestTable}(community_id,requester_user_id,requester_display_name,status) values ($1,$2,'Name',$3)`, [community, applicant, terminal], "23514");
    const request = await submit();
    if (terminal === "cancelled") await settings("private");
    else await resolve(terminal === "approved" ? "approve" : terminal === "rejected" ? "reject" : "withdraw", request.request_id, terminal === "withdrawn" ? applicant : owner);
    await db.exec("reset role");
    for (const expression of ["status='pending',resolved_at=null,resolved_by_user_id=null,cancellation_reason=null", "status=status", "requester_display_name='Changed'", "resolved_at=clock_timestamp()", `resolved_by_user_id='${outsider}'`]) await denied(`update ${requestTable} set ${expression}`, [], "23514");
  });
  it("rejects malformed resolution NULL combinations, self-review, times and reasons", async () => {
    await submit(); await db.exec("reset role");
    const expressions = [
      "status=null", "status='unknown'", "status='approved'", "status='rejected',resolved_at=clock_timestamp()",
      `status='approved',resolved_by_user_id='${owner}'`, "status='approved',resolved_at=clock_timestamp(),resolved_by_user_id=requester_user_id",
      `status='withdrawn',resolved_at=clock_timestamp(),resolved_by_user_id='${owner}'`, "status='withdrawn',resolved_at=clock_timestamp()",
      "status='cancelled',resolved_at=clock_timestamp()", "status='cancelled',cancellation_reason='policy_changed'",
      "status='cancelled',resolved_at=clock_timestamp(),cancellation_reason='unknown'",
      `status='cancelled',resolved_at=clock_timestamp(),cancellation_reason='policy_changed',resolved_by_user_id='${owner}'`,
      `status='rejected',resolved_at=created_at-interval '1 second',resolved_by_user_id='${owner}'`,
      `status='approved',resolved_at=clock_timestamp(),resolved_by_user_id='${owner}',cancellation_reason='already_member'`,
    ];
    for (const expression of expressions) await denied(`update ${requestTable} set ${expression}`, [], expression === "status=null" ? "23502" : "23514");
  });
  it("enforces names, UUID locators, non-null data and referential integrity at the RPC/database boundary", async () => {
    await asUser(applicant);
    for (const name of [null, "", "   ", "a".repeat(81), "Name\n", "\tName", "x\u007f", "x\u0085", "x\u009f"]) await denied(submitSql, [community, name], "22023");
    assert.equal((await submit(applicant, community, "🌱".repeat(80))).status, "pending");
    await denied(submitSql, [null, "Name"], "22023");
    await db.exec("reset role");
    for (const [tenant, user] of [[missing, applicant], [community, missing]]) await denied(`insert into ${requestTable}(community_id,requester_user_id,requester_display_name) values ($1,$2,'Name')`, [tenant, user], "23503");
    await denied(`insert into ${requestTable}(community_id,requester_user_id,requester_display_name) values ($1,$2,null)`, [other, applicant], "23502");
  });
  it("provides only own receipts and redacts private-community metadata after cancellation", async () => {
    const request = await submit(); await submit(outsider); await settings("private"); await asUser(applicant);
    const result = (await db.query<Record<string, unknown>>("select * from public.get_my_community_membership_requests()")).rows;
    assert.equal(result.length, 1); assert.equal(result[0].request_id, request.request_id);
    assert.equal(result[0].community_name, null); assert.equal(result[0].community_slug, null);
    assert.equal(result[0].cancellation_reason, "policy_changed");
    assert.deepEqual(Object.keys(result[0]).sort(), ["request_id", "community_id", "requester_display_name", "status", "created_at", "resolved_at", "cancellation_reason", "community_name", "community_slug"].sort());
    assert.deepEqual((await db.query("select * from public.get_community_landing('request-community')")).rows, []);
    await member(applicant); await asUser(applicant);
    assert.equal((await db.query<{ community_slug: string }>("select * from public.get_my_community_membership_requests()")).rows[0].community_slug, "request-community");
  });
  it("queue exposes only shared name, request ID/status/time in the authorized tenant", async () => {
    const request = await submit(); await submit(applicant, other); await asUser(admin);
    const queue = (await db.query<Record<string, unknown>>("select * from public.list_community_membership_requests($1)", [community])).rows;
    assert.equal(queue.length, 1); assert.equal(queue[0].request_id, request.request_id);
    assert.deepEqual(Object.keys(queue[0]).sort(), ["request_id", "requester_display_name", "status", "created_at"].sort());
    await denied("select * from public.list_community_membership_requests($1)", [other]);
    await denied("select * from auth.users");
    assert.deepEqual((await db.query("select * from public.private_profiles where user_id=$1", [applicant])).rows, []);
  });
  it("paginates deterministic tuple cursors in opposite queue/history directions with bounds", async () => {
    // Same timestamps exercise UUID tie breaking, including exact-community latest.
    await db.query(`insert into ${requestTable}(community_id,requester_user_id,requester_display_name,created_at)
      select $1,id,'Name','2026-09-29T00:00:00Z' from auth.users where id in ($2,$3)`, [community, applicant, outsider]);
    await asUser(owner);
    const first = (await db.query<{ request_id: string; created_at: Date }>("select * from public.list_community_membership_requests($1,null,null,1)", [community])).rows[0];
    const second = (await db.query<{ request_id: string }>("select * from public.list_community_membership_requests($1,$2,$3,1)", [community, first.created_at, first.request_id])).rows[0];
    assert.ok(first.request_id < second.request_id);
    await settings("private"); await settings(); await submit(); await asUser(applicant);
    const history = (await db.query<{ request_id: string; created_at: Date }>("select * from public.get_my_community_membership_requests($1,null,null,1)", [community])).rows;
    assert.equal(history.length, 1);
    assert.equal((await db.query("select * from public.get_my_community_membership_requests($1,$2,$3,1)", [community, history[0].created_at, history[0].request_id])).rows.length, 1);
    assert.deepEqual((await db.query("select * from public.get_my_community_membership_requests($1)", [missing])).rows, []);
    for (const fn of ["get_my_community_membership_requests", "list_community_membership_requests"]) {
      await asUser(owner);
      for (const limit of [null, 0, -1, 51]) await denied(`select * from public.${fn}($1,null,null,$2)`, [community, limit], "22023");
      await denied(`select * from public.${fn}($1,now(),null,20)`, [community], "22023");
      await denied(`select * from public.${fn}($1,null,$2,20)`, [community, missing], "22023");
      await denied(`select * from public.${fn}($1,'infinity',$2,20)`, [community, missing], "22023");
    }
  });
  it("account hard deletion cascades requester history, but reviewer deletion leaves opaque audit/history intact", async () => {
    const request = await submit(); await resolve("reject", request.request_id, admin); const before = await rows();
    await db.query("delete from auth.users where id=$1", [admin]); assert.deepEqual(await rows(), before);
    await db.query("delete from auth.users where id=$1", [applicant]); assert.deepEqual(await rows(), []);
  });
  it("restricts all six RPCs and three internal functions with empty search paths", async () => {
    const result = (await db.query<{ name: string; signature: string; proconfig: string[]; authenticated: boolean; anon: boolean }>(`
      select p.proname name,p.oid::regprocedure::text signature,p.proconfig,
        has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('anon',p.oid,'execute') anon
      from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like '%membership_request%'
        or p.pronamespace='public'::regnamespace and p.proname='request_community_membership'`)).rows;
    assert.equal(result.length, 9);
    for (const fn of result) {
      assert.ok(fn.proconfig.includes('search_path=""')); assert.equal(fn.anon, false);
      const internal = /^(guard_|cancel_|review_)/.test(fn.name);
      assert.equal(fn.authenticated, !internal);
      if (internal) { await asUser(owner); await denied(`select ${fn.name}(${fn.name.startsWith("review_") ? "null,null,true" : ""})`); }
    }
  });
});
