"use client";

import { signOutAction } from "@/app/auth/actions";

export default function AccountError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-lg space-y-4 px-6 py-12">
    <h1 className="text-2xl font-semibold">Account unavailable</h1>
    <p role="alert">We could not complete your request. Please try again.</p>
    <button type="button" onClick={reset} className="form-button">Try again</button>
    <form action={signOutAction}><button type="submit" className="text-sm underline">Sign out</button></form>
  </main>;
}
