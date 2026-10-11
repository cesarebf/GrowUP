import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AuthenticationRequired, getVerifiedUser } from "@/lib/auth/service";
import { readCommunity } from "@/lib/communities/service";
import { listCommunityMembers } from "@/lib/communities/members";
import { memberPageInput, memberPageSize, nextMemberPage } from "@/lib/communities/member-presentation";
import type { RequestSearchParams } from "@/lib/communities/request-presentation";
import { CommunityMembers } from "@/components/community-members";
import { RequestRefresh } from "@/components/request-refresh";
import { MemberPageLink } from "@/components/member-page-link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Members | GrowUP", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function CommunityMembersPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<RequestSearchParams>;
}) {
  if (!isSupabaseConfigured()) redirect("/sign-in");
  const client = await createClient();
  if (!await getVerifiedUser(client)) redirect("/sign-in");
  const community = await readCommunity(client, (await params).slug);
  if (!community || (community.viewer_role !== "owner" && community.viewer_role !== "admin")) notFound();
  const path = `/c/${community.slug}/members`;
  const input = memberPageInput(await searchParams, community.id);
  let result;
  try { result = input.status === "error" ? input : await listCommunityMembers(client, input.data); }
  catch (error) { if (error instanceof AuthenticationRequired) redirect("/sign-in"); throw error; }
  return <main className="mx-auto min-w-0 max-w-lg space-y-6 px-6 py-12">
    <Link href={`/c/${community.slug}`} prefetch={false} className="break-words text-sm underline">Back to {community.name}</Link>
    <h1 className="text-2xl font-semibold">Community members</h1>
    <p className="text-sm text-muted-foreground">Oldest memberships first, up to {memberPageSize} per page. Management names are optional, may repeat, and are not verified identities.</p>
    {result.status === "error" ? <p role="alert" className="text-sm">{result.message}</p>
      : <CommunityMembers communityId={community.id} actorRole={community.viewer_role} members={result.data} />}
    {result.status === "success" && result.data.length < memberPageSize && <p role="status" className="text-sm">End of the current roster.</p>}
    <nav aria-label="Member pages" className="flex flex-wrap gap-4">
      <RequestRefresh />
      <MemberPageLink href={path}>First page</MemberPageLink>
      {result.status === "success" && result.data.length === memberPageSize && <MemberPageLink href={nextMemberPage(path, result.data[result.data.length - 1])}>Next page</MemberPageLink>}
      <Link href={`/c/${community.slug}/membership`} prefetch={false} className="text-sm underline">Your management name</Link>
    </nav>
  </main>;
}
