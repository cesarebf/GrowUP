import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server.js";
import { getSupabaseConfig, isSupabaseConfigured } from "./config.ts";
import type { Database } from "./database.types.ts";

// Exported separately to test real cookie forwarding and response headers.
export function sessionCookies(request: NextRequest) {
  const response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return {
    get response() { return response; },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values: { name: string; value: string; options: CookieOptions }[], headers: Record<string, string>) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        // Forward the updated Cookie header to the render downstream as well
        // as writing Set-Cookie to the browser. Keep all refresh batches.
        const forwarded = NextResponse.next({ request });
        forwarded.headers.forEach((value, name) => {
          if (name.startsWith("x-middleware-")) response.headers.set(name, value);
        });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  };
}

export async function updateSession(request: NextRequest) {
  const state = sessionCookies(request);
  if (!isSupabaseConfigured()) return state.response;
  const { url, key } = getSupabaseConfig();
  const client = createServerClient<Database>(url, key, {
    cookies: state.cookies,
    cookieOptions: { sameSite: "lax", secure: process.env.NODE_ENV === "production" },
  });
  const { error } = await client.auth.getClaims();
  if (error && error.status && error.status >= 500) {
    // Fail closed in the page/action's authoritative getUser check. Record no
    // provider payloads; outages must not be mistaken for authorization.
    console.error("GrowUP session refresh unavailable", { status: error.status });
  }
  return state.response;
}
