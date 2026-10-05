import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AuthenticationRequired, getVerifiedUser } from "@/lib/auth/service";
import { readCommunity } from "@/lib/communities/service";
import { listInvitations } from "@/lib/communities/invitations";
import { invitationPageInput, invitationPageSize, nextInvitationPage } from "@/lib/communities/invitation-presentation";
import type { RequestSearchParams } from "@/lib/communities/request-presentation";
import { CommunityInvitations } from "@/components/community-invitations";
import { RequestRefresh } from "@/components/request-refresh";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invitations | GrowUP", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function CommunityInvitationsPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<RequestSearchParams>;
}) {
  if (!isSupabaseConfigured()) redirect("/sign-in");
  const client = await createClient();
  if (!await getVerifiedUser(client)) redirect("/sign-in");
  const community = await readCommunity(client, (await params).slug);
  if (!community || !["owner", "admin"].includes(community.viewer_role ?? "")) notFound();
  const path = `/c/${community.slug}/invitations`;
  const input = invitationPageInput(await searchParams, community.id);
  let result;
  try {
    result = input.status === "error" ? input : await listInvitations(client, input.data);
  } catch (error) {
    if (error instanceof AuthenticationRequired) redirect("/sign-in");
    throw error;
  }
  return <main className="mx-auto min-w-0 max-w-lg space-y-6 px-6 py-12">
    <Link href={`/c/${community.slug}`} prefetch={false} className="break-words text-sm underline">Back to {community.name}</Link>
    <h1 className="text-2xl font-semibold">Invitations</h1>
    {result.status === "error" ? <p role="alert" className="text-sm">{result.message}</p>
      : <CommunityInvitations communityId={community.id} invitations={result.data} />}
    <nav aria-label="Invitation history pages" className="flex flex-wrap gap-4">
      <RequestRefresh />
      <Link href={path} prefetch={false} className="text-sm underline">First page</Link>
      {result.status === "success" && result.data.length === invitationPageSize &&
        <Link href={nextInvitationPage(path, result.data[result.data.length - 1])} prefetch={false} className="text-sm underline">Older invitations</Link>}
      <Link href={`/c/${community.slug}/requests`} prefetch={false} className="text-sm underline">Review membership requests</Link>
    </nav>
  </main>;
}
