import { it, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { createServerClient } from "@supabase/ssr";
import { sessionCookies, updateSession } from "../src/lib/supabase/session.ts";
import { getVerifiedUser, submitAuth } from "../src/lib/auth/service.ts";
import type { Database } from "../src/lib/supabase/database.types.ts";

it("forwards refreshed cookies to the renderer and browser, preserving no-cache headers", () => {
  const request = new NextRequest("https://growup.example/account", { headers: { cookie: "session=old" } });
  const state = sessionCookies(request);
  state.cookies.setAll([{ name: "session", value: "new", options: { sameSite: "lax", secure: true, path: "/" } }], { "Cache-Control": "private, no-store", Pragma: "no-cache" });
  state.cookies.setAll([{ name: "chunk", value: "second", options: { path: "/" } }], {});
  assert.equal(request.cookies.get("session")?.value, "new");
  assert.equal(state.response.cookies.get("session")?.value, "new");
  assert.equal(state.response.cookies.get("chunk")?.value, "second");
  assert.match(state.response.headers.get("x-middleware-request-cookie") ?? "", /session=new/);
  assert.match(state.response.headers.get("cache-control") ?? "", /no-store/);
  assert.match(state.response.headers.get("set-cookie") ?? "", /Secure/);
  assert.equal(state.response.headers.get("referrer-policy"), "no-referrer");
});

// Exercise the installed SDK and real Next cookie adapter. Only the provider's
// HTTP responses are fixtures; hosted Auth/SMTP still need live verification.
const providerUrl = "https://fixture.supabase.co";
const publicKey = "sb_publishable_test_fixture";
const cookieName = "sb-fixture-auth-token";
const verifiedUser = {
  id: "11111111-1111-4111-8111-111111111111", email: "member@example.com",
  email_confirmed_at: "2026-09-24T00:00:00Z", is_anonymous: false,
  app_metadata: { provider: "email" }, user_metadata: {}, aud: "authenticated",
  created_at: "2026-09-24T00:00:00Z",
};
function session(expiresAt: number) {
  const encode = (data: object) => Buffer.from(JSON.stringify(data)).toString("base64url");
  return {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: verifiedUser.id, exp: expiresAt })}.test-signature`,
    refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600,
    expires_at: expiresAt, user: verifiedUser,
  };
}
function requestWithSession(value: object) {
  const cookie = `base64-${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
  return new NextRequest("https://growup.example/account", { headers: { cookie: `${cookieName}=${cookie}; unrelated=keep` } });
}
function configure(t: TestContext) {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: providerUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}
function clientFor(request: NextRequest) {
  const state = sessionCookies(request);
  const client = createServerClient<Database>(providerUrl, publicKey, { cookies: state.cookies });
  return { client, state };
}

it("proxy refresh reaches both the browser and downstream renderer, then survives a new request", async (t) => {
  configure(t);
  let refreshes = 0;
  let lookups = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    assert.equal(url.origin, providerUrl);
    if (url.pathname === "/auth/v1/token") {
      assert.equal(url.searchParams.get("grant_type"), "refresh_token");
      assert.deepEqual(JSON.parse(String(init?.body)), { refresh_token: "test-refresh-token" });
      refreshes++;
      return Response.json(session(Math.floor(Date.now() / 1000) + 3600));
    }
    assert.equal(url.pathname, "/auth/v1/user");
    lookups++;
    return Response.json(verifiedUser);
  });
  const request = requestWithSession(session(1));
  const before = request.cookies.get(cookieName)?.value;
  const response = await updateSession(request);
  const refreshed = response.cookies.get(cookieName);
  assert.ok(refreshed?.value);
  assert.notEqual(refreshed.value, before);
  assert.equal(request.cookies.get(cookieName)?.value, refreshed.value);
  assert.match(response.headers.get("x-middleware-request-cookie") ?? "", /unrelated=keep/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(refreshed.sameSite, "lax");
  assert.ok(refreshed.maxAge && refreshed.maxAge > 0);
  const nextRequest = new NextRequest(request.url, { headers: { cookie: `${cookieName}=${refreshed.value}` } });
  assert.equal((await getVerifiedUser(clientFor(nextRequest).client))?.id, verifiedUser.id);
  assert.equal(refreshes, 1);
  assert.ok(lookups >= 1);
});

it("authoritative lookup rejects a forged verified user in the session cookie", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "bad_jwt", message: "Invalid token" }, { status: 401 }));
  const request = requestWithSession(session(Math.floor(Date.now() / 1000) + 3600));
  assert.equal(await getVerifiedUser(clientFor(request).client), null);
});

it("invalid refresh credentials clear stale SSR cookies instead of retaining identity", async (t) => {
  configure(t);
  // The SDK logs expected refresh failures. Check those diagnostics do not
  // contain the fixture's credentials while keeping test output readable.
  const logger = t.mock.method(console, "error", () => {});
  const warnings = t.mock.method(console, "warn", () => {});
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "refresh_token_not_found", message: "Invalid refresh token" }, { status: 400, headers: { "X-Supabase-Api-Version": "2024-01-01" } }));
  const request = requestWithSession(session(1));
  const response = await updateSession(request);
  assert.equal(response.cookies.get(cookieName)?.maxAge, 0);
  assert.equal(request.cookies.get(cookieName)?.value, "");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const diagnostics = JSON.stringify([...logger.mock.calls, ...warnings.mock.calls]);
  assert.ok(logger.mock.callCount() + warnings.mock.callCount() > 0);
  assert.ok(!diagnostics.includes("test-refresh-token"));
  assert.ok(!diagnostics.includes("test-signature"));
});

it("successful recovery exchanges the hash, changes only the password, and clears session cookies", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push(`${init?.method} ${url.pathname}`);
    if (url.pathname === "/auth/v1/verify") {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.type, "recovery");
      assert.equal(body.token_hash, "pkce_" + "a".repeat(56));
      return Response.json(session(Math.floor(Date.now() / 1000) + 3600));
    }
    if (url.pathname === "/auth/v1/logout") {
      assert.equal(url.searchParams.get("scope"), "global");
      return new Response(null, { status: 204 });
    }
    assert.equal(url.pathname, "/auth/v1/user");
    if (init?.method === "PUT") assert.deepEqual(JSON.parse(String(init.body)), { password: "A new example password", code_challenge: null, code_challenge_method: null });
    return Response.json(verifiedUser);
  });
  const { client, state } = clientFor(new NextRequest("https://growup.example/auth/confirm"));
  const form = new FormData();
  Object.entries({ token_hash: "pkce_" + "a".repeat(56), password: "A new example password", confirmPassword: "A new example password", user_id: "someone-else" }).forEach(([key, value]) => form.set(key, value));
  assert.equal((await submitAuth(client, "recover", form, "https://growup.example")).status, "success");
  assert.deepEqual(calls, ["POST /auth/v1/verify", "GET /auth/v1/user", "PUT /auth/v1/user", "POST /auth/v1/logout"]);
  assert.equal(state.response.cookies.get(cookieName)?.maxAge, 0);
  assert.equal(state.cookies.getAll().find((cookie) => cookie.name === cookieName)?.value, "");
});
