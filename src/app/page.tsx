import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-12">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight">GrowUP</h1>
        <p className="mt-3 text-base text-muted-foreground">Group + Grow.</p>
        <nav aria-label="Account" className="mt-6 flex justify-center gap-4 text-sm underline">
          <Link href="/sign-in">Sign in</Link>
          <Link href="/sign-up">Create account</Link>
          <Link href="/account" prefetch={false}>Your account</Link>
        </nav>
      </div>
    </main>
  );
}
