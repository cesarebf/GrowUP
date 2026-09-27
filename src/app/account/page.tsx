import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AuthenticationRequired, readPrivateProfile } from "@/lib/auth/service";
import { signOutAction } from "@/app/auth/actions";
import { ProfileForm } from "@/components/profile-form";

export const dynamic = "force-dynamic";

export default async function Account() {
  if (!isSupabaseConfigured()) redirect("/sign-in");
  let account;
  try {
    account = await readPrivateProfile(await createClient());
  } catch (error) {
    if (error instanceof AuthenticationRequired) redirect("/sign-in");
    throw error;
  }
  return <main className="mx-auto max-w-lg space-y-6 px-6 py-12">
    <Link href="/" className="font-semibold">GrowUP</Link>
    <h1 className="text-2xl font-semibold">Your account</h1>
    <p className="break-words text-sm">Signed in as {account.user.email}</p>
    <ProfileForm displayName={account.profile.display_name} />
    <form action={signOutAction}><button type="submit" className="text-sm underline">Sign out</button></form>
  </main>;
}
