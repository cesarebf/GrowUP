import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const unverified = "33333333-3333-4333-8333-333333333333";
let db: PGlite;
let publicId: string;
let privateId: string;
let bobId: string;

// Actual PostgreSQL migration, privileges, RLS, triggers and constraints.
// Supabase Auth/JWT plumbing is emulated, as in the profile isolation suite.
describe("community database security and invariants", { concurrency: false }, () => {
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
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant execute on functions to anon, authenticated;
    `);
    for (const migration of ["20260924000100_private_profiles.sql", "20260928000100_community_foundation.sql", "20260928000200_community_join_leave.sql", "20260928000300_community_settings.sql", "20260929140004_community_membership_requests.sql"]) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
    }
    await db.query("insert into auth.users(id, email_confirmed_at) values ($1, now()), ($2, now()), ($3, null)", [alice, bob, unverified]);
  });
  after(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("begin");
    await asUser(alice);
    publicId = await create("alice-public", "public");
    privateId = await create("alice-private", "private");
    await create("alice-unlisted", "unlisted");
    await asUser(bob);
    bobId = await create("bob-private", "private");
    await db.exec("reset role; set constraints all immediate; set constraints all deferred");
  });
  afterEach(async () => { await db.exec("rollback"); });

  async function asUser(id: string | null, role = "authenticated") {
    assert.ok(["anon", "authenticated"].includes(role));
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id ?? ""]);
    await db.exec(`set local role ${role}`);
  }
  async function create(slug: string, visibility = "private", policy = "invitation_only") {
    const result = await db.query<{ id: string }>(
      "select public.create_community('Community', $1, 'Short description', $2, $3) as id", [slug, visibility, policy]);
    return result.rows[0].id;
  }
  async function denied(sql: string, params: unknown[] = [], code = "42501") {
    await db.exec("savepoint denied_operation");
    await assert.rejects(db.query(sql, params), { code });
    await db.exec("rollback to savepoint denied_operation; release savepoint denied_operation");
  }
  async function landing(slug: string) {
    return (await db.query<{ id: string; name: string; slug: string; description: string; visibility: string; join_policy: string; viewer_role: string | null }>("select * from public.get_community_landing($1)", [slug])).rows;
  }
  async function addMember(communityId: string, role = "member") {
    await db.exec("reset role");
    await db.query("insert into public.community_memberships(community_id, user_id, role) values ($1, $2, $3)", [communityId, bob, role]);
  }

  async function join(id: string) {
    return db.query("select public.join_community($1) as slug", [id]);
  }
  async function leave(id: string) {
    return db.query("select public.leave_community($1)", [id]);
  }

  const settings = { name: " Updated name ", description: " Updated description ", visibility: "public", join_policy: "instant" };
  const updateSql = "select public.update_community_settings($1, $2::jsonb) as slug";
  async function updateSettings(id: string, input: unknown = settings) {
    return db.query(updateSql, [id, JSON.stringify(input)]);
  }

  it("lets the owner update only settings, preserving slug, ownership, other tenants and every membership", async () => {
    await addMember(publicId, "admin");
    const before = (await db.query<Record<string, unknown>>("select * from public.communities order by id")).rows;
    const memberships = (await db.query("select * from public.community_memberships order by community_id, user_id")).rows;
    await asUser(alice);
    assert.deepEqual((await updateSettings(publicId)).rows, [{ slug: "alice-public" }]);
    // Repetition has no membership side effects.
    await updateSettings(publicId);
    await db.exec("reset role");
    const after = (await db.query("select * from public.communities order by id")).rows;
    assert.deepEqual(after, before.map((row) => row.id === publicId ? {
      ...row, name: "Updated name", description: "Updated description", visibility: "public", join_policy: "instant",
    } : row)); // now() is constant within this test transaction.
    assert.deepEqual((await db.query("select * from public.community_memberships order by community_id, user_id")).rows, memberships);
    await db.exec("set constraints all immediate");
  });

  for (const role of ["member", "moderator", "admin"]) {
    it(`denies settings updates by ${role}, even when they own another community`, async () => {
      await addMember(publicId, role);
      await asUser(bob);
      await denied(updateSql, [publicId, JSON.stringify(settings)]);
      assert.equal((await landing("alice-public"))[0].name, "Community");
    });
  }
  it("denies another owner across public/private tenants and does not disclose missing targets", async () => {
    await asUser(bob);
    const messages: string[] = [];
    for (const id of [publicId, privateId, null, "99999999-9999-4999-8999-999999999999"]) {
      await db.exec("savepoint settings_probe");
      await assert.rejects(updateSettings(id as string), (error: Error & { code?: string }) => {
        assert.equal(error.code, "42501");
        messages.push(error.message);
        return true;
      });
      await db.exec("rollback to savepoint settings_probe; release savepoint settings_probe");
    }
    assert.equal(new Set(messages).size, 1);
    await updateSettings(bobId); // Owning one tenant never grants another.
  });
  for (const [label, id, role] of [["anonymous", null, "anon"], ["missing identity", null, "authenticated"], ["unverified", unverified, "authenticated"]] as const) {
    it(`denies ${label} settings updates`, async () => {
      await asUser(id, role);
      await denied(updateSql, [publicId, JSON.stringify(settings)]);
    });
  }
  for (const state of ["banned_until = now() + interval '1 day'", "email_confirmed_at = null", "is_anonymous = true", "deleted_at = now()"]) {
    it(`rechecks settings owner's account eligibility: ${state}`, async () => {
      // Owner deletion is otherwise blocked; emulate a preexisting invalid
      // account to verify the RPC's defense independently of that trigger.
      if (state.startsWith("deleted_at")) await db.exec("alter table auth.users disable trigger auth_user_community_owner_soft_delete");
      await db.query(`update auth.users set ${state} where id = $1`, [alice]);
      await asUser(alice);
      await denied(updateSql, [publicId, JSON.stringify(settings)]);
    });
  }
  it("rechecks current ownership after a previously authorized owner loses ownership", async () => {
    await addMember(publicId);
    await asUser(alice);
    await updateSettings(publicId);
    // Privileged fixture transfer only; no transfer endpoint is introduced.
    await db.exec("reset role");
    await db.query("update public.community_memberships set role = 'admin' where community_id = $1 and user_id = $2", [publicId, alice]);
    await db.query("update public.community_memberships set role = 'owner' where community_id = $1 and user_id = $2", [publicId, bob]);
    await db.query("update public.communities set owner_user_id = $1 where id = $2", [bob, publicId]);
    await db.exec("set constraints all immediate");
    await asUser(alice);
    await denied(updateSql, [publicId, JSON.stringify(settings)]);
    await asUser(bob);
    await updateSettings(publicId);
  });

  it("rejects forged identity, ownership, slug, tenant, role and unknown settings fields atomically", async () => {
    await asUser(alice);
    for (const key of ["owner_user_id", "user_id", "slug", "id", "community_id", "role", "owner_role", "unexpected"]) {
      await denied(updateSql, [publicId, JSON.stringify({ ...settings, [key]: bob })], "22023");
    }
    await denied("select public.update_community_settings(p_community_id => $1::uuid, p_settings => $2::jsonb, owner_user_id => $3::uuid)", [publicId, JSON.stringify(settings), bob], "42883");
    const current = (await landing("alice-public"))[0];
    assert.equal(current.name, "Community");
    assert.equal(current.slug, "alice-public");
    assert.equal(current.viewer_role, "owner");
    await asUser(bob);
    await denied(updateSql, [publicId, JSON.stringify({ ...settings, owner_user_id: alice })]);
  });
  it("rejects nonobject, missing and wrongly typed settings instead of coercing them", async () => {
    await asUser(alice);
    for (const input of [null, [], "name", 42, true, {}, ...["name", "description", "visibility", "join_policy"].flatMap((key) =>
      [null, 42, true, [], {}].map((value) => ({ ...settings, [key]: value })))]) {
      await denied(updateSql, [publicId, JSON.stringify(input)], "22023");
    }
    await denied(updateSql, [publicId, null], "22023");
    for (const key of ["name", "visibility", "join_policy"]) {
      const input: Record<string, string> = { ...settings };
      delete input[key];
      await denied(updateSql, [publicId, JSON.stringify(input)], "22023");
    }
    assert.equal((await landing("alice-public"))[0].name, "Community");
  });
  for (const [key, values] of [
    ["name", ["", "   ", "x".repeat(81), "bad\nname", "\tName", "Name\u007f"]],
    ["description", ["x".repeat(501), "bad\tdescription", "description\n"]],
    ["visibility", ["", "secret", "PUBLIC", "public "]],
    ["join_policy", ["", "paid", "INSTANT", "instant "]],
  ] as const) {
    it(`rejects malformed ${key} and leaves every setting unchanged`, async () => {
      await asUser(alice);
      const before = await landing("alice-public");
      for (const value of values) {
        await denied(updateSql, [publicId, JSON.stringify({ ...settings, [key]: value })], "23514");
        assert.deepEqual(await landing("alice-public"), before);
      }
    });
  }
  it("accepts boundary Unicode text and clears an omitted or empty optional description", async () => {
    await asUser(alice);
    await updateSettings(publicId, { ...settings, name: "🌱".repeat(80), description: "🌱".repeat(500) });
    assert.equal((await landing("alice-public"))[0].description, "🌱".repeat(500));
    await updateSettings(publicId, { name: "Name", visibility: "public", join_policy: "instant" });
    assert.equal((await landing("alice-public"))[0].description, "");
    await updateSettings(publicId, { ...settings, description: "   " });
    assert.equal((await landing("alice-public"))[0].description, "");
  });

  for (const visibility of ["public", "unlisted", "private"]) {
    for (const join_policy of ["instant", "approval_required", "invitation_only"]) {
      it(`settings can store ${visibility} + ${join_policy} without removing members or admitting ineligible new joins`, async () => {
        await addMember(publicId, "moderator");
        const before = (await db.query("select * from public.community_memberships order by community_id, user_id")).rows;
        await asUser(alice);
        await updateSettings(publicId); // Start at public + instant.
        await updateSettings(publicId, { ...settings, visibility, join_policy });
        assert.equal((await landing("alice-public"))[0].visibility, visibility);
        await asUser(bob);
        assert.equal((await landing("alice-public"))[0].viewer_role, "moderator");
        await join(publicId); // Existing members retain their roles.
        await db.exec("reset role");
        assert.deepEqual((await db.query("select * from public.community_memberships order by community_id, user_id")).rows, before);
        await db.query("update auth.users set email_confirmed_at = now() where id = $1", [unverified]);
        await asUser(unverified);
        if (visibility === "private") assert.deepEqual(await landing("alice-public"), []);
        if (visibility !== "private" && join_policy === "instant") await join(publicId);
        else await denied("select public.join_community($1)", [publicId]);
      });
    }
  }
  it("restricts settings EXECUTE and definer scope while retaining table write denial", async () => {
    const rows = (await db.query<{ proconfig: string[]; prosecdef: boolean; args: string }>(`select proconfig, prosecdef, pg_get_function_arguments(oid) as args
      from pg_proc where pronamespace = 'public'::regnamespace and proname = 'update_community_settings'`)).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].prosecdef, true);
    assert.ok(rows[0].proconfig.includes('search_path=""'));
    assert.equal(rows[0].args, "p_community_id uuid, p_settings jsonb");
    assert.deepEqual((await db.query("select has_function_privilege('anon', 'public.update_community_settings(uuid,jsonb)', 'EXECUTE') as anon, has_function_privilege('authenticated', 'public.update_community_settings(uuid,jsonb)', 'EXECUTE') as authenticated")).rows, [{ anon: false, authenticated: true }]);
    await asUser(alice);
    await denied("update public.communities set name = 'Direct update' where id = $1", [publicId]);
    await denied("update public.communities set slug = 'changed-slug' where id = $1", [publicId]);
    await denied("update public.communities set owner_user_id = $1 where id = $2", [bob, publicId]);
  });

  for (const visibility of ["public", "unlisted", "private"]) {
    for (const policy of ["instant", "approval_required", "invitation_only"]) {
      it(`enforces admission for ${visibility} + ${policy}`, async () => {
        await asUser(alice);
        const id = await create("admission-target", visibility, policy);
        await asUser(bob);
        if (visibility !== "private" && policy === "instant") {
          assert.deepEqual((await join(id)).rows, [{ slug: "admission-target" }]);
          assert.deepEqual((await db.query("select user_id, role from public.community_memberships where community_id = $1", [id])).rows, [{ user_id: bob, role: "member" }]);
          assert.equal((await landing("admission-target"))[0].viewer_role, "member");
        } else {
          await denied("select public.join_community($1)", [id]);
          assert.deepEqual((await db.query("select * from public.community_memberships where community_id = $1", [id])).rows, []);
        }
        await db.exec("reset role");
        assert.deepEqual((await db.query("select visibility, join_policy from public.communities where id = $1", [id])).rows, [{ visibility, join_policy: policy }]);
      });
    }
  }

  for (const [label, id, role] of [["anonymous", null, "anon"], ["missing identity", null, "authenticated"], ["unverified", unverified, "authenticated"]] as const) {
    it(`denies ${label} join and leave`, async () => {
      await asUser(id, role);
      for (const fn of ["join_community", "leave_community"]) await denied(`select public.${fn}($1)`, [publicId]);
    });
  }
  for (const state of ["banned_until = now() + interval '1 day'", "email_confirmed_at = null", "is_anonymous = true", "deleted_at = now()"]) {
    it(`rechecks current eligibility on join, existing-member retry, and leave: ${state}`, async () => {
      await asUser(alice);
      const id = await create("eligibility-target", "public", "instant");
      // The unverified fixture owns no community, so soft deletion is legal.
      await db.exec("reset role");
      await db.query("update auth.users set email_confirmed_at = now() where id = $1", [unverified]);
      await db.query("insert into public.community_memberships(community_id, user_id, role) values ($1, $2, 'member')", [privateId, unverified]);
      await db.query(`update auth.users set ${state} where id = $1`, [unverified]);
      await asUser(unverified);
      await denied("select public.join_community($1)", [id]);
      await denied("select public.join_community($1)", [privateId]);
      await denied("select public.leave_community($1)", [privateId]);
    });
  }
  it("rechecks admission changes between page read and join", async () => {
    await asUser(alice);
    const id = await create("changed-admission", "public", "instant");
    await asUser(bob);
    assert.equal((await landing("changed-admission"))[0].join_policy, "instant");
    await db.exec("reset role");
    await db.query("update public.communities set join_policy = 'approval_required' where id = $1", [id]);
    await asUser(bob);
    await denied("select public.join_community($1)", [id]);
    await db.exec("reset role");
    await db.query("update public.communities set join_policy = 'instant', visibility = 'private' where id = $1", [id]);
    await asUser(bob);
    await denied("select public.join_community($1)", [id]);
  });
  it("keeps one membership under concurrent submissions and repeated join/leave calls", async () => {
    await asUser(alice);
    const id = await create("retry-target", "public", "instant");
    await asUser(bob);
    // PGlite queues these concurrent submissions on one backend. This verifies
    // retry/uniqueness behavior, not independent PostgreSQL session lock races.
    await Promise.all(Array.from({ length: 8 }, () => join(id)));
    assert.deepEqual((await db.query("select role from public.community_memberships where community_id = $1", [id])).rows, [{ role: "member" }]);
    await Promise.all([leave(id), leave(id)]);
    assert.equal((await db.query("select * from public.community_memberships where community_id = $1", [id])).rows.length, 0);
    await Promise.all([join(id), leave(id)]);
    assert.equal((await db.query("select * from public.community_memberships where community_id = $1", [id])).rows.length, 0);
    await Promise.all([leave(id), join(id)]);
    assert.equal((await db.query("select * from public.community_memberships where community_id = $1", [id])).rows.length, 1);
  });
  for (const role of ["member", "moderator", "admin"]) {
    it(`preserves current ${role} on join, deletes on leave, and rejoins only as member`, async () => {
      await asUser(alice);
      const id = await create("rejoin-target", "public", "instant");
      await addMember(id, role);
      await asUser(bob);
      await join(id);
      assert.deepEqual((await db.query("select role from public.community_memberships where community_id = $1", [id])).rows, [{ role }]);
      await leave(id);
      assert.equal((await landing("rejoin-target"))[0].viewer_role, null);
      assert.equal((await db.query("select * from public.communities where id = $1", [id])).rows.length, 0);
      await join(id);
      assert.equal((await landing("rejoin-target"))[0].viewer_role, "member");
    });
    it(`allows ${role} to leave a private invitation-only community and revokes access`, async () => {
      await addMember(privateId, role);
      await asUser(bob);
      assert.equal((await landing("alice-private"))[0].viewer_role, role);
      // Already-current join is a no-op even when admission is closed.
      await join(privateId);
      assert.equal((await landing("alice-private"))[0].viewer_role, role);
      await leave(privateId);
      await leave(privateId);
      assert.deepEqual(await landing("alice-private"), []);
      assert.deepEqual((await db.query("select * from public.communities where id = $1", [privateId])).rows, []);
      assert.deepEqual((await db.query("select * from public.community_memberships where community_id = $1", [privateId])).rows, []);
      await denied("select public.join_community($1)", [privateId]);
      assert.equal((await landing("bob-private"))[0].viewer_role, "owner");
    });
  }
  it("allows leave after admission changes to approval-required", async () => {
    await addMember(publicId);
    await db.query("update public.communities set join_policy = 'approval_required' where id = $1", [publicId]);
    await asUser(bob);
    await leave(publicId);
    assert.equal((await landing("alice-public"))[0].viewer_role, null);
  });
  it("preserves the owner on join and denies owner leave without orphaning", async () => {
    await asUser(alice);
    await join(privateId);
    await denied("select public.leave_community($1)", [privateId]);
    assert.equal((await landing("alice-private"))[0].viewer_role, "owner");
    await db.exec("set constraints all immediate");
  });
  it("does not distinguish private/nonexistent join failures or absent leave results", async () => {
    await asUser(bob);
    const messages: string[] = [];
    for (const id of [privateId, "99999999-9999-4999-8999-999999999999", null]) {
      await db.exec("savepoint private_probe");
      await assert.rejects(db.query("select public.join_community($1)", [id]), (error: Error & { code?: string }) => {
        assert.equal(error.code, "42501");
        messages.push(error.message);
        return true;
      });
      await db.exec("rollback to savepoint private_probe; release savepoint private_probe");
      assert.deepEqual((await db.query("select public.leave_community($1) as result", [id])).rows, [{ result: "" }]);
    }
    assert.equal(new Set(messages).size, 1);
  });
  it("accepts only a community locator, denying forged users/roles and cross-community effects", async () => {
    await addMember(privateId, "admin");
    await asUser(bob);
    for (const fn of ["join_community", "leave_community"]) {
      await denied(`select public.${fn}($1::uuid, $2::uuid)`, [privateId, alice], "42883");
      await denied(`select public.${fn}(p_community_id => $1::uuid, p_user_id => $2::uuid)`, [privateId, alice], "42883");
      await denied(`select public.${fn}(p_community_id => $1::uuid, p_role => 'owner'::text)`, [privateId], "42883");
    }
    await leave(publicId); // No membership here: cannot affect privateId or Alice.
    assert.equal((await landing("alice-private"))[0].viewer_role, "admin");
    await leave(privateId);
    assert.equal((await landing("bob-private"))[0].viewer_role, "owner");
    await db.exec("reset role");
    assert.deepEqual((await db.query("select role from public.community_memberships where user_id = $1 and community_id = $2", [alice, privateId])).rows, [{ role: "owner" }]);
  });
  it("restricts join/leave execution and locks definer scope without extra arguments", async () => {
    const rows = (await db.query<{ proname: string; proconfig: string[]; prosecdef: boolean; args: string }>(`select proname, proconfig, prosecdef, pg_get_function_arguments(oid) as args
      from pg_proc where pronamespace = 'public'::regnamespace and proname in ('join_community', 'leave_community')`)).rows;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.prosecdef, true);
      assert.ok(row.proconfig.includes('search_path=""'));
      assert.equal(row.args, "p_community_id uuid");
      assert.deepEqual((await db.query("select has_function_privilege('anon', $1, 'EXECUTE') as anon, has_function_privilege('authenticated', $1, 'EXECUTE') as authenticated", [`public.${row.proname}(uuid)`])).rows, [{ anon: false, authenticated: true }]);
    }
  });

  it("creates multiple communities with UUIDs and exactly one matching owner membership atomically", async () => {
    await asUser(alice);
    assert.match(publicId, /^[0-9a-f-]{36}$/);
    const communities = (await db.query<{ id: string; owner_user_id: string }>("select id, owner_user_id from public.communities")).rows;
    assert.equal(communities.length, 3);
    assert.ok(communities.every((row) => row.owner_user_id === alice));
    const memberships = (await db.query<{ user_id: string; role: string }>("select user_id, role from public.community_memberships")).rows;
    assert.equal(memberships.length, 3);
    assert.ok(memberships.every((row) => row.user_id === alice && row.role === "owner"));
    await db.exec("set constraints all immediate");
  });

  it("rolls back community insertion if owner membership insertion fails", async () => {
    await db.exec(`create function public.reject_test_membership() returns trigger language plpgsql as $$
      begin raise exception 'Test failure' using errcode = '23514'; end; $$;
      create trigger reject_test_membership before insert on public.community_memberships
      for each row execute function public.reject_test_membership();`);
    await asUser(alice);
    await denied("select public.create_community('Failed', 'failed-create', '', 'private', 'instant')", [], "23514");
    await db.exec("reset role");
    assert.equal((await db.query("select * from public.communities where slug = 'failed-create'")).rows.length, 0);
  });

  for (const [label, id, role] of [["anonymous", null, "anon"], ["missing identity", null, "authenticated"], ["unverified", unverified, "authenticated"]] as const) {
    it(`denies ${label} creation`, async () => {
      await asUser(id, role);
      await denied("select public.create_community('No', 'denied-create', '', 'private', 'instant')");
    });
  }

  it("normalizes URL case/outer spaces and denies duplicate slugs without extra memberships", async () => {
    await asUser(bob);
    await denied("select public.create_community('Duplicate', ' ALICE-PUBLIC ', '', 'public', 'instant')", [], "23505");
    assert.equal((await db.query("select * from public.community_memberships")).rows.length, 1);
  });

  for (const [visibility, policy] of [["", "instant"], ["secret", "instant"], ["public", ""], ["public", "paid"]]) {
    it(`rejects invalid visibility/policy ${JSON.stringify([visibility, policy])}`, async () => {
      await asUser(alice);
      await denied("select public.create_community('Bad', 'bad-config', '', $1, $2)", [visibility, policy], "23514");
    });
  }
  it("requires explicit non-null visibility and join policy at the database boundary", async () => {
    await asUser(alice);
    await denied("select public.create_community('Bad', 'bad-config', '', null, 'instant')", [], "23502");
    await denied("select public.create_community('Bad', 'bad-config', '', 'private', null)", [], "23502");
    const defaults = await db.query<{ column_default: string | null }>("select column_default from information_schema.columns where table_name = 'communities' and column_name in ('visibility', 'join_policy')");
    assert.equal(defaults.rows.length, 2);
    assert.ok(defaults.rows.every((row) => row.column_default === null));
  });

  it("stores all nine configuration combinations without admitting nonowners", async () => {
    await asUser(alice);
    for (const visibility of ["public", "unlisted", "private"]) {
      for (const policy of ["instant", "approval_required", "invitation_only"]) {
        await create(`${visibility}-${policy.replaceAll("_", "-")}`, visibility, policy);
      }
    }
    assert.ok((await db.query<{ role: string }>("select role from public.community_memberships")).rows.every((row) => row.role === "owner"));
    await db.exec("set constraints all immediate");
  });

  for (const slug of ["ab", "a".repeat(49), "a/b", "../escape", "abc%2fdef", "abc--def", "-abc", "abc-", "admin", "settings", "héllo", "abc\n"]) {
    it(`enforces the database slug constraint: ${JSON.stringify(slug)}`, async () => {
      await asUser(alice);
      await denied("select public.create_community('Bad', $1, '', 'private', 'instant')", [slug], "23514");
    });
  }
  it("enforces name and description constraints on direct RPC calls", async () => {
    await asUser(alice);
    for (const [name, description] of [["", ""], ["a".repeat(81), ""], ["Bad\nname", ""], ["Name", "a".repeat(501)], ["Name", "bad\tdescription"]]) {
      await denied("select public.create_community($1, 'bad-input', $2, 'public', 'instant')", [name, description], "23514");
    }
  });

  for (const [label, id, role] of [["anonymous", null, "anon"], ["authenticated nonmember", bob, "authenticated"]] as const) {
    it(`restricts ${label} landings to exact public/unlisted metadata`, async () => {
      await asUser(id, role);
      for (const visibility of ["public", "unlisted"]) {
        const rows = await landing(`alice-${visibility}`);
        assert.equal(rows.length, 1);
        assert.deepEqual(Object.keys(rows[0]).sort(), ["id", "name", "slug", "description", "visibility", "join_policy", "viewer_role"].sort());
        assert.equal(rows[0].viewer_role, null);
        assert.equal(rows[0].visibility, visibility);
      }
      assert.deepEqual(await landing("alice-private"), []);
      assert.deepEqual(await landing("nonexistent"), []);
      assert.deepEqual(await landing("%"), []);
      assert.deepEqual(await landing("alice-"), []);
    });
  }
  it("does not grant anonymous base-table access or function write access", async () => {
    await asUser(null, "anon");
    await denied("select * from public.communities");
    await denied("select * from public.community_memberships");
  });
  it("reads only own memberships and member communities, even with unfiltered queries", async () => {
    await addMember(privateId);
    await asUser(bob);
    const rows = (await db.query<{ community_id: string; user_id: string }>("select community_id, user_id from public.community_memberships order by community_id")).rows;
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.user_id === bob));
    assert.equal((await db.query("select * from public.communities")).rows.length, 2);
    assert.equal((await db.query("select * from public.communities where id = $1", [publicId])).rows.length, 0);
    assert.equal((await landing("alice-private"))[0].viewer_role, "member");
    assert.equal((await db.query("select * from public.private_profiles where user_id = $1", [alice])).rows.length, 0);
  });

  for (const role of ["member", "moderator", "admin", "owner"]) {
    it(`denies ${role} role escalation, cross-user/cross-tenant mutation, ownership forging, and deletion`, async () => {
      if (role !== "owner") await addMember(privateId, role);
      await asUser(role === "owner" ? alice : bob);
      await denied("update public.community_memberships set role = 'owner' where user_id = $1", [bob]);
      await denied("update public.community_memberships set role = 'member' where user_id = $1", [alice]);
      await denied("update public.community_memberships set community_id = $1 where community_id = $2", [bobId, privateId]);
      await denied("update public.communities set owner_user_id = $1 where id = $2", [bob, privateId]);
      await denied("update public.communities set visibility = 'public' where id = $1", [bobId]);
      await denied("delete from public.community_memberships where community_id = $1", [privateId]);
      await denied("delete from public.communities where id = $1", [privateId]);
      await denied("insert into public.community_memberships(community_id, user_id, role) values ($1, $2, 'owner')", [publicId, bob]);
      await denied("insert into public.communities(owner_user_id, name, slug, visibility, join_policy) values ($1, 'Forged', 'forged-owner', 'public', 'instant')", [alice]);
      await denied("truncate public.community_memberships");
    });
  }
  it("denies writes with RLS even if table DML grants are accidentally broadened", async () => {
    await db.exec("grant insert, update, delete on public.communities, public.community_memberships to authenticated");
    await asUser(alice);
    assert.deepEqual((await db.query("update public.community_memberships set role = 'admin' returning *")).rows, []);
    assert.deepEqual((await db.query("delete from public.community_memberships returning *")).rows, []);
    assert.deepEqual((await db.query("update public.communities set visibility = 'public' returning *")).rows, []);
    assert.deepEqual((await db.query("delete from public.communities returning *")).rows, []);
    await denied("insert into public.community_memberships(community_id, user_id, role) values ($1, $2, 'member')", [bobId, alice]);
    await denied("insert into public.communities(owner_user_id, name, slug, visibility, join_policy) values ($1, 'Forged', 'forged-owner', 'public', 'instant')", [alice]);
  });

  it("revokes private access immediately when a nonowner membership is removed", async () => {
    await addMember(privateId);
    await asUser(bob);
    assert.equal((await landing("alice-private")).length, 1);
    await db.exec("reset role");
    await db.query("delete from public.community_memberships where community_id = $1 and user_id = $2", [privateId, bob]);
    await asUser(bob);
    assert.deepEqual(await landing("alice-private"), []);
  });
  for (const state of ["banned_until = now() + interval '1 day'", "email_confirmed_at = null", "is_anonymous = true"]) {
    it(`rechecks current account eligibility: ${state}`, async () => {
      await db.query(`update auth.users set ${state} where id = $1`, [alice]);
      await asUser(alice);
      assert.deepEqual((await db.query("select * from public.community_memberships")).rows, []);
      assert.deepEqual((await db.query("select * from public.communities")).rows, []);
      assert.deepEqual(await landing("alice-private"), []);
      assert.equal((await landing("alice-public"))[0].viewer_role, null);
      await denied("select public.create_community('Denied', 'denied-user', '', 'public', 'instant')");
    });
  }
  it("denies soft-deleted accounts without changing Auth/profile privacy behavior", async () => {
    await db.query("update auth.users set deleted_at = now() where id = $1", [unverified]);
    await asUser(unverified);
    await denied("select public.create_community('Denied', 'deleted-user', '', 'public', 'instant')");
    assert.deepEqual((await db.query("select * from public.community_memberships")).rows, []);
  });

  it("prevents ownerless communities, owner role removal, and mismatched owners even for privileged SQL", async () => {
    await db.exec("set constraints all immediate");
    await denied("insert into public.communities(owner_user_id, name, slug, visibility, join_policy) values ($1, 'Orphan', 'orphan-community', 'private', 'instant')", [alice], "23503");
    await denied("delete from public.community_memberships where community_id = $1", [privateId], "23503");
    await denied("update public.community_memberships set role = 'admin' where community_id = $1", [privateId], "23503");
    await denied("update public.communities set owner_user_id = $1 where id = $2", [bob, privateId], "23503");
    await denied("update public.communities set owner_user_id = null where id = $1", [privateId], "23502");
    await denied("insert into public.community_memberships(community_id, user_id, role) values ($1, $2, 'owner')", [privateId, bob], "23505");
  });
  it("checks deferred ownership at the transaction boundary", async () => {
    await db.exec("savepoint invalid_owner");
    await db.query("delete from public.community_memberships where community_id = $1", [privateId]);
    await assert.rejects(db.exec("set constraints all immediate"), { code: "23503" });
    await db.exec("rollback to savepoint invalid_owner; release savepoint invalid_owner");
  });
  it("has tenant-safe owner references and one membership per user/community", async () => {
    await db.exec("set constraints all immediate");
    await denied("update public.communities set owner_user_id = $1 where id = $2", [bob, privateId], "23503");
    await denied("insert into public.community_memberships(community_id, user_id, role) values ($1, $2, 'member')", [privateId, alice], "23505");
    await denied("insert into public.community_memberships(community_id, user_id, role) values ($1, $2, 'platform_admin')", [privateId, bob], "23514");
    await denied("insert into public.community_memberships(community_id, user_id, role) values (gen_random_uuid(), $1, 'member')", [bob], "23503");
  });
  it("blocks hard and soft deletion of owners, while retaining normal nonowner deletion", async () => {
    await denied("delete from auth.users where id = $1", [alice], "23001");
    await denied("update auth.users set deleted_at = now() where id = $1", [alice], "23514");
    assert.equal((await db.query("select * from public.private_profiles where user_id = $1", [alice])).rows.length, 1);
    await db.query("insert into public.community_memberships(community_id, user_id, role) values ($1, $2, 'member')", [privateId, unverified]);
    await db.query("delete from auth.users where id = $1", [unverified]);
    assert.deepEqual((await db.query("select * from public.community_memberships where user_id = $1", [unverified])).rows, []);
    await db.exec("set constraints all immediate");
  });
  it("can represent a future atomic transfer without exposing a transfer endpoint", async () => {
    await addMember(privateId);
    await db.query("update public.community_memberships set role = 'admin' where community_id = $1 and user_id = $2", [privateId, alice]);
    await db.query("update public.community_memberships set role = 'owner' where community_id = $1 and user_id = $2", [privateId, bob]);
    await db.query("update public.communities set owner_user_id = $1 where id = $2", [bob, privateId]);
    await db.exec("set constraints all immediate");
  });
  it("locks definer search paths and denies direct trigger execution", async () => {
    const functions = await db.query<{ proname: string; proconfig: string[] }>(`select proname, proconfig from pg_proc
      where pronamespace = 'public'::regnamespace and proname in ('create_community', 'get_community_landing', 'prevent_community_owner_soft_delete')`);
    assert.equal(functions.rows.length, 3);
    assert.ok(functions.rows.every((row) => row.proconfig.includes('search_path=""')));
    await asUser(alice);
    for (const fn of ["public.prevent_community_owner_soft_delete()", "public.community_set_updated_at()"]) {
      assert.deepEqual((await db.query("select has_function_privilege(current_user, $1, 'EXECUTE') as allowed", [fn])).rows, [{ allowed: false }]);
    }
    await denied("select * from auth.users");
  });
});
