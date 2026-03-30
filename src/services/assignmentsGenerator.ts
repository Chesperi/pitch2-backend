import type { Pool } from "pg";

/**
 * Genera gli slot di assignment mancanti per un evento quando è "pronto"
 * (status OK o CONFIRMED) e ha standard_onsite + standard_cologno valorizzati.
 *
 * Logica quantità: per ogni riga in `standard_requirements` che matcha
 * (standard_onsite, standard_cologno [, area_produzione se valorizzata sull'evento]),
 * `quantity` è letta dalla colonna `sr.quantity` (minimo 1). Si conta quante
 * righe `assignments` esistono già per (event_id, role_id) e si inseriscono
 * solo `max(0, quantity - count)` nuove righe DRAFT con staff_id NULL.
 * Non esiste in DB distinzione "slot da standard" vs "slot extra": sono tutte
 * righe `assignments`; gli extra sono POST /api/assignments indistinguibili dopo insert.
 */
export async function ensureAssignmentsForEvent(
  pool: Pool,
  eventId: number
): Promise<void> {
  const eventResult = await pool.query(
    `SELECT id, standard_onsite, standard_cologno, location AS area_produzione, status
     FROM events
     WHERE id = $1`,
    [eventId]
  );

  if (eventResult.rows.length === 0) return;

  const event = eventResult.rows[0] as {
    id: number;
    standard_onsite: string | null;
    standard_cologno: string | null;
    area_produzione: string | null;
    status: string;
  };

  const standardOnsite = event.standard_onsite?.trim();
  const standardCologno = event.standard_cologno?.trim();
  const areaProduzione = event.area_produzione?.trim();

  if (!standardOnsite || !standardCologno) return;
  if (!["OK", "CONFIRMED"].includes(event.status)) return;

  const requirementsParams: unknown[] = [standardOnsite, standardCologno];
  let requirementsWhere = "sr.standard_onsite = $1 AND sr.standard_cologno = $2";
  if (areaProduzione) {
    requirementsParams.push(areaProduzione);
    requirementsWhere += ` AND sr.area_produzione = $${requirementsParams.length}`;
  }

  const requirementsResult = await pool.query(
    `SELECT sr.role_id, sr.quantity
     FROM standard_requirements sr
     WHERE ${requirementsWhere}`,
    requirementsParams
  );

  for (const reqRow of requirementsResult.rows) {
    const role_id = reqRow.role_id;
    const quantity = Math.max(1, parseInt(String(reqRow.quantity), 10) || 1);

    const countResult = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM assignments
       WHERE event_id = $1 AND role_id = $2`,
      [eventId, role_id]
    );
    const existingCount = parseInt(countResult.rows[0]?.cnt ?? "0", 10);

    const toCreate = Math.max(0, quantity - existingCount);
    for (let i = 0; i < toCreate; i++) {
      await pool.query(
        `INSERT INTO assignments (event_id, role_id, staff_id, status, notes)
         VALUES ($1, $2, NULL, 'DRAFT', NULL)`,
        [eventId, role_id]
      );
    }
  }
}
