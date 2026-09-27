import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "./config";
import type { Database } from "./database.types";

export async function createClient(writable = false) {
  const { url, key } = getSupabaseConfig();
  const cookieStore = await cookies();
  return createServerClient<Database>(url, key, {
    cookieOptions: { sameSite: "lax", secure: process.env.NODE_ENV === "production" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      // Server Components are read-only. Proxy refreshes cookies first; leaving
      // setAll absent preserves the SDK warning if that contract ever breaks.
      ...(writable ? {
        setAll: (values: { name: string; value: string; options: import("@supabase/ssr").CookieOptions }[]) => {
          values.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      } : {}),
    },
  });
}
