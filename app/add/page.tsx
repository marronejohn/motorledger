import { isOwner } from "@/lib/auth";
import Link from "next/link";
import AddForm from "./add-form";

export const dynamic = "force-dynamic";

export default async function AddPage() {
  const owner = await isOwner();
  return (
    <main className="wrap">
      {owner ? (
        <AddForm />
      ) : (
        <>
          <h1>Add a vehicle</h1>
          <p className="lead">This screen is locked. <Link href="/unlock?next=/add">Unlock with your passcode</Link> to add vehicles.</p>
        </>
      )}
    </main>
  );
}
