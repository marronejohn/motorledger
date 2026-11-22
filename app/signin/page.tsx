import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { signInAction, signUpAction } from "@/app/actions";

export const dynamic = "force-dynamic";

// One screen for both: /signin signs in, /signin?mode=signup creates the
// account (name optional, email + password of 8+ characters, nothing else).
export default async function SigninPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; err?: string; next?: string }>;
}) {
  const { mode, err, next } = await searchParams;
  if (await currentUser()) redirect(next || "/");
  const isSignup = mode === "signup";
  const nextQ = next ? `&next=${encodeURIComponent(next)}` : "";
  const toggleHref = isSignup ? `/signin?next=${encodeURIComponent(next || "/")}` : `/signin?mode=signup${nextQ}`;
  return (
    <main className="wrap">
      <h1>MotorLedger</h1>
      <p className="lead">
        {isSignup
          ? "Create your account: your vehicles and entries stay private to it."
          : "Sign in to see your vehicles and entries."}
      </p>
      <form action={isSignup ? signUpAction : signInAction} className="form">
        <input type="hidden" name="next" value={next || "/"} />
        {isSignup && (
          <label>
            Name (optional)
            <input name="name" autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={isSignup ? 8 : undefined}
            autoComplete={isSignup ? "new-password" : "current-password"}
          />
        </label>
        {err && <p className="err">{err}</p>}
        <button className="btn" type="submit">
          {isSignup ? "Create account" : "Sign in"}
        </button>
      </form>
      <p className="meta">
        {isSignup ? "Already have an account? " : "New here? "}
        <Link href={toggleHref}>{isSignup ? "Sign in instead" : "Create an account"}</Link>
      </p>
    </main>
  );
}
