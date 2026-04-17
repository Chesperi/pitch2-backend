import { pool } from "../db";
import { getAreasForOwnerAndRole } from "./accreditationAreasService";

export type OnsiteAccreditationStaffItem = {
  assignmentId: number | null;
  accreditationId: number | null;
  staffId: number;
  company: string | null;
  surname: string | null;
  name: string | null;
  placeOfBirth: string | null;
  dateOfBirth: string | null;
  roleCode: string | null;
  areas: string | null;
  plates: string | null;
  notes: string | null;
};

type OnsiteStaffRow = {
  assignment_id: number | null;
  role_code: string | null;
  role_location: string | null;
  assignment_status: string | null;
  plate_selected: string | null;
  staff_id: number;
  surname: string | null;
  name: string | null;
  company: string | null;
  place_of_birth: string | null;
  date_of_birth: string | null;
  staff_plates: string | null;
  accreditation_id: number | null;
  manual_areas: string | null;
  manual_plates: string | null;
  manual_notes: string | null;
};

export async function listOnsiteAccreditationStaff(
  eventId: string,
  ownerCode: string
): Promise<OnsiteAccreditationStaffItem[]> {
  const result = await pool.query<OnsiteStaffRow>(
    `SELECT
      a.id as assignment_id,
      a.role_code,
      a.role_location,
      a.status as assignment_status,
      a.plate_selected,
      s.id as staff_id,
      s.surname,
      s.name,
      s.company,
      s.place_of_birth,
      s.date_of_birth,
      s.plates as staff_plates,
      acc.id as accreditation_id,
      acc.areas as manual_areas,
      acc.plates as manual_plates,
      acc.notes as manual_notes
    FROM assignments a
    JOIN staff s ON s.id = a.staff_id
    LEFT JOIN accreditations acc ON acc.event_id = a.event_id
      AND acc.staff_id = a.staff_id
      AND acc.active = true
    WHERE a.event_id = $1
      AND a.role_location = 'STADIO'
      AND a.staff_id IS NOT NULL
    UNION ALL
    SELECT
      null,
      acc.role_code,
      'STADIO',
      null,
      null,
      s.id,
      s.surname,
      s.name,
      s.company,
      s.place_of_birth,
      s.date_of_birth,
      s.plates,
      acc.id,
      acc.areas,
      acc.plates,
      acc.notes
    FROM accreditations acc
    JOIN staff s ON s.id = acc.staff_id
    WHERE acc.event_id = $1
      AND acc.active = true
      AND NOT EXISTS (
        SELECT 1 FROM assignments a2
        WHERE a2.event_id = acc.event_id
          AND a2.staff_id = acc.staff_id
          AND a2.role_location = 'STADIO'
      )
    ORDER BY surname ASC`,
    [eventId]
  );

  const items = await Promise.all(
    result.rows.map(async (row) => {
      const manualAreas =
        row.manual_areas != null && String(row.manual_areas).trim() !== ""
          ? String(row.manual_areas).trim()
          : null;
      const roleCode = row.role_code ?? null;
      const autoAreas =
        (await getAreasForOwnerAndRole(ownerCode, roleCode)) ??
        (await getAreasForOwnerAndRole("lega", roleCode));
      console.log("getAreasForOwnerAndRole", ownerCode, roleCode, "->", autoAreas);
      const derivedAreas = manualAreas ?? autoAreas;

      return {
        assignmentId: row.assignment_id,
        accreditationId: row.accreditation_id,
        staffId: row.staff_id,
        company: row.company,
        surname: row.surname,
        name: row.name,
        placeOfBirth: row.place_of_birth,
        dateOfBirth: row.date_of_birth,
        roleCode: row.role_code,
        areas: derivedAreas != null && String(derivedAreas).trim() !== "" ? derivedAreas : null,
        plates: row.plate_selected ?? row.manual_plates ?? row.staff_plates ?? null,
        notes: row.manual_notes ?? null,
      } satisfies OnsiteAccreditationStaffItem;
    })
  );

  const seen = new Set<number>();
  const deduped = items.filter((row) => {
    const id = Number(row.staffId);
    if (!Number.isFinite(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return deduped;
}
