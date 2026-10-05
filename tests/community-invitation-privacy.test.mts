import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import nextConfig from "../next.config.ts";
import { previewInvitation } from "../src/lib/communities/invitations.ts";
import type { Database } from "../src/lib/supabase/database.types.ts";
const raw = "ef".repeat(32);
describe("invitation transport and diagnostic privacy", () => {
    it("installed Supabase SDK sends capability in POST body only and redacts malicious RPC errors", async () => {
        const requests: {
            method: string;
            path: string;
            body: unknown;
        }[] = [];
        const fetcher = mock.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(input instanceof Request ? input.url : String(input));
            assert.ok(!url.href.includes(raw));
            assert.equal(url.search, "");
            requests.push({ method: init?.method ?? "GET", path: url.pathname, body: JSON.parse(String(init?.body)) });
            return Response.json({ code: raw, message: raw, details: raw, hint: raw }, { status: 400 });
        });
        const client = createClient<Database>("https://project.example.test", "sb_publishable_fixture", { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
        const logger = mock.method(console, "error", () => { });
        try {
            const result = await previewInvitation(client, raw);
            assert.equal(result.status, "error");
            assert.deepEqual(requests, [{ method: "POST", path: "/rest/v1/rpc/get_community_invitation_preview", body: { p_token: raw } }]);
            assert.ok(!JSON.stringify([result, logger.mock.calls.map(c => c.arguments)]).includes(raw));
        }
        finally {
            logger.mock.restore();
        }
    });
    it("Next suppresses incoming-request and Server Function development logs", () => { assert.deepEqual(nextConfig.logging, { incomingRequests: false, serverFunctions: false }); });
    it("invite, community and management routes send no-store/no-referrer/noindex/frame/nosniff protections", async () => {
        const rules = await nextConfig.headers!();
        for (const source of ["/invite/:path*", "/c/:path*", "/communities/:path*"]) {
            const rule = rules.find(r => r.source === source);
            assert.ok(rule);
            const headers = Object.fromEntries(rule.headers.map(h => [h.key, h.value]));
            assert.match(headers["Cache-Control"], /private, no-store/);
            assert.equal(headers["Referrer-Policy"], "no-referrer");
            assert.equal(headers["X-Robots-Tag"], "noindex, nofollow, nosnippet");
            assert.equal(headers["X-Frame-Options"], "DENY");
            assert.equal(headers["X-Content-Type-Options"], "nosniff");
        }
    });
    it("session proxy covers invitation and community routes without raw-path diagnostics", async () => {
        const source = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
        for (const pattern of ["/invite/:path*", "/c/:path*", "/communities/:path*"])
            assert.ok(source.includes(pattern));
        assert.ok(!source.includes("console."));
    });
});
