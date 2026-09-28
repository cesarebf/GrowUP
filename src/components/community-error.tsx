"use client";

export function CommunityError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-lg space-y-6 px-6 py-12">
    <h1 className="text-2xl font-semibold">Communities are temporarily unavailable</h1>
    <p>Please try again in a moment.</p>
    <button onClick={reset} className="form-button">Try again</button>
  </main>;
}
