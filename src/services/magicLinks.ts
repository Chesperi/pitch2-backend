import { randomUUID } from "crypto";
import { pool } from "../db";

const MAGIC_LINK_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 giorni

export async function createMagicLinkForStaff(staffId: number): Promise<string> {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);

  await pool.query(
    `INSERT INTO magic_links (staff_id, token, expires_at) VALUES ($1, $2, $3)`,
    [staffId, token, expiresAt]
  );

  return token;
}

export async function resolveMagicLinkToken(token: string): Promise<{ staffId: number } | null> {
  const result = await pool.query(
    `SELECT staff_id, expires_at FROM magic_links WHERE token = $1`,
    [token]
  );

  const record = result.rows[0];
  if (!record) return null;
  if (new Date(record.expires_at) < new Date()) return null;

  return { staffId: record.staff_id };
}
