import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { forgotPasswordAction } from "@/app/auth/actions";

export default function ForgotPassword() {
  return <>
    <h1 className="mb-3 text-2xl font-semibold">Reset your password</h1>
    <p className="mb-6 text-sm text-muted-foreground">We will email you a link if your account is eligible for recovery.</p>
    <AuthForm mode="forgot-password" action={forgotPasswordAction} />
    <Link href="/sign-in" className="mt-6 block text-sm underline">Back to sign in</Link>
  </>;
}
