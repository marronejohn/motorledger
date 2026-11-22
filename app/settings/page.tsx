import Link from "next/link";
import { isOwner, passcodeConfigured } from "@/lib/auth";
import SettingsForm from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; removed?: string; bad?: string }>;
}) {
  const { saved, removed, bad } = await searchParams;
  const configured = await passcodeConfigured();
  if (configured && !(await isOwner())) {
    return (
      <main className="wrap">
        <h1>Settings</h1>
        <p className="lead">
          A passcode is on. <Link href="/unlock?next=/settings">Unlock</Link> to change it.
        </p>
      </main>
    );
  }
  return (
    <main className="wrap">
      <h1>Settings</h1>
      <p className="lead">
        A passcode is optional. With one on, adding vehicles and entries asks for it; buyer
        share links stay public either way.
      </p>
      {bad === "1" && <p className="err">That passcode did not match, nothing changed.</p>}
      {saved === "1" && <p className="lead">Passcode saved.</p>}
      {removed === "1" && <p className="lead">Passcode removed, the app is open again.</p>}
      <SettingsForm configured={configured} needsSetupToken={!configured && Boolean(process.env.SETUP_TOKEN)} />
      <p className="meta"><Link href="/">← All vehicles</Link></p>
    </main>
  );
}
