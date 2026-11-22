import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

// Per-person accounts: email + password sign-up, a signed-in session cookie,
// and every read or write scoped to the signed-in account's own vehicles.
// Passwords are scrypt-hashed with a per-user salt; session tokens are random
// and stored only as SHA-256 hashes, so a database leak reveals neither.
const COOKIE = "ml_session";
const SESSION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: true,
  path: "/",
  maxAge: 60 * 60 * 24 * 90,
};

export type SessionUser = { id: string; email: string; name: string | null };

function hashPassword(password: string, salt?: string): string {
  const s = salt ?? randomBytes(16).toString("hex");
  return `${s}:${scryptSync(password, s, 64).toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64).toString("hex");
  return timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function startSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: { tokenHash: tokenHash(token), userId, expiresAt: new Date(Date.now() + SESSION_MS) },
  });
  const jar = await cookies();
  jar.set(COOKIE, token, cookieOptions);
}

// Returns an error message, or null when the account was created and the
// new session is signed in.
export async function signUp(
  email: string,
  password: string,
  name: string
): Promise<string | null> {
  const clean = email.trim().toLowerCase();
  if (!validEmail(clean)) return "That email does not look right.";
  if (password.length < 8) return "Passwords need at least 8 characters.";
  try {
    const user = await db.user.create({
      data: { email: clean, passwordHash: hashPassword(password), name: name.trim() || null },
    });
    await startSession(user.id);
    return null;
  } catch (err: unknown) {
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") {
      return "That email already has an account. Sign in instead.";
    }
    return "Could not create the account, try again.";
  }
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const clean = email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email: clean } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return "That email and password do not match.";
  }
  await startSession(user.id);
  return null;
}

export async function signOut(): Promise<void> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

// For pages and actions: bounce strangers to the sign-in screen, remembering
// where they were headed so sign-in returns them there.
export async function requireUser(next = "/"): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(next)}`);
  return user;
}
