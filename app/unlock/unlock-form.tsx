"use client";

import { useState } from "react";
import { doUnlock } from "@/app/actions";

export default function UnlockForm({ next, bad }: { next: string; bad: boolean }) {
  const [passcode, setPasscode] = useState("");
  return (
    <form action={doUnlock} className="form">
      <input type="hidden" name="next" value={next} />
      <label>
        Passcode
        <input
          name="passcode"
          type="text" spellCheck={false} autoComplete="off" autoCapitalize="none"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          autoFocus
        />
      </label>
      {bad && <p className="err">That passcode did not match, try again.</p>}
      <button className="btn" type="submit">Unlock</button>
    </form>
  );
}
