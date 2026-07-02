import Link from "next/link";

export default function ForgotPasswordCheckEmailPage() {
  return (
    <div className="card stack">
      <h1>Check your email</h1>
      <p>If an account exists for that address, we sent a link to reset your password.</p>
      <Link href="/sign-in">Back to sign in</Link>
    </div>
  );
}
