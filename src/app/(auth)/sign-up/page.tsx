import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { signUpAction } from "@/app/auth/actions";

export default function SignUp() {
  return <>
    <h1 className="mb-3 text-2xl font-semibold">Create an account</h1>
    <p className="mb-6 text-sm text-muted-foreground">Verify your email before signing in. Your account information is private.</p>
    <AuthForm mode="sign-up" action={signUpAction} />
    <nav aria-label="Account help" className="mt-6 flex flex-col gap-3 text-sm underline">
      <Link href="/sign-in">Already have an account? Sign in</Link>
      <Link href="/verify-email">Resend verification email</Link>
    </nav>
  </>;
}
