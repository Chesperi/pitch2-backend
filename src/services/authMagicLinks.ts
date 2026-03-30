import { randomBytes } from "crypto";
import { pool } from "../db";

const AUTH_MAGIC_LINK_TTL_MS = 1000 * 60 * 15; // 15 minuti
const TOKEN_BYTES = 32;

export async function createAuthMagicLink(
  staffId: number,
  redirectPath = "/designazioni"
): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + AUTH_MAGIC_LINK_TTL_MS);

  await pool.query(
    `INSERT INTO auth_magic_links (staff_id, token, expires_at, redirect_path)
     VALUES ($1, $2, $3, $4)`,
    [staffId, token, expiresAt, redirectPath]
  );

  return token;
}

export async function validateAndConsumeAuthMagicLink(
  token: string
): Promise<{ staffId: number; redirectPath: string } | null> {
  const result = await pool.query(
    `SELECT staff_id, redirect_path, expires_at, used_at
     FROM auth_magic_links
     WHERE token = $1`,
    [token]
  );

  const row = result.rows[0];
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  await pool.query(
    `UPDATE auth_magic_links SET used_at = now() WHERE token = $1`,
    [token]
  );

  return {
    staffId: row.staff_id,
    redirectPath: row.redirect_path || "/designazioni",
  };
}
