import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { signOutAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser("/settings");
  return (
    <main className="wrap">
      <h1>Settings</h1>
      <p className="lead">Signed in as {user.email}.</p>
      <form action={signOutAction} className="form">
        <button className="btn" type="submit">Sign out</button>
      </form>
      <p className="meta">
        Your vehicles and entries are visible only to this account. Buyer share
        links stay public to whoever you send them to.
      </p>
      <p className="meta"><Link href="/">← All vehicles</Link></p>
    </main>
  );
}
