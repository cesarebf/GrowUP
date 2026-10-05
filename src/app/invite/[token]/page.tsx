import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getVerifiedUser } from "@/lib/auth/service";
import { previewInvitation } from "@/lib/communities/invitations";
import { isInvitationToken } from "@/lib/communities/invitation-validation";
import { unavailableInvitationMessage } from "@/lib/communities/invitation-presentation";
import { CommunityInvitationAccept } from "@/components/community-invitation-accept";
import { RequestRefresh } from "@/components/request-refresh";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Community invitation | GrowUP", robots: { index: false, follow: false, nosnippet: true }, referrer: "no-referrer" };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let content;
  if (!isInvitationToken(token)) content = <p role="status">{unavailableInvitationMessage}</p>;
  else {
    if (!isSupabaseConfigured()) throw new Error("Invitations are temporarily unavailable.");
    const client = await createClient();
    const result = await previewInvitation(client, token);
    content = result.status === "error" ? <div className="space-y-4"><p role="alert">{result.message}</p><RequestRefresh /></div>
      : result.data.outcome === "unavailable" ? <p role="status">{unavailableInvitationMessage}</p>
        : <CommunityInvitationAccept token={token} preview={result.data} signedIn={!!await getVerifiedUser(client)} />;
  }
  return <main className="mx-auto min-w-0 max-w-lg space-y-6 px-6 py-12">
    <Link href="/" prefetch={false} referrerPolicy="no-referrer" className="font-semibold">GrowUP</Link>
    <h1 className="text-2xl font-semibold">Community invitation</h1>
    {content}
  </main>;
}
