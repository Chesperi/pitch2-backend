import { Router, Request } from "express";
import { pool } from "../db";

const router = Router();

const selectCols = `
  a.id as a_id, a.event_id as a_event_id, a.role_id as a_role_id, a.staff_id as a_staff_id,
  a.status as a_status, a.notes as a_notes, a.created_at as a_created_at, a.updated_at as a_updated_at,
  e.external_match_id as e_external_match_id, e.category as e_category, e.competition_name as e_competition_name,
  e.competition_code as e_competition_code, e.matchday as e_matchday,
  e.home_team_name_short as e_home_team_name_short, e.away_team_name_short as e_away_team_name_short,
  e.venue_name as e_venue_name, e.venue_city as e_venue_city, e.ko_italy as e_ko_italy,
  e.status as e_status,
  s.surname as s_surname, s.name as s_name, s.email as s_email, s.phone as s_phone,
  s.company as s_company, s.fee as s_fee, s.plates as s_plates,
  r.code as r_code, r.name as r_name, r.location as r_location
`;

// POST /api/designazioni/send-person - invia mail a UNA persona (simulato)
router.post("/send-person", async (req: Request, res) => {
  try {
    const { staffId, assignmentIds } = req.body as {
      staffId: number;
      assignmentIds: number[];
    };

    if (
      !staffId ||
      !Array.isArray(assignmentIds) ||
      assignmentIds.length === 0
    ) {
      res.status(400).json({ error: "Missing staffId or assignmentIds" });
      return;
    }

    const placeholders = assignmentIds.map((_, i) => `$${i + 2}`).join(", ");
    const result = await pool.query(
      `SELECT ${selectCols}
       FROM assignments a
       JOIN events e ON e.id = a.event_id
       JOIN roles r ON r.id = a.role_id
       LEFT JOIN staff s ON s.id = a.staff_id
       WHERE a.id IN (${placeholders}) AND a.staff_id = $1`,
      [staffId, ...assignmentIds]
    );

    const assignments = result.rows;

    console.log("SEND PERSON MAIL", {
      staffId,
      assignmentIds,
      count: assignments.length,
    });

    // TODO: qui in futuro costruire corpo mail e inviare davvero

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("POST /api/designazioni/send-person error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// POST /api/designazioni/send-period - invia mail a TUTTI nel periodo (simulato)
router.post("/send-period", async (req: Request, res) => {
  try {
    const { from, to } = req.body as { from: string; to: string };

    if (!from || !to) {
      res.status(400).json({ error: "Missing from/to" });
      return;
    }

    const result = await pool.query(
      `SELECT a.id as a_id, a.staff_id as a_staff_id
       FROM assignments a
       JOIN events e ON e.id = a.event_id
       WHERE e.ko_italy::date >= $1 AND e.ko_italy::date <= $2
       AND a.staff_id IS NOT NULL`,
      [from, to]
    );

    const map = new Map<number, number[]>();
    for (const row of result.rows) {
      const staffId = row.a_staff_id as number;
      const id = row.a_id as number;
      const list = map.get(staffId) ?? [];
      list.push(id);
      map.set(staffId, list);
    }

    console.log("SEND PERIOD MAIL", {
      from,
      to,
      people: map.size,
    });

    // TODO: qui in futuro iterare sulla mappa e spedire una mail per persona

    res.status(200).json({ success: true, people: map.size });
  } catch (err) {
    console.error("POST /api/designazioni/send-period error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
