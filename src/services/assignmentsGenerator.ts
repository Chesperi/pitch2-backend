import type { Pool } from "pg";

/**
 * Genera gli slot di assignment mancanti per un evento quando è "pronto"
 * (status OK o CONFIRMED) e ha standard_onsite + standard_cologno valorizzati.
 *
 * Per ogni riga in `standard_requirements` che matcha (standard_onsite, standard_cologno),
 * `quantity` è letta da `sr.quantity` (minimo 1). Si conta quante righe `assignments`
 * esistono già per (event_id, role_code, role_location) e si inseriscono solo
 * `max(0, quantity - count)` nuove righe DRAFT con staff_id NULL.
 */
export async function ensureAssignmentsForEvent(
  pool: Pool,
  eventId: string
): Promise<void> {
  const eventResult = await pool.query(
    `SELECT id, standard_onsite, standard_cologno, status
     FROM events
     WHERE id = $1`,
    [eventId]
  );

  if (eventResult.rows.length === 0) return;

  const event = eventResult.rows[0] as {
    id: string;
    standard_onsite: string | null;
    standard_cologno: string | null;
    status: string;
  };

  const standardOnsite = event.standard_onsite?.trim();
  const standardCologno = event.standard_cologno?.trim();

  if (!standardOnsite || !standardCologno) return;
  if (!["OK", "CONFIRMED"].includes(event.status)) return;

  const requirementsWhere = "sr.standard_onsite = $1 AND sr.standard_cologno = $2";
  const requirementsParams: unknown[] = [standardOnsite, standardCologno];

  const requirementsResult = await pool.query(
    `SELECT sr.role_code, sr.role_location, sr.quantity
     FROM standard_requirements sr
     WHERE ${requirementsWhere}`,
    requirementsParams
  );

  for (const reqRow of requirementsResult.rows) {
    const role_code = String(reqRow.role_code ?? "");
    const role_location = String(reqRow.role_location ?? "").trim();
    if (!role_code || !role_location) continue;
    const quantity = Math.max(1, parseInt(String(reqRow.quantity), 10) || 1);

    const countResult = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM assignments
       WHERE event_id = $1 AND role_code = $2 AND role_location = $3`,
      [eventId, role_code, role_location]
    );
    const existingCount = parseInt(countResult.rows[0]?.cnt ?? "0", 10);

    const toCreate = Math.max(0, quantity - existingCount);
    for (let i = 0; i < toCreate; i++) {
      await pool.query(
        `INSERT INTO assignments (event_id, role_code, role_location, staff_id, status, notes)
         VALUES ($1, $2, $3, NULL, 'DRAFT', NULL)`,
        [eventId, role_code, role_location]
      );
    }
  }
}
