import { pool } from "../db";
import type { StaffId } from "../types/staffId";
import { normalizeStaffId } from "../types/staffId";

export type StaffFinanceVisibility = "HIDDEN" | "VISIBLE";

export type StaffProfileAuth = {
  id: StaffId;
  email: string | null;
  name: string;
  surname: string;
  user_level: string;
  active: boolean;
  finance_visibility: StaffFinanceVisibility;
};

/**
 * Risolve lo staff per PK `id` o per `supabase_id` (stesso valore di auth.users.id).
 */
export async function getStaffProfileById(
  staffOrSupabaseId: string
): Promise<StaffProfileAuth | null> {
  const key = normalizeStaffId(staffOrSupabaseId);
  const result = await pool.query<{
    id: string;
    email: string | null;
    name: string;
    surname: string;
    user_level: string;
    active: boolean;
    finance_visibility: StaffFinanceVisibility;
  }>(
    `SELECT id, email, name, surname, user_level, active, finance_visibility
     FROM staff
     WHERE active = true
       AND (
         LOWER(TRIM(id::text)) = $1
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
    finance_visibility: row.finance_visibility,
  };
}
