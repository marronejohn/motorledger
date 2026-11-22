"use client";

import { useState } from "react";
import { changePasscode, removePasscodeAction } from "@/app/actions";

export default function SettingsForm({
  configured,
  needsSetupToken,
}: {
  configured: boolean;
  needsSetupToken?: boolean;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");

  if (!configured) {
    return (
      <form action={changePasscode} className="form">
        <input type="hidden" name="mode" value="set" />
        {needsSetupToken && (
          <label>
            Setup token
            <input
              name="setupToken"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="none"
            />
          </label>
        )}
        <label>
          New passcode
          <input
            name="next"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="none"
          />
        </label>
        <button className="btn" type="submit" disabled={!next.trim()}>
          Turn on passcode
        </button>
      </form>
    );
  }
  return (
    <>
      <form action={changePasscode} className="form">
        <input type="hidden" name="mode" value="change" />
        <label>
          Current passcode
          <input
            name="current"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="none"
          />
        </label>
        <label>
          New passcode
          <input
            name="next"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="none"
          />
        </label>
        <button className="btn" type="submit" disabled={!next.trim() || !current.trim()}>
          Change passcode
        </button>
      </form>
      <form action={removePasscodeAction} className="form">
        <input type="hidden" name="current" value={current} />
        <button className="btn" type="submit" disabled={!current.trim()}>
          Remove passcode
        </button>
      </form>
    </>
  );
}
