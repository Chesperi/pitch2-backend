import { randomBytes } from "crypto";
import { pool } from "../db";

const TOKEN_BYTES = 40;
const EXPIRY_HOURS = 1;

export async function createPasswordResetToken(staffId: number): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO auth_password_resets (staff_id, token, expires_at) VALUES ($1, $2, $3)`,
    [staffId, token, expiresAt]
  );

  return token;
}

export type ValidateResult =
  | { valid: true }
  | { valid: false; error: string };

export async function validatePasswordResetToken(
  token: string
): Promise<ValidateResult> {
  const result = await pool.query(
    `SELECT staff_id, used_at, expires_at FROM auth_password_resets WHERE token = $1`,
    [token]
  );

  const row = result.rows[0];
  if (!row) return { valid: false, error: "Token non valido" };
  if (row.used_at) return { valid: false, error: "Token già usato" };
  if (new Date(row.expires_at) < new Date()) return { valid: false, error: "Token scaduto" };

  return { valid: true };
}

export async function getValidPasswordResetStaffId(
  token: string
): Promise<number | null> {
  const result = await pool.query(
    `SELECT staff_id, used_at, expires_at FROM auth_password_resets WHERE token = $1`,
    [token]
  );

  const row = result.rows[0];
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  return row.staff_id;
}

export async function markPasswordResetAsUsed(token: string): Promise<void> {
  await pool.query(
    `UPDATE auth_password_resets SET used_at = now() WHERE token = $1`,
    [token]
  );
}
