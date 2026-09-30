import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AuthenticationRequired } from "@/lib/auth/service";
import { listMyCommunities } from "@/lib/communities/service";

export const dynamic = "force-dynamic";

export default async function MyCommunities() {
  if (!isSupabaseConfigured()) redirect("/sign-in");
  let memberships;
  try {
    memberships = await listMyCommunities(await createClient());
  } catch (error) {
    if (error instanceof AuthenticationRequired) redirect("/sign-in");
    throw error;
  }
  return <main className="mx-auto max-w-lg space-y-6 px-6 py-12">
    <Link href="/account" prefetch={false} className="text-sm underline">Your account</Link>
    <h1 className="text-2xl font-semibold">Your communities</h1>
    <Link href="/communities/requests" prefetch={false} className="block text-sm underline">Your request history</Link>
    <Link href="/communities/new" prefetch={false} className="text-sm underline">Create community</Link>
    {memberships.length === 0 ? <p className="text-muted-foreground">You do not belong to any communities yet.</p> :
      <ul className="space-y-4">{memberships.map(({ communities: community, role }) => community &&
        <li key={community.id} className="rounded-lg border p-4">
          <Link href={`/c/${community.slug}`} prefetch={false} className="break-words font-medium underline">{community.name}</Link>
          <p className="mt-1 text-sm text-muted-foreground">{community.visibility} · Your role: {role}</p>
        </li>)}
      </ul>}
  </main>;
}
