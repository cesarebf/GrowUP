// Production-browser UI smoke only. This loopback fixture API deliberately
// emulates Auth/RPC responses; it is NOT hosted Auth, SQL, or RLS validation.
// Build first with NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:4318,
// NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local_fixture,
// APP_URL=http://localhost:4317 and NEXT_TELEMETRY_DISABLED=1.
// Set GROWUP_PLAYWRIGHT_MODULE to an existing playwright module file URL.
// Optional GROWUP_BROWSER_EXECUTABLE selects an installed Chromium browser.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const origin = "http://localhost:4317";
const fixtureOrigin = "http://127.0.0.1:4318";
const { chromium } = await import(process.env.GROWUP_PLAYWRIGHT_MODULE);
const tenant = "11111111-1111-4111-8111-111111111111";
const users = Object.fromEntries(["owner", "admin", "moderator", "member", "recipient", "departed"].map((role) => [role, {
  id: randomUUID(), email: `${role}@example.test`, email_confirmed_at: new Date().toISOString(), aud: "authenticated", role: "authenticated",
}]));
const community = { id: tenant, name: "Local private garden " + "a".repeat(55), slug: "local-garden", description: "b".repeat(500), visibility: "private", join_policy: "approval_required" };
const membership = new Map(Object.entries(users).filter(([role]) => ["owner", "admin", "moderator", "member"].includes(role)).map(([role, user]) => [user.id, role]));
const records = [];
const unavailable = { outcome: "unavailable", community_name: null, community_description: null, expires_at: null, already_member: null, community_slug: null };
const seed = "cd".repeat(32), departed = "de".repeat(32);
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
function addInvitation(digest, status = "active", accepter = null) {
  const created_at = new Date().toISOString(), expires_at = new Date(Date.now() + 168 * 3600000).toISOString();
  const record = { invitation_id: randomUUID(), created_at, expires_at, status, accepted_at: status === "accepted" ? created_at : null, revoked_at: null, digest, accepter };
  records.unshift(record); return record;
}
addInvitation(hash(seed)); addInvitation(hash(departed), "accepted", users.departed.id);
const project = ({ invitation_id, created_at, expires_at, status, accepted_at, revoked_at }) => ({ invitation_id, created_at, expires_at, status, accepted_at, revoked_at });
let acceptanceCalls = 0;
let serverOutput = "";
const createdSecrets = [];
function session(user) {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return { access_token: `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated", role: "authenticated" })}.c3ludGhldGlj`, refresh_token: "fixture-refresh", expires_in: 3600, token_type: "bearer", user };
}
const api = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  let user;
  try { const sub = JSON.parse(Buffer.from(req.headers.authorization.split(".")[1], "base64url").toString()).sub; user = Object.values(users).find(u => u.id === sub); } catch {}
  const url = new URL(req.url, fixtureOrigin);
  let data, status = 200;
  if (url.pathname === "/auth/v1/token") {
    user = Object.values(users).find(u => u.email === body.email);
    if (user && body.password === "fixture-password-123") data = session(user);
    else { status = 400; data = { code: "invalid_credentials", message: "Invalid credentials" }; }
  } else if (url.pathname === "/auth/v1/user") { data = user ?? { code: "session_not_found" }; if (!user) status = 401; }
  else if (url.pathname === "/auth/v1/signup") data = { user: { ...users.recipient, email_confirmed_at: null }, session: null };
  else if (url.pathname === "/auth/v1/logout") data = {};
  else if (url.pathname.startsWith("/rest/v1/rpc/")) {
    const name = url.pathname.split("/").at(-1), role = membership.get(user?.id);
    const record = typeof body.p_token === "string" ? records.find(r => r.digest === hash(body.p_token)) : null;
    if (name === "get_community_landing") data = role ? [{ ...community, viewer_role: role }] : [];
    else if (["list_community_invitations", "create_community_invitation", "revoke_community_invitation"].includes(name)) {
      if (!["owner", "admin"].includes(role)) { status = 403; data = { code: "42501", message: "Unavailable" }; }
      else if (name === "list_community_invitations") data = records.map(project).slice(0, body.p_limit);
      else if (name === "create_community_invitation") { const r = addInvitation(body.p_token_hash); data = [{ invitation_id: r.invitation_id, created_at: r.created_at, expires_at: r.expires_at }]; }
      else { const r = records.find(r => r.invitation_id === body.p_invitation_id); if (r.status === "active") { r.status = "revoked"; r.revoked_at = new Date().toISOString(); } data = [project(r)]; }
    } else if (name === "get_community_invitation_preview") {
      const accepted = record?.status === "accepted" && record.accepter === user?.id;
      data = [record?.status === "active" || accepted ? accepted && !role ? { ...unavailable, outcome: "accepted" }
        : { outcome: accepted ? "accepted" : "active", community_name: community.name, community_description: community.description, expires_at: record.expires_at, already_member: !!role, community_slug: accepted ? community.slug : null } : unavailable];
    } else if (name === "accept_community_invitation") {
      acceptanceCalls++;
      if (!user || !record || record.status !== "active") data = [{ outcome: "unavailable", community_slug: null }];
      else if (role) data = [{ outcome: "already_member", community_slug: community.slug }];
      else { membership.set(user.id, "member"); record.status = "accepted"; record.accepter = user.id; record.accepted_at = new Date().toISOString(); data = [{ outcome: "accepted", community_slug: community.slug }]; }
    } else data = [];
  } else if (url.pathname.endsWith("/private_profiles")) data = { user_id: user?.id, display_name: null, created_at: new Date().toISOString() };
  else if (url.pathname.endsWith("/community_memberships")) data = [];
  else { status = 404; data = {}; }
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data));
});
await new Promise(resolve => api.listen(4318, "127.0.0.1", resolve));
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "4317"], {
  cwd: root, windowsHide: true, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", APP_URL: origin,
    NEXT_PUBLIC_SUPABASE_URL: fixtureOrigin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_fixture" }, stdio: ["ignore", "pipe", "pipe"],
});
app.stdout.on("data", value => { serverOutput += value.toString(); }); app.stderr.on("data", value => { serverOutput += value.toString(); });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(origin)).ok) { ready = true; break; } } catch {} await delay(500); }
  assert.ok(ready, "Local production server starts");
  browser = await chromium.launch({ headless: true, ...(process.env.GROWUP_BROWSER_EXECUTABLE ? { executablePath: process.env.GROWUP_BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage(), errors = [], network = [];
  page.on("pageerror", () => errors.push("browser runtime error"));
  page.on("console", msg => { if (msg.type() === "error" && /hydration|react error/i.test(msg.text())) errors.push("hydration error"); });
  page.on("request", req => network.push({ url: req.url(), referrer: req.headers().referer }));
  async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "No horizontal page overflow"); }
  async function login(role) {
    await page.getByLabel("Email", { exact: true }).fill(`${role}@example.test`);
    await page.getByLabel("Password", { exact: true }).fill("fixture-password-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  async function visible(text) { await page.getByText(text, { exact: false }).first().waitFor(); }
  const response = await page.goto(`${origin}/invite/${seed}`);
  for (const [name, expected] of [["cache-control", /private.*no-store/], ["referrer-policy", /^no-referrer$/], ["x-robots-tag", /noindex.*nofollow/]]) assert.match(response.headers()[name], expected);
  assert.equal(acceptanceCalls, 0);
  await visible(community.name); await noOverflow();
  await page.setViewportSize({ width: 320, height: 800 }); await noOverflow();
  await page.getByRole("button", { name: "Sign in", exact: true }).focus(); await page.keyboard.press("Enter");
  await page.waitForURL(`${origin}/sign-in`);
  const cookie = (await context.cookies()).find(c => c.name === "growup_invitation_return");
  assert.ok(cookie?.httpOnly); assert.equal(cookie.sameSite, "Lax"); assert.equal(cookie.path, "/"); assert.equal(cookie.secure, false);
  await login("recipient"); await page.waitForURL(`${origin}/invite/${seed}`);
  assert.equal(acceptanceCalls, 0); assert.equal((await context.cookies()).some(c => c.name === "growup_invitation_return"), false);
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await visible("Your membership is confirmed"); assert.equal(acceptanceCalls, 1); await noOverflow();
  await page.getByRole("link", { name: "Enter community" }).click(); await page.waitForURL(`${origin}/c/local-garden`);
  assert.equal(await page.getByText("Submit request", { exact: true }).count(), 0);
  await page.goto(`${origin}/invite/${seed}`); await visible("Invitation already accepted");
  await context.clearCookies(); await page.goto(`${origin}/invite/${seed}`); await visible("This invitation is unavailable"); assert.equal(await page.getByText(community.name).count(), 0);
  await page.goto(`${origin}/invite/malformed`); await visible("This invitation is unavailable");
  await page.goto(`${origin}/sign-in`); await login("owner"); await page.waitForURL(`${origin}/account`);
  await page.goto(`${origin}/c/local-garden/invitations`);
  await page.getByRole("button", { name: "Create invitation", exact: true }).focus(); await page.keyboard.press("Enter");
  await visible("Copy this invitation link now");
  const linkField = page.getByLabel("Copy this invitation link now"); const link = await linkField.inputValue(); createdSecrets.push(link.split("/").at(-1));
  assert.equal(new URL(link).origin, origin); await noOverflow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link", exact: true }).click(); await visible("Link copied.");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), link);
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async () => { throw new Error("denied"); } }); });
  await page.getByRole("button", { name: "Copy link", exact: true }).click(); await visible("Clipboard unavailable");
  assert.equal(await linkField.evaluate(el => document.activeElement === el && el.selectionEnd === el.value.length), true);
  await page.setViewportSize({ width: 375, height: 812 }); await noOverflow();
  await page.reload(); assert.equal(await page.getByRole("button", { name: "Copy link", exact: true }).count(), 0);
  await page.getByLabel("Revoke this invitation permanently").first().check(); await page.getByRole("button", { name: "Revoke", exact: true }).first().click();
  await visible("Invitation revoked."); await noOverflow();
  await context.clearCookies(); await page.goto(link); await visible("This invitation is unavailable");
  const signupToken = "ef".repeat(32); addInvitation(hash(signupToken));
  await page.goto(`${origin}/invite/${signupToken}`); await page.getByRole("button", { name: "Sign up", exact: true }).click(); await page.waitForURL(`${origin}/sign-up`);
  assert.ok((await context.cookies()).some(c => c.name === "growup_invitation_return"));
  await page.getByLabel("Email", { exact: true }).fill("new@example.test"); await page.getByLabel("New password", { exact: true }).fill("fixture-password-123"); await page.getByLabel("Confirm password", { exact: true }).fill("fixture-password-123");
  await page.getByRole("button", { name: "Create account", exact: true }).click(); await visible("verification email will arrive");
  assert.equal(new URL(page.url()).pathname, "/sign-up"); assert.equal(acceptanceCalls, 1);
  await context.clearCookies(); await page.goto(`${origin}/sign-in`); await login("departed"); await page.waitForURL(`${origin}/account`);
  await page.goto(`${origin}/invite/${departed}`); await visible("Community details are unavailable"); assert.equal(await page.getByText(community.name).count(), 0);
  for (const role of ["admin", "moderator", "member"]) {
    await context.clearCookies(); await page.goto(`${origin}/sign-in`); await login(role); await page.waitForURL(`${origin}/account`);
    await page.goto(`${origin}/c/local-garden/invitations`);
    assert.equal(await page.getByRole("button", { name: "Create invitation", exact: true }).count(), role === "admin" ? 1 : 0);
    await page.goto(`${origin}/invite/${signupToken}`); await visible("this invitation remains unused");
    assert.equal(await page.getByRole("button", { name: "Accept invitation", exact: true }).count(), 0);
  }
  assert.deepEqual(errors, []);
  const sentinels = [seed, departed, signupToken, ...createdSecrets];
  assert.ok(sentinels.every(token => !serverOutput.includes(token)), "No synthetic tokens in production output");
  assert.ok(network.every(r => new URL(r.url).origin === origin), "No third-party browser requests");
  assert.ok(network.every(r => !r.referrer || !sentinels.some(t => r.referrer.includes(t))), "No token-bearing referrers");
  assert.ok(network.every(r => !sentinels.some(t => new URL(r.url).search.includes(t))), "No token query strings");
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  console.log("PASS: production browser fixture smoke; headers, hydration/runtime, 320/375/1280 layout, keyboard, clipboard success/fallback, one-time refresh, revoke, roles, explicit acceptance, private/replay states, Auth return and signup guidance, token privacy. Hosted Auth/SQL acceptance NOT tested.");
} catch (error) {
  // Browser exceptions can include the capability URL. Retain no raw payload.
  console.error("Browser smoke failed:", error instanceof assert.AssertionError ? error.message.replace(/[0-9a-f]{64}/g, "[redacted]") : "browser step failed; inspect locally without retaining capability URLs");
  process.exitCode = 1;
} finally {
  await browser?.close(); app.kill(); await new Promise(resolve => api.close(resolve));
}
