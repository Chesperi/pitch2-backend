import { pool } from "../db";

export type StaffFinanceVisibility = "HIDDEN" | "VISIBLE";

export type StaffProfileAuth = {
  id: number;
  email: string | null;
  name: string;
  surname: string;
  user_level: string;
  active: boolean;
  finance_visibility: StaffFinanceVisibility;
};

export async function getStaffProfileById(
  staffId: number
): Promise<StaffProfileAuth | null> {
  const result = await pool.query<{
    id: number;
    email: string | null;
    name: string;
    surname: string;
    user_level: string;
    active: boolean;
    finance_visibility: StaffFinanceVisibility;
  }>(
    `SELECT id, email, name, surname, user_level, active, finance_visibility
     FROM staff
     WHERE id = $1`,
    [staffId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    surname: row.surname,
    user_level: row.user_level,
    active: row.active,
    finance_visibility: row.finance_visibility,
  };
}
