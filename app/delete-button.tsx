"use client";

import { deleteVehicle } from "@/app/actions";

export default function DeleteVehicleButton({ vehicleId }: { vehicleId: string }) {
  return (
    <form
      action={deleteVehicle}
      onSubmit={(e) => {
        if (!confirm("Delete this vehicle and its whole history? This cannot be undone.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <button type="submit" className="del">
        Delete
      </button>
    </form>
  );
}
