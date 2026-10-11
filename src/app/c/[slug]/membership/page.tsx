import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AuthenticationRequired } from "@/lib/auth/service";
import { readCommunity } from "@/lib/communities/service";
import { readMyManagementName } from "@/lib/communities/my-management-name";
import { CommunityManagementName } from "@/components/community-management-name";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your community membership | GrowUP", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function CommunityMembershipPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!isSupabaseConfigured()) redirect("/sign-in");
  const client = await createClient();
  const community = await readCommunity(client, (await params).slug);
  if (!community || !community.viewer_role) notFound();
  let membership;
  try { membership = await readMyManagementName(client, community.id); }
  catch (error) { if (error instanceof AuthenticationRequired) redirect("/sign-in"); throw error; }
  if (!membership) notFound();
  return <main className="mx-auto min-w-0 max-w-lg space-y-6 px-6 py-12">
    <Link href={`/c/${community.slug}`} prefetch={false} className="break-words text-sm underline">Back to {community.name}</Link>
    <h1 className="text-2xl font-semibold">Your community membership</h1>
    <CommunityManagementName key={membership.membership_id} communityId={community.id} membershipId={membership.membership_id} currentName={membership.management_display_name} />
  </main>;
}
