import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { readCommunity } from "@/lib/communities/service";
import { getVerifiedUser } from "@/lib/auth/service";
import { CommunityMembershipForm } from "@/components/community-membership-form";

export const dynamic = "force-dynamic";

export default async function CommunityPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!isSupabaseConfigured()) throw new Error("Communities are temporarily unavailable.");
  const { slug } = await params;
  const client = await createClient();
  const community = await readCommunity(client, slug);
  if (!community) notFound();
  const canJoin = !community.viewer_role && community.join_policy === "instant" &&
    (community.visibility === "public" || community.visibility === "unlisted");
  const eligible = canJoin ? !!await getVerifiedUser(client) : false;
  return <main className="mx-auto max-w-lg space-y-6 px-6 py-12">
    <Link href="/" className="font-semibold">GrowUP</Link>
    <h1 className="break-words text-2xl font-semibold">{community.name}</h1>
    {community.description && <p className="break-words">{community.description}</p>}
    <p className="text-sm">Visibility: {community.visibility}</p>
    {community.viewer_role && <p className="text-sm">Your role: {community.viewer_role}</p>}
    {community.viewer_role === "owner" ? <p className="text-sm text-muted-foreground">You own this community and cannot leave. Ownership transfer and community closure are not available yet.</p>
      : community.viewer_role ? <CommunityMembershipForm communityId={community.id} operation="leave" />
      : canJoin ? eligible ? <CommunityMembershipForm communityId={community.id} operation="join" />
        : <p className="text-sm"><Link href="/sign-in" prefetch={false} className="underline">Sign in with a verified, eligible account</Link> to join.</p>
        : <p className="text-sm text-muted-foreground">Joining this community is not available for its current admission policy.</p>}
    <Link href="/communities" prefetch={false} className="text-sm underline">Your communities</Link>
  </main>;
}
