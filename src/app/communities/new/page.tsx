import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getVerifiedUser } from "@/lib/auth/service";
import { CommunityForm } from "@/components/community-form";

export const dynamic = "force-dynamic";

export default async function NewCommunity() {
  if (!isSupabaseConfigured() || !await getVerifiedUser(await createClient())) redirect("/sign-in");
  return <main className="mx-auto max-w-lg space-y-6 px-6 py-12">
    <Link href="/communities" prefetch={false} className="text-sm underline">Your communities</Link>
    <h1 className="text-2xl font-semibold">Create community</h1>
    <CommunityForm />
  </main>;
}
