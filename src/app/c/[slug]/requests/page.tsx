import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AuthenticationRequired, getVerifiedUser } from "@/lib/auth/service";
import { readCommunity } from "@/lib/communities/service";
import { listMembershipRequests } from "@/lib/communities/requests";
import { nextRequestPage, requestPageInput, requestPageSize, type RequestSearchParams } from "@/lib/communities/request-presentation";
import { MembershipRequestReview } from "@/components/membership-request-review";
import { RequestRefresh } from "@/components/request-refresh";

export const dynamic = "force-dynamic";

export default async function CommunityRequestsPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<RequestSearchParams>;
}) {
  if (!isSupabaseConfigured()) redirect("/sign-in");
  const client = await createClient();
  if (!await getVerifiedUser(client)) redirect("/sign-in");
  const community = await readCommunity(client, (await params).slug);
  if (!community || !["owner", "admin"].includes(community.viewer_role ?? "")) notFound();
  const path = `/c/${community.slug}/requests`;
  const input = requestPageInput(await searchParams, community.id);
  let result;
  try {
    result = input.status === "error" ? input : await listMembershipRequests(client, input.data);
  } catch (error) {
    if (error instanceof AuthenticationRequired) redirect("/sign-in");
    throw error;
  }
  return <main className="mx-auto max-w-lg space-y-6 px-6 py-12">
    <Link href={`/c/${community.slug}`} prefetch={false} className="break-words text-sm underline">Back to {community.name}</Link>
    <h1 className="text-2xl font-semibold">Pending membership requests</h1>
    <p className="text-sm text-muted-foreground">Oldest first, up to {requestPageSize} per page. Names are chosen by requesters and are not verified identities. Approval grants the member role.</p>
    {result.status === "error" ? <p role="alert" className="text-sm">{result.message}</p>
      : <MembershipRequestReview communityId={community.id} requests={result.data} />}
    <nav className="flex flex-wrap gap-4">
      <RequestRefresh />
      <Link href={path} prefetch={false} className="text-sm underline">First page</Link>
      {result.status === "success" && result.data.length === requestPageSize &&
        <Link href={nextRequestPage(path, result.data[result.data.length - 1])} prefetch={false} className="text-sm underline">Next page</Link>}
    </nav>
  </main>;
}
