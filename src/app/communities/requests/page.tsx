import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AuthenticationRequired, getVerifiedUser } from "@/lib/auth/service";
import { getMyMembershipRequests } from "@/lib/communities/requests";
import { nextRequestPage, requestPageInput, requestPageSize, type RequestSearchParams } from "@/lib/communities/request-presentation";
import { MembershipRequestHistory } from "@/components/membership-request-history";
import { RequestRefresh } from "@/components/request-refresh";

export const dynamic = "force-dynamic";

export default async function RequestHistoryPage({ searchParams }: { searchParams: Promise<RequestSearchParams> }) {
  if (!isSupabaseConfigured()) redirect("/sign-in");
  const client = await createClient();
  if (!await getVerifiedUser(client)) redirect("/sign-in");
  const input = requestPageInput(await searchParams);
  let result;
  try {
    result = input.status === "error" ? input : await getMyMembershipRequests(client, input.data);
  } catch (error) {
    if (error instanceof AuthenticationRequired) redirect("/sign-in");
    throw error;
  }
  const path = "/communities/requests";
  return <main className="mx-auto max-w-lg space-y-6 px-6 py-12">
    <Link href="/communities" prefetch={false} className="text-sm underline">Your communities</Link>
    <h1 className="text-2xl font-semibold">Your request history</h1>
    <p className="text-sm text-muted-foreground">Your own attempts, newest first, up to {requestPageSize} per page. Open an available community to check current membership, withdraw a pending request, or apply again.</p>
    {result.status === "error" ? <p role="alert" className="text-sm">{result.message}</p> : <MembershipRequestHistory requests={result.data} />}
    <nav className="flex flex-wrap gap-4">
      <RequestRefresh />
      <Link href={path} prefetch={false} className="text-sm underline">First page</Link>
      {result.status === "success" && result.data.length === requestPageSize &&
        <Link href={nextRequestPage(path, result.data[result.data.length - 1])} prefetch={false} className="text-sm underline">Older requests</Link>}
    </nav>
  </main>;
}
