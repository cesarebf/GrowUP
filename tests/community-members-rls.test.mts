import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const owner = "11111111-1111-4111-8111-111111111111", admin = "22222222-2222-4222-8222-222222222222";
const moderator = "33333333-3333-4333-8333-333333333333", member = "44444444-4444-4444-8444-444444444444";
const outsider = "55555555-5555-4555-8555-555555555555", target = "66666666-6666-4666-8666-666666666666";
const community = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const missing = "99999999-9999-4999-8999-999999999999";
const setSql = "select * from public.set_community_member_role($1,$2,$3)";
const removeSql = "select * from public.remove_community_member($1,$2)";
const nameSql = "select * from public.set_my_community_management_name($1,$2,$3)";
const listSql = "select * from public.list_community_members($1)";
const auditTable = "public.community_member_management_events";
const roles = ["owner", "admin", "moderator", "member"];
let db: PGlite;
type Row = Record<string, unknown>;
const q = async (sql: string, args: unknown[] = []) => (await db.query<Row>(sql, args)).rows;
async function root() { await db.exec("reset role"); }
async function as(id: string | null, role = "authenticated") {
  await root(); await q("select set_config('request.jwt.claim.sub',$1,true)", [id ?? ""]); await db.exec(`set local role ${role}`);
}
async function denied(sql: string, args: unknown[] = [], code = "42501") {
  await db.exec("savepoint denied");
  try { await assert.rejects(q(sql, args), (error: unknown) => {
    assert.equal((error as { code: string }).code, code);
    if (code === "42501" && /public\.(set_community_member_role|remove_community_member|set_my_community_management_name|list_community_members)\(/.test(sql)
      && !(error as Error).message.includes("permission denied")) assert.equal((error as Error).message, "Management unavailable");
    return true;
  }); } finally { await db.exec("rollback to denied; release denied"); }
}
async function membership(user = target, tenant = community) {
  await root(); return (await q("select *,created_at::text as created_exact,updated_at::text as updated_exact from public.community_memberships where community_id=$1 and user_id=$2", [tenant, user]))[0];
}
async function events() { await root(); return q(`select * from ${auditTable} order by occurred_at,id`); }
async function seed() {
  for (const id of [owner, admin, moderator, member, outsider, target]) await q("insert into auth.users(id,email_confirmed_at) values($1,now())", [id]);
  await db.exec(`begin;
    insert into public.communities(id,owner_user_id,name,slug,visibility,join_policy) values
      ('${community}','${owner}','Tenant','roles-tenant','public','instant'),('${other}','${outsider}','Other','other-tenant','public','instant');
    insert into public.community_memberships(community_id,user_id,role,created_at,updated_at) values
      ('${community}','${owner}','owner','2026-01-01 00:00:00.000001+00','2026-02-01 00:00:00.000002+00'),
      ('${community}','${admin}','admin','2026-01-01 00:00:00.000002+00','2026-02-01 00:00:00.000003+00'),
      ('${community}','${moderator}','moderator','2026-01-01 00:00:00.000003+00','2026-02-01 00:00:00.000004+00'),
      ('${community}','${member}','member','2026-01-01 00:00:00.000004+00','2026-02-01 00:00:00.000005+00'),
      ('${community}','${target}','member','2026-01-01 00:00:00.000004+00','2026-02-01 00:00:00.000006+00'),
      ('${other}','${outsider}','owner','2026-01-01 00:00:00.000005+00','2026-02-01 00:00:00.000007+00'); commit;`);
}
let baseline: Row[], backfilled: Row[];
describe("community role management database contract", { concurrency: false }, () => {
  before(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`create schema extensions; create extension pgcrypto with schema extensions;
      create role anon nologin; create role authenticated nologin; create schema auth;
      create table auth.users(id uuid primary key,email_confirmed_at timestamptz,banned_until timestamptz,
        raw_user_meta_data jsonb default '{}',is_anonymous boolean default false,deleted_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
      alter default privileges in schema public grant all on tables to public,anon,authenticated;
      alter default privileges in schema public grant execute on functions to public,anon,authenticated;`);
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(directory)).filter(n => n.endsWith(".sql")).sort()) {
      if (file.includes("community_role_management")) {
        await seed();
        baseline = await q("select community_id,user_id,role,created_at::text,updated_at::text from public.community_memberships order by community_id,user_id");
      }
      await db.exec(await readFile(new URL(file, directory), "utf8"));
    }
    backfilled = await q("select community_id,user_id,role,created_at::text,updated_at::text from public.community_memberships order by community_id,user_id");
  });
  after(async () => { await db?.close(); });
  beforeEach(async () => { await db.exec("begin"); });
  afterEach(async () => { await db.exec("rollback"); });

  it("populated backfill preserves every original field, composite PK and owner relationships", async () => {
    assert.deepEqual(backfilled, baseline);
    const rows = await q("select membership_id,management_display_name from public.community_memberships");
    assert.equal(rows.length, 6); assert.equal(new Set(rows.map(r => r.membership_id)).size, 6);
    assert.ok(rows.every(r => typeof r.membership_id === "string" && r.management_display_name === null));
    assert.equal((await q("select pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.community_memberships'::regclass and contype='p'"))[0].def, "PRIMARY KEY (community_id, user_id)");
    assert.equal((await q("select count(*)::int n from public.communities c where not exists(select 1 from public.community_memberships m where m.community_id=c.id and m.user_id=c.owner_user_id and m.role='owner')"))[0].n, 0);
  });
  for (const change of ["membership_id=gen_random_uuid()", `community_id='${other}'`, `user_id='${outsider}'`, "created_at=created_at+interval '1 microsecond'"])
    it(`identity immutable: ${change.split("=")[0]}`, async () => { await denied(`update public.community_memberships set ${change} where user_id=$1`, [target], "23514"); });
  it("existing update timestamp trigger remains authoritative", async () => {
    await q("update public.community_memberships set updated_at='2000-01-01' where user_id=$1", [target]);
    assert.equal((await q("select updated_at=now() ok from public.community_memberships where user_id=$1", [target]))[0].ok, true);
  });

  const actors = { owner, admin, moderator, member, unrelated: outsider };
  for (const [actorRole, actor] of Object.entries(actors)) for (const targetRole of roles) for (const destination of [...roles, "remove"]) {
    it(`${actorRole}: ${targetRole} -> ${destination}`, async () => {
      const user = targetRole === "owner" ? owner : target;
      if (targetRole !== "owner") await q("update public.community_memberships set role=$1 where user_id=$2", [targetRole, target]);
      const before = await membership(user), id = before.membership_id;
      const allowed = actor !== user && targetRole !== "owner" && destination !== "owner"
        && (actorRole === "owner" || actorRole === "admin" && targetRole !== "admin" && destination !== "admin");
      await as(actor);
      const sql = destination === "remove" ? removeSql : setSql, args = destination === "remove" ? [community, id] : [community, id, destination];
      if (!allowed) {
        await denied(sql, args, destination === "owner" ? "22023" : "42501");
        assert.deepEqual(await membership(user), before); assert.equal((await events()).length, 0); return;
      }
      assert.deepEqual(await q(sql, args), [{ outcome: destination === "remove" ? "removed" : destination === targetRole ? "unchanged" : "changed" }]);
      const audit = await events();
      if (destination === targetRole) { assert.deepEqual(await membership(user), before); assert.equal(audit.length, 0); }
      else {
        assert.equal(audit.length, 1); assert.equal(audit[0].actor_user_id, actor); assert.equal(audit[0].target_user_id, user);
        assert.equal(audit[0].target_membership_id, id); assert.equal(audit[0].old_role, targetRole); assert.equal(audit[0].new_role, destination === "remove" ? null : destination);
        assert.equal((await membership(user))?.role, destination === "remove" ? undefined : destination);
      }
    });
  }
  for (const [role, actor] of Object.entries(actors).filter(([r]) => r !== "unrelated")) for (const destination of ["member", "moderator", "admin", "remove"])
    it(`self always denied: ${role} -> ${destination}`, async () => {
      const id = (await membership(actor)).membership_id; await as(actor);
      await denied(destination === "remove" ? removeSql : setSql, destination === "remove" ? [community, id] : [community, id, destination]);
      assert.equal((await events()).length, 0);
    });
  it("owner can remove the only admin; zero nonowner admins valid", async () => {
    const id = (await membership(admin)).membership_id; await as(owner); await q(removeSql, [community, id]); await root();
    assert.equal((await q("select count(*)::int n from public.community_memberships where role='admin'"))[0].n, 0);
    await db.exec("set constraints all immediate");
  });
  it("owner identity is protected even with inconsistent role inside deferred transaction", async () => {
    await q("update public.community_memberships set role='member' where user_id=$1", [owner]);
    const id = (await membership(owner)).membership_id; await as(admin);
    await denied(removeSql, [community, id]); await denied(setSql, [community, id, "moderator"]);
  });
  for (const idType of ["missing", "foreign", "stale"]) it(`${idType} reference is absent only to authorized managers`, async () => {
    let id = idType === "foreign" ? (await membership(outsider, other)).membership_id : missing;
    if (idType === "stale") { id = (await membership()).membership_id; await as(target); await q("select public.leave_community($1)", [community]); await q("select public.join_community($1)", [community]); }
    await as(owner); await denied(setSql, [community, id, "moderator"]); assert.deepEqual(await q(removeSql, [community, id]), [{ outcome: "already_absent" }]);
    await as(outsider); await denied(removeSql, [community, id]); assert.equal((await events()).length, 0);
  });
  const badAccounts = { unverified: "email_confirmed_at=null", anonymous: "is_anonymous=true", deleted: "deleted_at=now()", banned: "banned_until=now()+interval '1 day'" };
  for (const [state, change] of Object.entries(badAccounts)) {
    for (const [oldRole, newRole] of [["member", "moderator"], ["member", "admin"], ["moderator", "admin"]])
      it(`${state} promotion denied ${oldRole}->${newRole} generically`, async () => {
        await q("update public.community_memberships set role=$1 where user_id=$2", [oldRole, target]); await q(`update auth.users set ${change} where id=$1`, [target]);
        const id = (await membership()).membership_id; await as(owner); await denied(setSql, [community, id, newRole]); assert.equal((await events()).length, 0);
      });
    for (const [oldRole, next] of [["admin", "moderator"], ["admin", "member"], ["moderator", "member"], ["admin", "admin"], ["member", "remove"]])
      it(`${state} cleanup/no-op allowed ${oldRole}->${next}`, async () => {
        await q("update public.community_memberships set role=$1 where user_id=$2", [oldRole, target]); await q(`update auth.users set ${change} where id=$1`, [target]);
        const id = (await membership()).membership_id; await as(owner); await q(next === "remove" ? removeSql : setSql, next === "remove" ? [community, id] : [community, id, next]);
      });
    it(`${state} actor denied every RPC`, async () => {
      const id = (await membership()).membership_id, own = (await membership(admin)).membership_id;
      await q(`update auth.users set ${change} where id=$1`, [admin]); await as(admin);
      for (const [sql, args] of [[setSql, [community, id, "moderator"]], [removeSql, [community, id]], [listSql, [community]], [nameSql, [community, own, "name"]]] as const) await denied(sql, [...args]);
    });
    it(`${state} roster suppresses name but keeps cleanup reference and role`, async () => {
      await q("update public.community_memberships set management_display_name='Secret label' where user_id=$1", [target]);
      await q(`update auth.users set ${change} where id=$1`, [target]); const id = (await membership()).membership_id;
      await as(owner); const row = (await q(listSql, [community])).find(r => r.membership_id === id)!;
      assert.equal(row.management_display_name, null); assert.equal(row.role, "member");
    });
  }
  for (const actor of [owner, member]) it(`self-service name for ${actor === owner ? "owner" : "member"}`, async () => {
    const id = (await membership(actor)).membership_id; await as(actor);
    for (const [input, expected] of [["  José 🐱  ", "José 🐱"], ["🐱".repeat(80), "🐱".repeat(80)], ["<script>plain</script>", "<script>plain</script>"], ["", null], ["   ", null], [null, null]])
      assert.deepEqual(await q(nameSql, [community, id, input]), [{ management_display_name: expected }]);
    assert.equal((await events()).length, 0);
  });
  for (const name of ["x".repeat(81), "\n", "x\t", "x\u007f", "x\u0085", "🐱".repeat(81)]) it(`rejects invalid management name ${JSON.stringify(name).slice(0, 28)}`, async () => {
    const id = (await membership()).membership_id; await as(target); await denied(nameSql, [community, id, name], "22023");
  });
  it("manager cannot edit another person's label; duplicate labels valid; private names never copied", async () => {
    const id = (await membership()).membership_id, own = (await membership(owner)).membership_id;
    await q("update public.private_profiles set display_name='Private name' where user_id=$1", [target]);
    assert.equal((await membership()).management_display_name, null);
    await as(owner); await denied(nameSql, [community, id, "forged"]); await q(nameSql, [community, own, "Same"]);
    await as(target); await q(nameSql, [community, id, "Same"]);
    assert.equal((await membership()).management_display_name, "Same");
  });

  async function requestFixture(status = "pending") {
    await root();
    const row = (await q("insert into public.community_membership_requests(community_id,requester_user_id,requester_display_name) values($1,$2,'Explicit request name') returning *", [community, target]))[0];
    if (status !== "pending") await q("update public.community_membership_requests set status='rejected',resolved_at=clock_timestamp(),resolved_by_user_id=$1 where id=$2", [owner, row.id]);
    return row;
  }
  it("exact removal cancels anomalous pending only and preserves terminal history, profiles and invitations", async () => {
    const terminal = await requestFixture("rejected"), pending = await requestFixture(), before = await membership();
    const token = "ab".repeat(32), digest = createHash("sha256").update(token).digest("hex");
    await as(owner); await q("select * from public.create_community_invitation($1,$2)", [community, digest]);
    await root(); const invites = await q("select * from public.community_invitations"), requests = await q("select * from public.community_membership_requests where id=$1", [terminal.id]);
    await as(owner); await q(removeSql, [community, before.membership_id]); await root();
    assert.deepEqual(await q("select * from public.community_invitations"), invites);
    assert.deepEqual(await q("select * from public.community_membership_requests where id=$1", [terminal.id]), requests);
    const cancelled = (await q("select * from public.community_membership_requests where id=$1", [pending.id]))[0];
    assert.equal(cancelled.status, "cancelled"); assert.equal(cancelled.cancellation_reason, "already_member"); assert.equal(cancelled.resolved_by_user_id, null);
    for (const key of ["id", "requester_user_id", "requester_display_name", "created_at"]) assert.deepEqual(cancelled[key], pending[key]);
    assert.equal((await q("select * from public.private_profiles where user_id=$1", [target])).length, 1);
    assert.equal((await q("select banned_until from auth.users where id=$1", [target]))[0].banned_until, null);
    assert.equal((await events()).length, 1);
  });
  it("stale absent removal never cancels a new legitimate pending application", async () => {
    const id = (await membership()).membership_id; await as(target); await q("select public.leave_community($1)", [community]);
    const pending = await requestFixture(); await as(owner); assert.deepEqual(await q(removeSql, [community, id]), [{ outcome: "already_absent" }]);
    await root(); assert.deepEqual((await q("select * from public.community_membership_requests where id=$1", [pending.id]))[0], pending);
  });
  for (const action of ["set", "remove"]) it(`audit failure rolls back ${action} and any pending cancellation`, async () => {
    const pending = await requestFixture(), before = await membership();
    await db.exec(`create function public.test_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'injected' using errcode='P0001'; end $$;
      create trigger test_fail before insert on ${auditTable} for each row execute function public.test_fail_audit();`);
    await as(owner); await denied(action === "set" ? setSql : removeSql, action === "set" ? [community, before.membership_id, "moderator"] : [community, before.membership_id], "P0001");
    assert.deepEqual(await membership(), before); assert.deepEqual((await q("select * from public.community_membership_requests where id=$1", [pending.id]))[0], pending);
  });
  for (const mode of ["instant", "approval", "invitation"]) it(`removal -> ${mode} admission resets lifetime/name/role; historical replay cannot rejoin`, async () => {
    await q("update public.community_memberships set role='admin',management_display_name='Staff' where user_id=$1", [target]);
    const old = await membership(); await as(owner); await q(removeSql, [community, old.membership_id]);
    let requestId: unknown;
    if (mode === "approval") {
      await q("select public.update_community_settings($1,$2::jsonb)", [community, JSON.stringify({ name: "Tenant", description: "", visibility: "public", join_policy: "approval_required" })]);
      await as(target); requestId = (await q("select * from public.request_community_membership($1,'Request label')", [community]))[0].request_id;
      await as(owner); await q("select * from public.approve_community_membership_request($1,$2)", [community, requestId]);
    } else if (mode === "invitation") {
      const hash = createHash("sha256").update("ab".repeat(32)).digest("hex"); await q("select * from public.create_community_invitation($1,$2)", [community, hash]);
      await as(target); await q("select * from public.accept_community_invitation($1)", ["ab".repeat(32)]);
    } else { await as(target); await q("select public.join_community($1)", [community]); }
    const fresh = await membership(); assert.notEqual(fresh.membership_id, old.membership_id); assert.equal(fresh.role, "member"); assert.equal(fresh.management_display_name, null);
    await as(owner); await denied(setSql, [community, old.membership_id, "admin"]); assert.deepEqual(await q(removeSql, [community, old.membership_id]), [{ outcome: "already_absent" }]);
    await as(target); await denied(nameSql, [community, old.membership_id, "stale"]); await q("select public.leave_community($1)", [community]);
    if (mode === "approval") { await as(owner); await q("select * from public.approve_community_membership_request($1,$2)", [community, requestId]); }
    if (mode === "invitation") await q("select * from public.accept_community_invitation($1)", ["ab".repeat(32)]);
    assert.equal(await membership(), undefined); assert.equal((await events()).length, 1);
  });
  it("voluntary leave/rejoin resets name and ID without audit", async () => {
    const old = await membership(); await as(target); await q(nameSql, [community, old.membership_id, "Name"]); await q("select public.leave_community($1)", [community]); await q("select public.join_community($1)", [community]);
    const fresh = await membership(); assert.notEqual(fresh.membership_id, old.membership_id); assert.equal(fresh.management_display_name, null); assert.equal((await events()).length, 0);
  });
  it("audit historical IDs survive target and actor hard deletion", async () => {
    const id = (await membership()).membership_id; await as(admin); await q(removeSql, [community, id]); const audit = await events();
    await q("delete from auth.users where id in ($1,$2)", [admin, target]); assert.deepEqual(await events(), audit);
  });
  for (const [role, actor] of Object.entries(actors)) it(`roster ${role} authorization and exact five-field projection`, async () => {
    await as(actor);
    if (role !== "owner" && role !== "admin") { await denied(listSql, [community]); return; }
    const rows = await q(listSql, [community]); assert.equal(rows.length, 5); assert.equal(rows.filter(r => r.is_self).length, 1);
    for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ["membership_id", "management_display_name", "role", "joined_at", "is_self"].sort());
    for (const user of Object.values(actors)) assert.ok(!JSON.stringify(rows).includes(user));
  });
  it("demoted/former admin loses roster authority", async () => {
    const id = (await membership(admin)).membership_id; await as(owner); await q(setSql, [community, id, "member"]); await as(admin); await denied(listSql, [community]);
    await q("select public.leave_community($1)", [community]); await denied(listSql, [community]);
  });
  for (const [time, id, limit] of [[null, missing, 20], ["2026-01-01", null, 20], ["infinity", missing, 20], [null, null, 0], [null, null, 51], [null, null, null]])
    it(`invalid roster cursor/limit ${time}/${id}/${limit}`, async () => { await as(owner); await denied("select * from public.list_community_members($1,$2,$3,$4)", [community, time, id, limit], "22023"); });
  it("default/max pagination, microseconds, tied times, deleted cursor and changing roster", async () => {
    for (let i = 0; i < 57; i++) { const user = randomUUID(); await q("insert into auth.users(id,email_confirmed_at) values($1,now())", [user]); await q("insert into public.community_memberships(community_id,user_id,role,created_at) values($1,$2,'member','2026-01-01 00:00:00.000004+00')", [community, user]); }
    await as(owner); assert.equal((await q(listSql, [community])).length, 20);
    assert.equal((await q("select * from public.list_community_members($1,null,null,50)", [community])).length, 50);
    const sql = "select membership_id,joined_at::text from public.list_community_members($1,$2,$3,2)";
    let time: unknown = null, id: unknown = null; const seen: unknown[] = [];
    while (true) { const page = await q(sql, [community, time, id]); if (!page.length) break; for (const row of page) { assert.ok(!seen.includes(row.membership_id)); seen.push(row.membership_id); } const last = page.at(-1)!; time = last.joined_at; id = last.membership_id; }
    assert.equal(seen.length, 62);
    const first = (await q("select membership_id,joined_at::text from public.list_community_members($1,null,null,2)", [community]))[1];
    assert.match(first.joined_at as string, /\.000002/);
    await root(); await q("delete from public.community_memberships where membership_id=$1", [first.membership_id]);
    await as(owner); const next = await q(sql, [community, first.joined_at, first.membership_id]); assert.match(next[0].joined_at as string, /\.000003/);
    await root(); await q("delete from public.community_memberships where membership_id=$1", [next[0].membership_id]);
    await as(owner); assert.equal((await q(sql, [community, first.joined_at, first.membership_id])).length, 2);
  });
  it("ordinary community safe reads work; owner UUID, discriminator and SELECT * fail", async () => {
    await as(member);
    assert.equal((await q("select id,name,slug,description,visibility,join_policy,created_at,updated_at from public.communities")).length, 1);
    for (const fields of ["*", "owner_user_id", "owner_role", "id,owner_user_id"]) await denied(`select ${fields} from public.communities`);
    assert.equal((await q("select * from public.get_community_landing('roles-tenant')"))[0].viewer_role, "member");
  });
  for (const actor of [owner, member, null]) it(`direct table writes/audit/helper access denied for ${actor ?? "anon"}`, async () => {
    await as(actor, actor ? "authenticated" : "anon");
    for (const sql of ["update public.community_memberships set role='admin'", "update public.community_memberships set management_display_name='bad'", `select * from ${auditTable}`, `select target_user_id from ${auditTable}`, `insert into ${auditTable} default values`, `update ${auditTable} set old_role='admin'`, `delete from ${auditTable}`, `truncate ${auditTable}`, `select public.mutate_community_member('${community}','${missing}','admin',false)`, "select public.guard_community_membership_identity()"])
      await denied(sql);
    if (!actor) for (const [sql, args] of [[listSql, [community]], [setSql, [community, missing, "member"]], [removeSql, [community, missing]], [nameSql, [community, missing, null]]] as const) await denied(sql, [...args]);
  });
  it("catalog: FORCE RLS, least privileges, four entry points, no owner/event access or column bypass", async () => {
    const table = (await q("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass", [auditTable]))[0];
    assert.deepEqual(table, { relrowsecurity: true, relforcerowsecurity: true });
    assert.equal((await q("select count(*)::int n from pg_policy where polrelid=$1::regclass", [auditTable]))[0].n, 0);
    for (const role of ["anon", "authenticated"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) assert.equal((await q("select has_table_privilege($1,$2,$3) ok", [role, auditTable, privilege]))[0].ok, false);
      for (const column of ["id", "community_id", "actor_user_id", "target_user_id", "target_membership_id", "old_role", "new_role", "occurred_at"])
        for (const privilege of ["SELECT", "INSERT", "UPDATE"]) assert.equal((await q("select has_column_privilege($1,$2,$3,$4) ok", [role, auditTable, column, privilege]))[0].ok, false);
      for (const fn of ["set_community_member_role(uuid,uuid,text)", "remove_community_member(uuid,uuid)", "set_my_community_management_name(uuid,uuid,text)", "list_community_members(uuid,timestamptz,uuid,integer)"])
        assert.equal((await q("select has_function_privilege($1,$2,'EXECUTE') ok", [role, `public.${fn}`]))[0].ok, role === "authenticated");
    }
    const fk = await q("select confrelid::regclass::text target,confdeltype from pg_constraint where conrelid=$1::regclass and contype='f'", [auditTable]);
    assert.deepEqual(fk, [{ target: "communities", confdeltype: "c" }]);
    assert.equal((await q("select has_table_privilege('authenticated','public.communities','SELECT') ok"))[0].ok, false);
    const functions = await q(`select proname,prosecdef,proconfig,pg_get_function_arguments(p.oid) args,
      exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute
      from pg_proc p where pronamespace='public'::regnamespace and proname in
      ('set_community_member_role','remove_community_member','set_my_community_management_name','list_community_members','mutate_community_member','guard_community_membership_identity')`);
    assert.equal(functions.length, 6);
    for (const fn of functions) { assert.equal(fn.public_execute, false); assert.deepEqual(fn.proconfig, ['search_path=""']); }
    for (const table of ["community_memberships", "communities", "community_member_management_events"]) {
      const security = (await q("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass", [`public.${table}`]))[0];
      assert.deepEqual(security, { relrowsecurity: true, relforcerowsecurity: true });
    }
    for (const column of ["role", "management_display_name", "membership_id", "community_id", "user_id", "created_at", "updated_at"])
      for (const privilege of ["INSERT", "UPDATE"])
        assert.equal((await q("select has_column_privilege('authenticated','public.community_memberships',$1,$2) ok", [column, privilege]))[0].ok, false);
  });
  it("own label column reads stay scoped to self; no other membership or profile disclosure", async () => {
    await q("update public.community_memberships set management_display_name='Chosen' where user_id=$1", [target]);
    await as(target); const rows = await q("select user_id,management_display_name from public.community_memberships");
    assert.deepEqual(rows, [{ user_id: target, management_display_name: "Chosen" }]);
    await as(owner); assert.equal((await q("select management_display_name from public.community_memberships where user_id=$1", [target])).length, 0);
  });
  it("audit community deletion cascades when trusted deletion resolves membership dependencies", async () => {
    const id = (await membership()).membership_id; await as(owner); await q(removeSql, [community, id]); await root();
    await q("delete from public.community_memberships where community_id=$1", [community]); await q("delete from public.communities where id=$1", [community]);
    await db.exec("set constraints all immediate"); assert.equal((await events()).length, 0);
  });
  for (const [sql, args] of [[setSql, [null, missing, "member"]], [setSql, [community, null, "member"]], [setSql, [community, missing, null]], [removeSql, [null, missing]], [nameSql, [community, null, "Name"]], [listSql, [null]]] as const)
    it(`null required argument rejected: ${sql}/${JSON.stringify(args)}`, async () => { await as(owner); await denied(sql, [...args], "22023"); });
  for (const mutation of ["old_role='owner'", "new_role='owner'", "new_role=old_role", "actor_user_id=target_user_id", "occurred_at='infinity'"])
    it(`audit constraint ${mutation}`, async () => {
      const id = (await membership()).membership_id; await as(owner); await q(setSql, [community, id, "moderator"]); await root();
      await denied(`update ${auditTable} set ${mutation}`, [], "23514");
    });
});
