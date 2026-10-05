"use client";
import Link from "next/link";

export default function InvitationError() {
  return <main className="mx-auto max-w-lg space-y-4 px-6 py-12">
    <h1 className="text-2xl font-semibold">Invitation temporarily unavailable</h1>
    <p role="alert">We could not load this invitation. Refresh to check its current status.</p>
    <button type="button" onClick={() => window.location.reload()} className="form-button">Refresh status</button>
    <Link href="/" prefetch={false} referrerPolicy="no-referrer" className="block text-sm underline">GrowUP home</Link>
  </main>;
}
