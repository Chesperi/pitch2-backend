import { pool } from "../db";
import type { StaffId } from "../types/staffId";
import { isStaffId, normalizeStaffId } from "../types/staffId";

export type StaffProfileAuth = {
  id: StaffId;
  email: string | null;
  name: string;
  surname: string;
  user_level: string;
  active: boolean;
  finance_visibility: boolean;
};

/**
 * Risolve lo staff per PK `id` o per `supabase_id` (stesso valore di auth.users.id).
 */
export async function getStaffProfileById(
  staffOrSupabaseId: string
): Promise<StaffProfileAuth | null> {
  const key = normalizeStaffId(staffOrSupabaseId);
  const result = await pool.query<{
    id: number;
    email: string | null;
    name: string;
    surname: string;
    user_level: string;
    active: boolean;
    finance_visibility: boolean;
  }>(
    `SELECT id, email, name, surname, user_level, active, finance_visibility
     FROM staff
     WHERE active = true
       AND (
         TRIM(id::text) = $1
         OR (
           supabase_id IS NOT NULL
           AND LOWER(TRIM(supabase_id::text)) = $1
         )
       )
     LIMIT 1`,
    [key]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: String(row.id),
    email: row.email,
    name: row.name,
    surname: row.surname,
    user_level: row.user_level,
    active: row.active,
    finance_visibility: Boolean(row.finance_visibility),
  };
}

/** `assignments.staff_id` è INTEGER: risolve sessione (UUID supabase o id numerico) in PK staff. */
export async function resolveStaffDbIntegerId(sessionOrKey: string): Promise<number | null> {
  const key = normalizeStaffId(sessionOrKey);
  const result = await pool.query<{ id: number }>(
    `SELECT id FROM staff
     WHERE active = true
       AND (
         TRIM(id::text) = $1
         OR (
           supabase_id IS NOT NULL
           AND LOWER(TRIM(supabase_id::text)) = $1
         )
       )
     LIMIT 1`,
    [key]
  );
  return result.rows[0]?.id ?? null;
}

/**
 * Dalla PK intera `staff.id` (come in auth_magic_links.staff_id) restituisce
 * supabase_id (auth.users.id) in forma normalizzata, per cookie pitch2_magic_session
 * e coerenza con isStaffId.
 */
export async function getStaffSupabaseIdByDbPk(
  staffPk: number
): Promise<string | null> {
  if (!Number.isFinite(staffPk) || staffPk < 1) return null;
  const result = await pool.query<{ supabase_id: string | null }>(
    `SELECT supabase_id::text AS supabase_id
     FROM staff
     WHERE id = $1 AND active = true
     LIMIT 1`,
    [Math.floor(staffPk)]
  );
  const raw = result.rows[0]?.supabase_id;
  if (raw == null || String(raw).trim() === "") return null;
  const normalized = normalizeStaffId(String(raw));
  return isStaffId(normalized) ? normalized : null;
}
