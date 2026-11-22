import { cookies } from "next/headers";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

// The passcode is the app user's own choice, stored in the database:
// off by default (the app is open), and the user turns it on, changes it,
// or removes it from /settings. When it is on, the write screens (/add,
// adding entries) ask for it; the share/buyer views always stay public.
// The cookie carries a token derived from the stored hash, never the
// passcode itself, and changing or removing the passcode invalidates it.
const COOKIE = "ml_owner";
const KEY = "ownerPasscode";

type Stored = { salt: string; hash: string };

// The AppSetting table is created on first use so the app works on a fresh
// database without a migration step. CREATE TABLE IF NOT EXISTS is idempotent.
let tableReady: Promise<unknown> | null = null;
function ensureTable(): Promise<unknown> {
  tableReady ??= db.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS "AppSetting" ("id" SERIAL PRIMARY KEY, "key" TEXT NOT NULL UNIQUE, "value" TEXT NOT NULL)'
  );
  return tableReady;
}

async function readStored(): Promise<Stored | null> {
  await ensureTable();
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Stored;
    return parsed?.salt && parsed?.hash ? parsed : null;
  } catch {
    return null;
  }
}

function tokenFor(stored: Stored): string {
  return createHash("sha256").update(`${stored.salt}:${stored.hash}`).digest("hex").slice(0, 32);
}

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: true,
  path: "/",
  maxAge: 60 * 60 * 24 * 90, // 90 days
};

export async function passcodeConfigured(): Promise<boolean> {
  return (await readStored()) !== null;
}

export async function isOwner(): Promise<boolean> {
  const stored = await readStored();
  if (!stored) return true; // the user chose not to use a passcode
  const jar = await cookies();
  return jar.get(COOKIE)?.value === tokenFor(stored);
}

function hashPasscode(passcode: string, salt?: string): Stored {
  const s = salt ?? randomBytes(16).toString("hex");
  return { salt: s, hash: scryptSync(passcode, s, 32).toString("hex") };
}

export async function unlockOwner(passcode: string): Promise<boolean> {
  const stored = await readStored();
  if (!stored) return true;
  const candidate = hashPasscode(passcode, stored.salt);
  const ok = timingSafeEqual(Buffer.from(candidate.hash, "hex"), Buffer.from(stored.hash, "hex"));
  if (!ok) return false;
  const jar = await cookies();
  jar.set(COOKIE, tokenFor(stored), cookieOptions);
  return true;
}

export async function setPasscode(passcode: string): Promise<void> {
  await ensureTable();
  const stored = hashPasscode(passcode);
  await db.appSetting.upsert({
    where: { key: KEY },
    update: { value: JSON.stringify(stored) },
    create: { key: KEY, value: JSON.stringify(stored) },
  });
  const jar = await cookies();
  jar.set(COOKIE, tokenFor(stored), cookieOptions);
}

export async function verifyCurrent(passcode: string): Promise<boolean> {
  const stored = await readStored();
  if (!stored) return true; // nothing to verify against
  const candidate = hashPasscode(passcode, stored.salt);
  return timingSafeEqual(Buffer.from(candidate.hash, "hex"), Buffer.from(stored.hash, "hex"));
}

export async function removePasscode(): Promise<void> {
  await ensureTable();
  await db.appSetting.deleteMany({ where: { key: KEY } });
}
