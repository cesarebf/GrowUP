import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { recoverAction, verifyAction } from "@/app/auth/actions";
import { parseConfirmation } from "@/lib/auth/confirmation";

export default async function Confirm({ searchParams }: {
  searchParams: Promise<{ token_hash?: string | string[]; type?: string | string[] }>;
}) {
  const { token_hash: token, type } = await searchParams;
  const confirmation = parseConfirmation(token, type);
  if (!confirmation) {
    return <>
      <h1 className="mb-4 text-2xl font-semibold">Invalid email link</h1>
      <p>Request a new email to continue.</p>
      <Link href="/verify-email" className="mt-4 block underline">Email verification</Link>
      <Link href="/forgot-password" className="mt-4 block underline">Password recovery</Link>
    </>;
  }
  const recovery = confirmation.mode === "recover";
  // A GET never consumes the token. Mail scanners/prefetch cannot verify an
  // account or reset a password; the user must submit a same-origin action.
  return <>
    <h1 className="mb-4 text-2xl font-semibold">{recovery ? "Choose a new password" : "Confirm your email"}</h1>
    <p className="mb-6 text-sm text-muted-foreground">{recovery ? "After changing your password, sign in again. Other sessions will end as their access tokens expire." : "Continue to verify your email, then sign in."}</p>
    <AuthForm mode={confirmation.mode} action={recovery ? recoverAction : verifyAction} tokenHash={confirmation.token} />
    <nav aria-label="Account help" className="mt-6 flex flex-col gap-3 text-sm underline">
      <Link href={recovery ? "/forgot-password" : "/verify-email"}>Request a new email</Link>
      <Link href="/sign-in">Back to sign in</Link>
    </nav>
  </>;
}
