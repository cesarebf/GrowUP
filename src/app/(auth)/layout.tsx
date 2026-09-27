import Link from "next/link";
import { ConfigurationError, isSupabaseConfigured, parseOrigin } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  let configured = isSupabaseConfigured();
  try { parseOrigin(process.env.APP_URL); }
  catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
    configured = false;
  }
  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <Link href="/" className="font-semibold">GrowUP</Link>
      <div className="mt-8">
        {configured ? children : <p role="status">Authentication is temporarily unavailable. Please try again later.</p>}
      </div>
    </main>
  );
}
