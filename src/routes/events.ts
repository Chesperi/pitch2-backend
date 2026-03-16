import { Router, Request } from "express";
import { pool } from "../db";
import type {
  Event,
  EventAssignmentsStatus,
  AssignmentWithJoins,
  AssignmentStatus,
} from "../types";
import { ensureAssignmentsForEvent } from "../services/assignmentsGenerator";

const router = Router();

const EVENT_ASSIGNMENTS_STATUSES: EventAssignmentsStatus[] = [
  "DRAFT",
  "READY_TO_SEND",
];

const EVENT_COLUMNS =
  "id, external_match_id, category, competition_name, competition_code, matchday," +
  "home_team_name_short, away_team_name_short, venue_name, venue_city, venue_address," +
  "ko_italy, pre_duration_minutes, standard_onsite, standard_cologno," +
  "location AS area_produzione, show_name, status, notes, assignments_status";

function rowToEvent(row: Record<string, unknown>): Event {
  const assignmentsStatus = row.assignments_status;
  const safeAssignmentsStatus: EventAssignmentsStatus =
    assignmentsStatus === "DRAFT" || assignmentsStatus === "READY_TO_SEND"
      ? (assignmentsStatus as EventAssignmentsStatus)
      : "DRAFT";

  return {
    id: Number(row.id),
    externalMatchId: row.external_match_id != null ? String(row.external_match_id) : null,
    category: String(row.category ?? ""),
    competitionName: String(row.competition_name ?? ""),
    competitionCode: row.competition_code != null ? String(row.competition_code) : null,
    matchDay: row.matchday != null ? String(row.matchday) : null,
    homeTeamNameShort: row.home_team_name_short != null ? String(row.home_team_name_short) : null,
    awayTeamNameShort: row.away_team_name_short != null ? String(row.away_team_name_short) : null,
    venueName: row.venue_name != null ? String(row.venue_name) : null,
    venueCity: row.venue_city != null ? String(row.venue_city) : null,
    venueAddress: row.venue_address != null ? String(row.venue_address) : null,
    koItaly: row.ko_italy != null ? String(row.ko_italy) : null,
    preDurationMinutes: Number(row.pre_duration_minutes ?? 0),
    standardOnsite: row.standard_onsite != null ? String(row.standard_onsite) : null,
    standardCologno: row.standard_cologno != null ? String(row.standard_cologno) : null,
    areaProduzione: row.area_produzione != null ? String(row.area_produzione) : null,
    showName: row.show_name != null ? String(row.show_name) : null,
    status: String(row.status ?? "TBD"),
    notes: row.notes != null ? String(row.notes) : null,
    assignmentsStatus: safeAssignmentsStatus,
  };
}

function rowToAssignmentWithJoins(row: Record<string, unknown>): AssignmentWithJoins {
  return {
    id: row.a_id as number,
    eventId: row.a_event_id as number,
    roleId: row.a_role_id as number,
    staffId: row.a_staff_id as number | null,
    status: row.a_status as AssignmentStatus,
    notes: row.a_notes as string | null,
    createdAt: String(row.a_created_at),
    updatedAt: String(row.a_updated_at),
    eventExternalMatchId:
      row.e_external_match_id != null ? String(row.e_external_match_id) : null,
    eventCategory: row.e_category as string,
    eventCompetitionName: row.e_competition_name as string,
    eventCompetitionCode: row.e_competition_code as string | null,
    eventMatchDay: row.e_matchday as number | null,
    eventHomeTeamNameShort: row.e_home_team_name_short as string | null,
    eventAwayTeamNameShort: row.e_away_team_name_short as string | null,
    eventVenueName: row.e_venue_name as string | null,
    eventVenueCity: row.e_venue_city as string | null,
    eventKoItaly: row.e_ko_italy != null ? String(row.e_ko_italy) : null,
    eventStatus: row.e_status as string,
    staffSurname: row.s_surname as string | null,
    staffName: row.s_name as string | null,
    staffEmail: row.s_email as string | null,
    staffPhone: row.s_phone as string | null,
    staffCompany: row.s_company as string | null,
    staffFee: row.s_fee as number | null,
    staffPlates: row.s_plates as string | null,
    roleCode: row.r_code as string,
    roleName: row.r_name as string,
    roleLocation: row.r_location as string,
  };
}

// GET /api/events
router.get("/", async (req: Request, res) => {
  try {
    const q = (req.query.q as string)?.trim() || "";
    const category = (req.query.category as string)?.trim() || "";
    const status = (req.query.status as string)?.trim() || "";
    const onlyDesignable = String(req.query.onlyDesignable).toLowerCase() === "true";
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit), 10) || 50, 1),
      100
    );
    const offset = Math.max(parseInt(String(req.query.offset), 10) || 0, 0);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (q) {
      conditions.push(
        `(home_team_name_short ILIKE $${paramIdx} OR away_team_name_short ILIKE $${paramIdx}
          OR competition_name ILIKE $${paramIdx} OR show_name ILIKE $${paramIdx})`
      );
      params.push(`%${q}%`);
      paramIdx++;
    }
    if (category) {
      conditions.push(`category = $${paramIdx}`);
      params.push(category);
      paramIdx++;
    }
    if (status) {
      conditions.push(`status = $${paramIdx}`);
      params.push(status);
      paramIdx++;
    }
    if (onlyDesignable) {
      conditions.push(`standard_onsite IS NOT NULL AND standard_onsite <> ''`);
      conditions.push(`standard_cologno IS NOT NULL AND standard_cologno <> ''`);
      conditions.push(`status IN ('OK', 'CONFIRMED')`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::int as count FROM events ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

    params.push(limit, offset);
    const itemsResult = await pool.query(
      `SELECT ${EVENT_COLUMNS}
       FROM events
       ${whereClause}
       ORDER BY ko_italy ASC NULLS LAST, id ASC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    const items = itemsResult.rows.map((r) =>
      rowToEvent(r as Record<string, unknown>)
    );

    res.json({ items, total });
  } catch (err) {
    console.error("GET /api/events error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// GET /api/events/:id
router.get("/:id", async (req: Request, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid event id" });
      return;
    }

    const result = await pool.query(
      `SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const event = rowToEvent(result.rows[0] as Record<string, unknown>);
    res.json(event);
  } catch (err) {
    console.error("GET /api/events/:id error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// POST /api/events
router.post("/", async (req: Request, res) => {
  try {
    const body = req.body;
    const category = body.category ?? "MATCH";
    const competitionName = body.competitionName ?? "";
    const competitionCode = body.competitionCode ?? null;
    const matchday = body.matchDay != null ? body.matchDay : null;
    const homeTeamNameShort = body.homeTeamNameShort ?? null;
    const awayTeamNameShort = body.awayTeamNameShort ?? null;
    const venueName = body.venueName ?? null;
    const venueCity = body.venueCity ?? null;
    const venueAddress = body.venueAddress ?? null;
    const koItaly = body.koItaly ?? null;
    const preDurationMinutes = body.preDurationMinutes ?? 0;
    const standardOnsite = body.standardOnsite ?? null;
    const standardCologno = body.standardCologno ?? null;
    const areaProduzione = body.areaProduzione ?? null;
    const showName = body.showName ?? null;
    const status = body.status ?? "TBD";
    const notes = body.notes ?? null;

    const result = await pool.query(
      `INSERT INTO events (
        category, competition_name, competition_code, matchday,
        home_team_name_short, away_team_name_short, venue_name, venue_city, venue_address,
        ko_italy, pre_duration_minutes, standard_onsite, standard_cologno, location,
        show_name, status, notes, assignments_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'DRAFT')
      RETURNING ${EVENT_COLUMNS}`,
      [
        category,
        competitionName,
        competitionCode,
        matchday,
        homeTeamNameShort,
        awayTeamNameShort,
        venueName,
        venueCity,
        venueAddress,
        koItaly,
        preDurationMinutes,
        standardOnsite,
        standardCologno,
        areaProduzione,
        showName,
        status,
        notes,
      ]
    );

    const event = rowToEvent(result.rows[0] as Record<string, unknown>);

    if (["OK", "CONFIRMED"].includes(status)) {
      await ensureAssignmentsForEvent(pool, event.id);
    }

    res.status(201).json(event);
  } catch (err) {
    console.error("POST /api/events error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// PATCH /api/events/:id
router.patch("/:id", async (req: Request, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid event id" });
      return;
    }

    const currentResult = await pool.query(
      `SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1`,
      [id]
    );
    if (currentResult.rows.length === 0) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const current = currentResult.rows[0] as Record<string, unknown>;
    const body = req.body;

    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    const map: Array<[string, string, unknown]> = [
      ["category", "category", body.category],
      ["competition_name", "competitionName", body.competitionName],
      ["competition_code", "competitionCode", body.competitionCode],
      ["matchday", "matchDay", body.matchDay],
      ["home_team_name_short", "homeTeamNameShort", body.homeTeamNameShort],
      ["away_team_name_short", "awayTeamNameShort", body.awayTeamNameShort],
      ["venue_name", "venueName", body.venueName],
      ["venue_city", "venueCity", body.venueCity],
      ["venue_address", "venueAddress", body.venueAddress],
      ["ko_italy", "koItaly", body.koItaly],
      ["pre_duration_minutes", "preDurationMinutes", body.preDurationMinutes],
      ["standard_onsite", "standardOnsite", body.standardOnsite],
      ["standard_cologno", "standardCologno", body.standardCologno],
      ["location", "areaProduzione", body.areaProduzione],
      ["show_name", "showName", body.showName],
      ["status", "status", body.status],
      ["notes", "notes", body.notes],
    ];

    let statusChanged = false;
    let standardChanged = false;

    for (const [col, key, val] of map) {
      if (val !== undefined) {
        fields.push(`${col} = $${paramIdx}`);
        values.push(val);
        paramIdx++;
        if (key === "status") statusChanged = true;
        if (key === "standardOnsite" || key === "standardCologno") standardChanged = true;
      }
    }

    if (fields.length === 0) {
      res.json(rowToEvent(current));
      return;
    }

    values.push(id);
    await pool.query(
      `UPDATE events SET ${fields.join(", ")} WHERE id = $${paramIdx}`,
      values
    );

    const updatedResult = await pool.query(
      `SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1`,
      [id]
    );
    const event = rowToEvent(updatedResult.rows[0] as Record<string, unknown>);

    if (statusChanged || standardChanged) {
      try {
        await ensureAssignmentsForEvent(pool, id);
      } catch (assignErr) {
        console.error("ensureAssignmentsForEvent error (event still updated):", assignErr);
        // Non bloccare la risposta: l'update è andato a buon fine
      }
    }

    res.json(event);
  } catch (err) {
    console.error("PATCH /api/events/:id error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// POST /api/events/:id/generate-assignments-from-standard
router.post("/:id/generate-assignments-from-standard", async (req: Request, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid event id" });
      return;
    }

    const eventResult = await pool.query(
      "SELECT id FROM events WHERE id = $1",
      [id]
    );
    if (eventResult.rows.length === 0) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    await ensureAssignmentsForEvent(pool, id);

    const itemsResult = await pool.query(
      `SELECT a.id as a_id, a.event_id as a_event_id, a.role_id as a_role_id, a.staff_id as a_staff_id,
              a.status as a_status, a.notes as a_notes, a.created_at as a_created_at, a.updated_at as a_updated_at,
              e.external_match_id as e_external_match_id, e.category as e_category, e.competition_name as e_competition_name,
              e.competition_code as e_competition_code, e.matchday as e_matchday,
              e.home_team_name_short as e_home_team_name_short, e.away_team_name_short as e_away_team_name_short,
              e.venue_name as e_venue_name, e.venue_city as e_venue_city, e.ko_italy as e_ko_italy,
              e.status as e_status,
              s.surname as s_surname, s.name as s_name, s.email as s_email, s.phone as s_phone,
              s.company as s_company, s.fee as s_fee, s.plates as s_plates,
              r.code as r_code, r.name as r_name, r.location as r_location
       FROM assignments a
       JOIN events e ON e.id = a.event_id
       JOIN roles r ON r.id = a.role_id
       LEFT JOIN staff s ON s.id = a.staff_id
       WHERE a.event_id = $1
       ORDER BY e.ko_italy ASC NULLS LAST, a.id ASC`,
      [id]
    );

    const items = itemsResult.rows.map((r) =>
      rowToAssignmentWithJoins(r as Record<string, unknown>)
    );

    res.json({ items });
  } catch (err) {
    console.error("POST /api/events/:id/generate-assignments-from-standard error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// POST /api/events/:id/assignments-ready - marca come ready solo gli assignment indicati
router.post("/:id/assignments-ready", async (req: Request, res) => {
  try {
    const eventId = parseInt(req.params.id, 10);
    if (Number.isNaN(eventId)) {
      res.status(400).json({ error: "Invalid event id" });
      return;
    }

    const { assignmentIds } = req.body;

    if (!Array.isArray(assignmentIds) || assignmentIds.length === 0) {
      res.status(400).json({ error: "assignmentIds must be a non-empty array" });
      return;
    }

    const ids = assignmentIds
      .map((x: unknown) => parseInt(String(x), 10))
      .filter((n: number) => !Number.isNaN(n));

    if (ids.length === 0) {
      res.status(400).json({ error: "assignmentIds must contain valid numbers" });
      return;
    }

    // UPDATE solo gli assignment con id IN (...) e event_id = eventId
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");
    const result = await pool.query(
      `UPDATE assignments
       SET status = 'READY', updated_at = now()
       WHERE id IN (${placeholders}) AND event_id = $1
       RETURNING id`,
      [eventId, ...ids]
    );

    // Aggiorna anche lo stato dell'evento a READY_TO_SEND
    await pool.query(
      "UPDATE events SET assignments_status = 'READY_TO_SEND' WHERE id = $1",
      [eventId]
    );

    res.json({ updated: result.rowCount ?? 0 });
  } catch (err) {
    console.error("POST /api/events/:id/assignments-ready error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// PATCH /api/events/:id/assignments-status
router.patch("/:id/assignments-status", async (req: Request, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid event id" });
      return;
    }

    const { assignmentsStatus } = req.body;

    if (typeof assignmentsStatus !== "string") {
      res.status(400).json({ error: "assignmentsStatus is required" });
      return;
    }

    if (!EVENT_ASSIGNMENTS_STATUSES.includes(assignmentsStatus as EventAssignmentsStatus)) {
      res.status(400).json({
        error: `assignmentsStatus must be one of: ${EVENT_ASSIGNMENTS_STATUSES.join(", ")}`,
      });
      return;
    }

    const result = await pool.query(
      "UPDATE events SET assignments_status = $1 WHERE id = $2 RETURNING id, assignments_status",
      [assignmentsStatus, id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    res.json({
      id: result.rows[0].id,
      assignmentsStatus: result.rows[0].assignments_status,
    });
  } catch (err) {
    console.error("PATCH /api/events/:id/assignments-status error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
