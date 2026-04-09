import { createHmac, timingSafeEqual } from "crypto";
import { Request, Response } from "express";
import type { StaffId } from "../types/staffId";
import { isStaffId, normalizeStaffId } from "../types/staffId";

const SESSION_SECRET =
  process.env.SESSION_SECRET || "pitch2-dev-secret-change-in-production";
const MAGIC_COOKIE = "pitch2_magic_session";
const PERSISTENT_COOKIE = "pitch2_session";
const MAGIC_TTL_SEC = 30 * 60; // 30 minuti
const PERSISTENT_TTL_SEC = 30 * 24 * 60 * 60; // 30 giorni
const SHORT_TTL_SEC = 24 * 60 * 60; // 1 giorno (quando rememberMe=false)

function sign(value: string): string {
  const sig = createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
  return `${value}.${sig}`;
}

function unsign(signed: string): string | null {
  const i = signed.lastIndexOf(".");
  if (i === -1) return null;
  const value = signed.slice(0, i);
  const sig = signed.slice(i + 1);
  const expected = createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return value;
}

const COOKIE_DOMAIN = process.env.SESSION_COOKIE_DOMAIN || undefined; // es. .designazionipitch.com per api + app

const cookieOpts = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: maxAge * 1000,
  path: "/",
  ...(COOKIE_DOMAIN && { domain: COOKIE_DOMAIN }),
});

export function setMagicSession(res: Response, staffId: StaffId): void {
  const payload = JSON.stringify({
    staffId: normalizeStaffId(staffId),
    issuedAt: Date.now(),
  });
  res.cookie(MAGIC_COOKIE, sign(payload), cookieOpts(MAGIC_TTL_SEC));
}

export function clearMagicSession(res: Response): void {
  res.clearCookie(MAGIC_COOKIE, { path: "/" });
}

export function clearPersistentSession(res: Response): void {
  res.clearCookie(PERSISTENT_COOKIE, { path: "/" });
}

export function setPersistentSession(
  res: Response,
  staffId: StaffId,
  rememberMe: boolean
): void {
  const sid = normalizeStaffId(staffId);
  const sessionId = createHmac("sha256", SESSION_SECRET)
    .update(`${sid}-${Date.now()}-${Math.random()}`)
    .digest("hex")
    .slice(0, 32);
  const payload = JSON.stringify({ staffId: sid, sessionId });
  const ttl = rememberMe ? PERSISTENT_TTL_SEC : SHORT_TTL_SEC;
  res.cookie(PERSISTENT_COOKIE, sign(payload), cookieOpts(ttl));
}

/** Cookie operativo `pitch2_session` per le API (default: sessione lunga come rememberMe=true). */
export function createPitch2PersistentSession(
  res: Response,
  staffId: StaffId,
  options?: { rememberMe?: boolean }
): void {
  const rememberMe = options?.rememberMe !== false;
  setPersistentSession(res, staffId, rememberMe);
}

export type Pitch2Session =
  | { type: "persistent"; staffId: StaffId }
  | { type: "magic"; staffId: StaffId };

/** @deprecated Use Pitch2Session */
export type SessionInfo = Pitch2Session;

export function getCurrentSession(req: Request): Pitch2Session | null {
  const persistent = req.cookies?.[PERSISTENT_COOKIE];
  if (persistent) {
    const raw = unsign(persistent);
    if (raw) {
      try {
        const { staffId } = JSON.parse(raw) as { staffId?: unknown };
        if (isStaffId(staffId))
          return { type: "persistent", staffId: normalizeStaffId(staffId) };
      } catch {
        // invalid
      }
    }
  }

  const magic = req.cookies?.[MAGIC_COOKIE];
  if (magic) {
    const raw = unsign(magic);
    if (raw) {
      try {
        const { staffId, issuedAt } = JSON.parse(raw) as {
          staffId?: unknown;
          issuedAt?: unknown;
        };
        if (isStaffId(staffId) && typeof issuedAt === "number") {
          const age = Date.now() - issuedAt;
          if (age < MAGIC_TTL_SEC * 1000)
            return { type: "magic", staffId: normalizeStaffId(staffId) };
        }
      } catch {
        // invalid
      }
    }
  }

  return null;
}
