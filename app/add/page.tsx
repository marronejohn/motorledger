import { requireUser } from "@/lib/auth";
import AddForm from "./add-form";

export const dynamic = "force-dynamic";

export default async function AddPage() {
  await requireUser("/add");
  return (
    <main className="wrap">
      <AddForm />
    </main>
  );
}
