import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const unverified = "33333333-3333-4333-8333-333333333333";
const banned = "44444444-4444-4444-8444-444444444444";
let db: PGlite;

// Real PostgreSQL grants, constraints, triggers, and RLS. Only Supabase's Auth
// schema/identity context is emulated; no hosted Auth behavior is claimed here.
describe("private profile migration and RLS", { concurrency: false }, () => {
  before(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (
        id uuid primary key, email_confirmed_at timestamptz, banned_until timestamptz,
        raw_user_meta_data jsonb default '{}'::jsonb,
        is_anonymous boolean default false, deleted_at timestamptz
      );
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      grant usage on schema public, auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      -- Supabase projects can grant exposed tables/functions by default. The
      -- migration must revoke these, not just pass on a restrictive blank DB.
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant execute on functions to anon, authenticated;
      insert into auth.users(id, email_confirmed_at) values ('${alice}', now());
    `);
    await db.exec(await readFile(new URL("../supabase/migrations/20260924000100_private_profiles.sql", import.meta.url), "utf8"));
    await db.query(`insert into auth.users(id, email_confirmed_at, banned_until) values
      ($1, now(), null), ($2, null, null), ($3, now(), now() + interval '1 day')`, [bob, unverified, banned]);
  });
  after(async () => { await db?.close(); });
  beforeEach(async () => { await db.exec("begin"); });
  afterEach(async () => { await db.exec("rollback"); });

  async function asUser(id: string | null, role = "authenticated") {
    assert.ok(["anon", "authenticated"].includes(role));
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id ?? ""]);
    await db.exec(`set local role ${role}`);
  }

  it("backfills existing users and creates rows for new users without copying metadata", async () => {
    const id = "55555555-5555-4555-8555-555555555555";
    await db.query("insert into auth.users(id, raw_user_meta_data) values ($1, $2)", [id, JSON.stringify({ user_id: alice, role: "admin", display_name: "Do not copy" })]);
    const result = await db.query<{ user_id: string; display_name: string | null }>("select user_id, display_name from public.private_profiles order by user_id");
    assert.equal(result.rows.length, 5);
    assert.ok(result.rows.every((row) => row.display_name === null));
    assert.equal(result.rows[0].user_id, alice);
  });

  it("permits a verified user to read and update only their own row", async () => {
    await asUser(alice);
    assert.deepEqual((await db.query("select user_id from public.private_profiles")).rows, [{ user_id: alice }]);
    const updated = await db.query("update public.private_profiles set display_name = 'Alice' where user_id = $1 returning display_name", [alice]);
    assert.deepEqual(updated.rows, [{ display_name: "Alice" }]);
  });

  it("blocks cross-user reads and writes, including an unfiltered update", async () => {
    await asUser(alice);
    assert.equal((await db.query("select * from public.private_profiles where user_id = $1", [bob])).rows.length, 0);
    assert.equal((await db.query("update public.private_profiles set display_name = 'Attacker' where user_id = $1 returning user_id", [bob])).rows.length, 0);
    assert.deepEqual((await db.query("update public.private_profiles set display_name = 'Own only' returning user_id")).rows, [{ user_id: alice }]);
  });

  it("denies anonymous access with table grants", async () => {
    await asUser(null, "anon");
    await assert.rejects(db.query("select * from public.private_profiles"), { code: "42501" });
  });

  for (const [name, id] of [["missing identity", null], ["unverified user", unverified], ["banned user", banned]] as const) {
    it(`denies reads and updates for ${name}`, async () => {
      await asUser(id);
      assert.equal((await db.query("select * from public.private_profiles")).rows.length, 0);
      assert.equal((await db.query("update public.private_profiles set display_name = 'No access' returning user_id")).rows.length, 0);
    });
  }

  for (const [name, sql] of [
    ["ownership changes", `update public.private_profiles set user_id = '${bob}' where user_id = '${alice}'`],
    ["timestamp changes", "update public.private_profiles set created_at = now()"],
    ["direct insertion", `insert into public.private_profiles(user_id) values ('${alice}')`],
    ["direct deletion", "delete from public.private_profiles"],
    ["direct Auth reads", "select * from auth.users"],
    ["truncate", "truncate public.private_profiles"],
  ]) {
    it(`denies ${name}`, async () => {
      await asUser(alice);
      await assert.rejects(db.query(sql), { code: "42501" });
    });
  }

  it("cannot invoke the provisioning function or inspect another user's verification", async () => {
    await asUser(alice);
    assert.deepEqual((await db.query("select public.is_private_profile_owner($1) as allowed", [bob])).rows, [{ allowed: false }]);
    assert.deepEqual((await db.query("select has_function_privilege(current_user, 'public.create_private_profile()', 'EXECUTE') as allowed")).rows, [{ allowed: false }]);
    assert.deepEqual((await db.query("select has_function_privilege(current_user, 'public.delete_private_profile()', 'EXECUTE') as allowed")).rows, [{ allowed: false }]);
  });

  it("enforces profile length at the database boundary", async () => {
    await asUser(alice);
    await assert.rejects(db.query("update public.private_profiles set display_name = $1", ["a".repeat(81)]), { code: "23514" });
  });

  it("cascades account deletion without leaving private data orphaned", async () => {
    await db.query("delete from auth.users where id = $1", [bob]);
    assert.equal((await db.query("select * from public.private_profiles where user_id = $1", [bob])).rows.length, 0);
  });

  it("removes private data on Auth soft deletion and denies the retained identity", async () => {
    await db.query("update auth.users set deleted_at = now() where id = $1", [alice]);
    assert.equal((await db.query("select * from public.private_profiles where user_id = $1", [alice])).rows.length, 0);
    await asUser(alice);
    assert.deepEqual((await db.query("select public.is_private_profile_owner($1) as allowed", [alice])).rows, [{ allowed: false }]);
  });

  it("denies an anonymous Auth identity even with an email confirmation timestamp", async () => {
    await db.query("update auth.users set is_anonymous = true where id = $1", [alice]);
    await asUser(alice);
    assert.equal((await db.query("select * from public.private_profiles")).rows.length, 0);
    assert.equal((await db.query("update public.private_profiles set display_name = 'Denied' returning user_id")).rows.length, 0);
  });

  it("uses current verification and ban state even with the same JWT identity", async () => {
    await asUser(alice);
    assert.equal((await db.query("select * from public.private_profiles")).rows.length, 1);
    await db.exec("reset role");
    await db.query("update auth.users set banned_until = now() + interval '1 day' where id = $1", [alice]);
    await asUser(alice);
    assert.equal((await db.query("select * from public.private_profiles")).rows.length, 0);
    await db.exec("reset role");
    await db.query("update auth.users set banned_until = now() - interval '1 day' where id = $1", [alice]);
    await asUser(alice);
    assert.equal((await db.query("select * from public.private_profiles")).rows.length, 1);
    await db.exec("reset role");
    await db.query("update auth.users set email_confirmed_at = null where id = $1", [alice]);
    await asUser(alice);
    assert.equal((await db.query("select * from public.private_profiles")).rows.length, 0);
  });
});
