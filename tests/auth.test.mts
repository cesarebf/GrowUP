import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";
import { AuthenticationRequired, getVerifiedUser, readPrivateProfile, signOut, submitAuth, updatePrivateProfile, type Client } from "../src/lib/auth/service.ts";
import { ConfigurationError, parseOrigin, parseSupabaseConfig } from "../src/lib/supabase/config.ts";
import { isTokenHash, parseConfirmation } from "../src/lib/auth/confirmation.ts";

const user: User = {
  id: "user-a", email_confirmed_at: "2026-09-24T00:00:00Z", is_anonymous: false,
  app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-09-24T00:00:00Z",
};
const origin = "https://growup.example";
function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}
function fakeClient(auth: Record<string, unknown> = {}, from?: unknown) {
  return { auth: { getUser: async () => ({ data: { user }, error: null }), ...auth }, from } as unknown as Client;
}
const credentials = { email: "member@example.com", password: "A long example password", confirmPassword: "A long example password" };

describe("auth configuration", () => {
  it("requires explicit configuration and rejects privileged credentials", () => {
    assert.throws(() => parseSupabaseConfig(undefined, undefined), ConfigurationError);
    for (const key of ["sb_secret_test", "eyJhbGciOiJIUzI1NiJ9.service_role.signature", ""]) {
      assert.throws(() => parseSupabaseConfig("https://project.supabase.co", key), ConfigurationError);
    }
    assert.equal(parseSupabaseConfig("https://project.supabase.co", "sb_publishable_test_fixture").url, "https://project.supabase.co");
  });
  it("rejects unsafe redirect origins and permits explicit localhost development", () => {
    for (const value of [undefined, "//evil.example", "javascript:alert(1)", "http://remote.example", "https://user:pass@example.com", "https://example.com/path", "https://example.com?next=evil"]) {
      assert.throws(() => parseOrigin(value), ConfigurationError);
    }
    assert.equal(parseOrigin("http://localhost:3000/"), "http://localhost:3000");
  });
});

describe("server auth behavior", () => {
  it("uses authoritative getUser and rejects absent/unverified identities", async () => {
    for (const candidate of [null, { ...user, email_confirmed_at: null }, { ...user, is_anonymous: true }, { ...user, banned_until: "2099-01-01T00:00:00Z" }, { ...user, deleted_at: "2026-01-01T00:00:00Z" }]) {
      assert.equal(await getVerifiedUser(fakeClient({ getUser: async () => ({ data: { user: candidate }, error: null }) })), null);
    }
    assert.equal((await getVerifiedUser(fakeClient()))?.id, user.id);
    assert.equal((await getVerifiedUser(fakeClient({ getUser: async () => ({ data: { user: { ...user, banned_until: "2020-01-01T00:00:00Z" } }, error: null }) })))?.id, user.id);
  });
  it("recognizes an expired/missing session as unauthenticated", async () => {
    assert.equal(await getVerifiedUser(fakeClient({ getUser: async () => ({ data: { user: null }, error: { name: "AuthSessionMissingError" } }) })), null);
  });
  it("does not mistake an Auth outage for a valid session", async () => {
    const logger = mock.method(console, "error", () => {});
    try {
      await assert.rejects(getVerifiedUser(fakeClient({ getUser: async () => ({ data: { user: null }, error: { status: 503, message: "private provider response" } }) })), /Unable to verify/);
      assert.ok(!JSON.stringify(logger.mock.calls).includes("private provider response"));
    } finally { logger.mock.restore(); }
  });
  it("validates signup before contacting the provider", async () => {
    const signup = mock.fn();
    const result = await submitAuth(fakeClient({ signUp: signup }), "sign-up", form({ ...credentials, password: "short" }), origin);
    assert.equal(result.status, "error");
    assert.equal(signup.mock.callCount(), 0);
  });
  it("signup uses the canonical origin and ignores client-supplied redirects and roles", async () => {
    const signup = mock.fn(async () => ({ data: { session: null }, error: null }));
    await submitAuth(fakeClient({ signUp: signup }), "sign-up", form({ ...credentials, next: "https://evil.example", role: "admin" }), origin);
    assert.deepEqual(signup.mock.calls[0].arguments, [{ email: credentials.email, password: credentials.password, options: { emailRedirectTo: `${origin}/auth/confirm` } }]);
  });
  it("returns the same signup response for an existing address", async () => {
    const normal = await submitAuth(fakeClient({ signUp: async () => ({ data: { session: null }, error: null }) }), "sign-up", form(credentials), origin);
    const existing = await submitAuth(fakeClient({ signUp: async () => ({ data: { session: null }, error: { code: "user_already_exists" } }) }), "sign-up", form(credentials), origin);
    assert.deepEqual(existing, normal);
  });
  it("fails closed if the project issues a session before email verification", async () => {
    const logout = mock.fn(async () => ({ error: null }));
    const logger = mock.method(console, "error", () => {});
    try {
      const result = await submitAuth(fakeClient({ signUp: async () => ({ data: { session: {} }, error: null }), signOut: logout }), "sign-up", form(credentials), origin);
      assert.equal(result.status, "error");
      assert.deepEqual(logout.mock.calls[0].arguments, [{ scope: "local" }]);
    } finally { logger.mock.restore(); }
  });
  it("rejects a successful sign-in without verified email and clears that session", async () => {
    const logout = mock.fn(async () => ({ error: null }));
    const result = await submitAuth(fakeClient({ signInWithPassword: async () => ({ error: null }), getUser: async () => ({ data: { user: { ...user, email_confirmed_at: null } }, error: null }), signOut: logout }), "sign-in", form(credentials), origin);
    assert.equal(result.status, "error");
    assert.equal(logout.mock.callCount(), 1);
  });
  it("signs in a verified account", async () => {
    const result = await submitAuth(fakeClient({ signInWithPassword: async () => ({ error: null }) }), "sign-in", form(credentials), origin);
    assert.equal(result.status, "success");
  });
  it("keeps recovery requests generic and binds their redirect to the configured origin", async () => {
    const request = mock.fn(async () => ({ error: null }));
    const result = await submitAuth(fakeClient({ resetPasswordForEmail: request }), "forgot-password", form(credentials), origin);
    const absent = await submitAuth(fakeClient({ resetPasswordForEmail: async () => ({ error: { code: "user_not_found" } }) }), "forgot-password", form(credentials), origin);
    assert.deepEqual(result, absent);
    assert.deepEqual(request.mock.calls[0].arguments, [credentials.email, { redirectTo: `${origin}/auth/confirm` }]);
  });
  it("does not allow a normal session or a signup token to reset a password", async () => {
    const update = mock.fn();
    const verify = mock.fn(async () => ({ error: { status: 403 } }));
    const client = fakeClient({ verifyOtp: verify, updateUser: update });
    assert.equal((await submitAuth(client, "recover", form(credentials), origin)).status, "error");
    assert.equal(verify.mock.callCount(), 0);
    assert.equal((await submitAuth(client, "recover", form({ ...credentials, token_hash: "a".repeat(56), type: "signup" }), origin)).status, "error");
    assert.deepEqual(verify.mock.calls[0].arguments, [{ token_hash: "a".repeat(56), type: "recovery" }]);
    assert.equal(update.mock.callCount(), 0);
  });
  it("consumes a valid recovery token before changing the password and revokes sessions", async () => {
    const calls: string[] = [];
    const logout = mock.fn(async () => { calls.push("logout"); return { error: null }; });
    const result = await submitAuth(fakeClient({
      verifyOtp: async () => { calls.push("verify"); return { error: null }; },
      updateUser: async () => { calls.push("update"); return { error: null }; },
      signOut: logout,
    }), "recover", form({ ...credentials, token_hash: "a".repeat(56) }), origin);
    assert.equal(result.status, "success");
    assert.deepEqual(calls, ["verify", "update", "logout"]);
    assert.deepEqual(logout.mock.calls[0].arguments, [{ scope: "global" }]);
  });
  it("email confirmation uses the supported email type and ends its temporary session", async () => {
    const verify = mock.fn(async () => ({ error: null }));
    const logout = mock.fn(async () => ({ error: null }));
    const result = await submitAuth(fakeClient({ verifyOtp: verify, signOut: logout }), "verify", form({ token_hash: "pkce_" + "a".repeat(56), type: "invite", next: "//evil.example" }), origin);
    assert.equal(result.status, "success");
    assert.deepEqual(verify.mock.calls[0].arguments, [{ token_hash: "pkce_" + "a".repeat(56), type: "email" }]);
    assert.deepEqual(logout.mock.calls[0].arguments, [{ scope: "local" }]);
  });
  it("logout revokes only the current session during normal use", async () => {
    const logout = mock.fn(async () => ({ error: null }));
    assert.equal((await signOut(fakeClient({ signOut: logout }))).status, "success");
    assert.deepEqual(logout.mock.calls[0].arguments, [{ scope: "local" }]);
  });

  it("resends signup confirmation using the resend API's signup type", async () => {
    const resend = mock.fn(async () => ({ error: null }));
    assert.equal((await submitAuth(fakeClient({ resend }), "resend", form(credentials), origin)).status, "success");
    assert.deepEqual(resend.mock.calls[0].arguments, [{ type: "signup", email: credentials.email, options: { emailRedirectTo: `${origin}/auth/confirm` } }]);
  });

  for (const mode of ["verify", "recover"] as const) {
    it(`${mode} rejects malformed tokens before contacting Auth`, async () => {
      const verify = mock.fn();
      for (const token of ["", "short", "a".repeat(257), "../" + "a".repeat(56), "a".repeat(56) + "\n"]) {
        assert.equal((await submitAuth(fakeClient({ verifyOtp: verify }), mode, form({ ...credentials, token_hash: token }), origin)).status, "error");
      }
      assert.equal(verify.mock.callCount(), 0);
    });

    it(`${mode} denies expired or reused tokens without updating a password`, async () => {
      const update = mock.fn();
      const result = await submitAuth(fakeClient({ verifyOtp: async () => ({ error: { status: 403, code: "otp_expired" } }), updateUser: update }), mode, form({ ...credentials, token_hash: "a".repeat(56) }), origin);
      assert.equal(result.status, "error");
      assert.equal(update.mock.callCount(), 0);
    });

    it(`${mode} cleans up a temporary session if the verified identity is ineligible`, async () => {
      const logout = mock.fn(async () => ({ error: null }));
      const update = mock.fn();
      const result = await submitAuth(fakeClient({ verifyOtp: async () => ({ error: null }), getUser: async () => ({ data: { user: null }, error: null }), updateUser: update, signOut: logout }), mode, form({ ...credentials, token_hash: "a".repeat(56) }), origin);
      assert.equal(result.status, "error");
      assert.equal(update.mock.callCount(), 0);
      assert.deepEqual(logout.mock.calls[0].arguments, [{ scope: "local" }]);
    });
  }

  for (const mode of ["sign-in", "verify", "recover"] as const) {
    it(`${mode} cleans up after an authoritative identity lookup throws`, async () => {
      const logout = mock.fn(async () => ({ error: null }));
      const client = fakeClient({
        signInWithPassword: async () => ({ error: null }), verifyOtp: async () => ({ error: null }),
        getUser: async () => { throw new Error("Auth unavailable"); }, signOut: logout,
      });
      await assert.rejects(submitAuth(client, mode, form({ ...credentials, token_hash: "a".repeat(56) }), origin), /Auth unavailable/);
      assert.deepEqual(logout.mock.calls[0].arguments, [{ scope: "local" }]);
    });
  }

  it("cleans up after a password update throws", async () => {
    const logout = mock.fn(async () => ({ error: null }));
    const client = fakeClient({ verifyOtp: async () => ({ error: null }), updateUser: async () => { throw new Error("Auth unavailable"); }, signOut: logout });
    await assert.rejects(submitAuth(client, "recover", form({ ...credentials, token_hash: "a".repeat(56) }), origin), /Auth unavailable/);
    assert.deepEqual(logout.mock.calls[0].arguments, [{ scope: "local" }]);
  });

  it("does not report recovery success when password update or global logout fails", async () => {
    const logger = mock.method(console, "error", () => {});
    try {
      for (const failUpdate of [true, false]) {
        const logout = mock.fn(async () => ({ error: failUpdate ? null : { status: 503 } }));
        const result = await submitAuth(fakeClient({ verifyOtp: async () => ({ error: null }), updateUser: async () => ({ error: failUpdate ? { code: "same_password" } : null }), signOut: logout }), "recover", form({ ...credentials, token_hash: "a".repeat(56) }), origin);
        assert.equal(result.status, "error");
        assert.deepEqual(logout.mock.calls[0].arguments, [{ scope: failUpdate ? "local" : "global" }]);
      }
    } finally { logger.mock.restore(); }
  });
});

describe("confirmation URL boundary", () => {
  it("accepts provider hashes and only email/recovery types", () => {
    for (const token of ["a".repeat(56), "pkce_" + "a".repeat(56)]) {
      assert.ok(isTokenHash(token));
      assert.deepEqual(parseConfirmation(token, "email"), { token, mode: "verify" });
      assert.deepEqual(parseConfirmation(token, "recovery"), { token, mode: "recover" });
      for (const type of [undefined, "signup", "invite", "email_change", "magiclink", ["email", "recovery"], "//evil.example"]) {
        assert.equal(parseConfirmation(token, type), null);
      }
    }
    assert.equal(parseConfirmation(["a".repeat(56), "b".repeat(56)], "email"), null);
  });
});

describe("profile server authorization", () => {
  for (const [name, candidate] of [["unauthenticated", null], ["unverified", { ...user, email_confirmed_at: null }], ["banned", { ...user, banned_until: "2099-01-01T00:00:00Z" }]] as const) {
    it(`denies ${name} reads and mutations before any database query`, async () => {
      const from = mock.fn();
      const client = fakeClient({ getUser: async () => ({ data: { user: candidate }, error: null }) }, from);
      await assert.rejects(readPrivateProfile(client), AuthenticationRequired);
      await assert.rejects(updatePrivateProfile(client, form({ display_name: "Attacker" })), AuthenticationRequired);
      assert.equal(from.mock.callCount(), 0);
    });
  }
  it("scopes a private profile read to the authoritative identity", async () => {
    const profile = { user_id: user.id, display_name: "Alice", created_at: "2026-09-24T00:00:00Z" };
    const eq = mock.fn(() => ({ single: async () => ({ data: profile, error: null }) }));
    const client = fakeClient({}, () => ({ select: () => ({ eq }) }));
    assert.deepEqual(await readPrivateProfile(client), { user, profile });
    assert.deepEqual(eq.mock.calls[0].arguments, ["user_id", user.id]);
  });
  it("rejects invalid profile data before database writes", async () => {
    const from = mock.fn();
    for (const name of ["a".repeat(81), "bad\u0000name", "bad\nname"]) {
      assert.equal((await updatePrivateProfile(fakeClient({}, from), form({ display_name: name }))).status, "error");
    }
    assert.equal(from.mock.callCount(), 0);
  });
  it("ignores forged identity/role fields and scopes the update to the verified user", async () => {
    const single = async () => ({ data: { user_id: user.id }, error: null });
    const eq = mock.fn(() => ({ select: () => ({ single }) }));
    const update = mock.fn(() => ({ eq }));
    const from = mock.fn(() => ({ update }));
    const result = await updatePrivateProfile(fakeClient({}, from), form({ display_name: " Alice ", user_id: "user-b", role: "admin", created_at: "bad" }));
    assert.equal(result.status, "success");
    assert.deepEqual(update.mock.calls[0].arguments, [{ display_name: "Alice" }]);
    assert.deepEqual(eq.mock.calls[0].arguments, ["user_id", user.id]);
  });
});
