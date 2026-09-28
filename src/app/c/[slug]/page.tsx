import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { readCommunity } from "@/lib/communities/service";

export const dynamic = "force-dynamic";

export default async function CommunityPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!isSupabaseConfigured()) throw new Error("Communities are temporarily unavailable.");
  const { slug } = await params;
  const community = await readCommunity(await createClient(), slug);
  if (!community) notFound();
  return <main className="mx-auto max-w-lg space-y-6 px-6 py-12">
    <Link href="/" className="font-semibold">GrowUP</Link>
    <h1 className="break-words text-2xl font-semibold">{community.name}</h1>
    {community.description && <p className="break-words">{community.description}</p>}
    <p className="text-sm">Visibility: {community.visibility}</p>
    {community.viewer_role && <p className="text-sm">Your role: {community.viewer_role}</p>}
    <p className="text-sm text-muted-foreground">Joining this community is not available yet.</p>
    <Link href="/communities" prefetch={false} className="text-sm underline">Your communities</Link>
  </main>;
}
