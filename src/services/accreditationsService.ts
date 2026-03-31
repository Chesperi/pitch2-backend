import { pool } from "../db";
import type { AccreditationWithStaff } from "../types";
import type { StaffId } from "../types/staffId";

function toIsoTimestamp(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function toIsoDateOnly(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

export async function listAccreditationsByEventId(
  eventId: number
): Promise<AccreditationWithStaff[]> {
  const sql = `
    SELECT
      a.id,
      a.event_id,
      a.staff_id,
      a.role_code,
      a.areas,
      a.plates,
      a.notes,
      a.created_at,
      a.updated_at,
      s.surname AS staff_surname,
      s.name AS staff_name,
      s.company AS staff_company,
      s.place_of_birth AS staff_place_of_birth,
      s.date_of_birth AS staff_date_of_birth,
      s.default_role_code AS staff_default_role_code,
      s.plates AS staff_plates,
      s.notes AS staff_notes
    FROM accreditations a
    JOIN staff s ON s.id = a.staff_id
    WHERE a.event_id = $1
      AND (a.active IS TRUE)
    ORDER BY s.surname ASC, s.name ASC, a.id ASC
  `;
  const result = await pool.query<{
    id: number;
    event_id: number;
    staff_id: string;
    role_code: string | null;
    areas: string | null;
    plates: string | null;
    notes: string | null;
    created_at: unknown;
    updated_at: unknown;
    staff_surname: string;
    staff_name: string;
    staff_company: string | null;
    staff_place_of_birth: string | null;
    staff_date_of_birth: unknown;
    staff_default_role_code: string | null;
    staff_plates: string | null;
    staff_notes: string | null;
  }>(sql, [eventId]);

  return result.rows.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    staffId: String(row.staff_id) as StaffId,
    roleCode: row.role_code,
    areas: row.areas,
    plates: row.plates,
    notes: row.notes,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
    staffSurname: row.staff_surname,
    staffName: row.staff_name,
    staffCompany: row.staff_company,
    staffPlaceOfBirth: row.staff_place_of_birth,
    staffDateOfBirth: toIsoDateOnly(row.staff_date_of_birth),
    staffDefaultRoleCode: row.staff_default_role_code,
    staffPlates: row.staff_plates,
    staffNotes: row.staff_notes,
  }));
}
