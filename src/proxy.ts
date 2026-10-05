import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/account/:path*", "/auth/:path*", "/sign-in", "/sign-up", "/forgot-password", "/verify-email", "/invite/:path*", "/c/:path*", "/communities/:path*"],
};
