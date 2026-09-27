import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { resendAction } from "@/app/auth/actions";

export default function VerifyEmail() {
  return <>
    <h1 className="mb-6 text-2xl font-semibold">Verify your email</h1>
    <AuthForm mode="resend" action={resendAction} />
    <Link href="/sign-in" className="mt-6 block text-sm underline">Back to sign in</Link>
  </>;
}
