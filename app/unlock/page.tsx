import Link from "next/link";
import { passcodeConfigured } from "@/lib/auth";
import UnlockForm from "./unlock-form";

export const dynamic = "force-dynamic";

export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; bad?: string }>;
}) {
  const { next, bad } = await searchParams;
  const configured = await passcodeConfigured();
  return (
    <main className="wrap">
      <h1>Unlock</h1>
      {!configured ? (
        <p className="meta">
          No passcode is set, so this app is open. You can turn one on in{" "}
          <Link href="/settings">Settings</Link>.
        </p>
      ) : (
        <>
          <p className="lead">Enter the owner passcode to add vehicles and log entries.</p>
          <UnlockForm next={next ?? "/"} bad={bad === "1"} />
        </>
      )}
    </main>
  );
}
