import Link from "next/link";

export default function CheckEmailPage() {
  return (
    <div className="card stack">
      <h1>Check your email</h1>
      <p>
        We sent you a confirmation link. Click it to verify your address, then come back and{" "}
        <Link href="/sign-in">sign in</Link>.
      </p>
    </div>
  );
}
