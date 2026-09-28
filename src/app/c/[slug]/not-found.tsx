import Link from "next/link";

export default function CommunityNotFound() {
  return <main className="mx-auto max-w-lg space-y-6 px-6 py-12">
    <h1 className="text-2xl font-semibold">Community unavailable</h1>
    <p>This community does not exist or is not visible to your account.</p>
    <Link href="/sign-in" className="text-sm underline">Sign in</Link>
  </main>;
}
