import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { signInAction } from "@/app/auth/actions";

const notices: Record<string, string> = {
  verified: "Email verified. You can now sign in.",
  recovered: "Password updated. Sign in with your new password.",
  "signed-out": "You have signed out.",
};

export default async function SignIn({ searchParams }: { searchParams: Promise<{ notice?: string | string[] }> }) {
  const { notice } = await searchParams;
  return <>
    <h1 className="mb-6 text-2xl font-semibold">Sign in</h1>
    {typeof notice === "string" && Object.hasOwn(notices, notice) && <p role="status" className="mb-4 text-sm">{notices[notice]}</p>}
    <AuthForm mode="sign-in" action={signInAction} />
    <nav aria-label="Account help" className="mt-6 flex flex-col gap-3 text-sm underline">
      <Link href="/sign-up">Create an account</Link>
      <Link href="/forgot-password">Forgot password?</Link>
      <Link href="/verify-email">Resend verification email</Link>
    </nav>
  </>;
}
