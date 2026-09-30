import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { readCommunity } from "@/lib/communities/service";
import { AuthenticationRequired, getVerifiedUser } from "@/lib/auth/service";
import { CommunityMembershipForm } from "@/components/community-membership-form";
import { CommunitySettingsForm } from "@/components/community-settings-form";
import { MembershipRequestForm } from "@/components/membership-request-form";
import { RequestRefresh } from "@/components/request-refresh";
import { getMyMembershipRequests } from "@/lib/communities/requests";
import type { RequestReceipt, RequestResult } from "@/lib/communities/request-validation";

export const dynamic = "force-dynamic";

export default async function CommunityPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!isSupabaseConfigured()) throw new Error("Communities are temporarily unavailable.");
  const { slug } = await params;
  const client = await createClient();
  const community = await readCommunity(client, slug);
  if (!community) notFound();
  const canJoin = !community.viewer_role && community.join_policy === "instant" &&
    (community.visibility === "public" || community.visibility === "unlisted");
  const canRequest = !community.viewer_role && community.join_policy === "approval_required" &&
    (community.visibility === "public" || community.visibility === "unlisted");
  const eligible = canJoin || canRequest ? !!await getVerifiedUser(client) : false;
  let requests: RequestResult<RequestReceipt[]> | undefined;
  if (canRequest && eligible) {
    try {
      requests = await getMyMembershipRequests(client, { communityId: community.id, limit: 1 });
    } catch (error) {
      if (error instanceof AuthenticationRequired) redirect("/sign-in");
      throw error;
    }
    // Do not retain an earlier landing preview if the later receipt is redacted.
    if (requests.status === "success" && requests.data.some((row) => row.community_name === null)) notFound();
  }
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
        : canRequest ? eligible ? requests?.status === "success"
          ? <MembershipRequestForm key={`${community.id}:${requests.data[0]?.request_id ?? "new"}:${requests.data[0]?.status ?? "new"}`} communityId={community.id} latest={requests.data[0] ?? null} />
          : <div className="space-y-3"><p role="alert" className="text-sm">Your request status could not be loaded. Refresh before submitting a request.</p><RequestRefresh /></div>
          : <p className="text-sm"><Link href="/sign-in" prefetch={false} className="underline">Sign in with a verified, eligible account</Link> to request approval.</p>
        : <p className="text-sm text-muted-foreground">Joining this community is not available for its current admission policy.</p>}
    {(community.viewer_role === "owner" || community.viewer_role === "admin") &&
      <Link href={`/c/${community.slug}/requests`} prefetch={false} className="block text-sm underline">Review membership requests</Link>}
    {community.viewer_role === "owner" && <CommunitySettingsForm community={{
      id: community.id, name: community.name, description: community.description,
      visibility: community.visibility, join_policy: community.join_policy,
    }} />}
    <nav className="flex flex-wrap gap-4">
      <Link href="/communities" prefetch={false} className="text-sm underline">Your communities</Link>
      <Link href="/communities/requests" prefetch={false} className="text-sm underline">Your request history</Link>
    </nav>
  </main>;
}
