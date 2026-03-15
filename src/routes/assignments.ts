import { Router, Request } from "express";
import { pool } from "../db";

const router = Router();

export type AssignmentDTO = {
  id: number;
  event_id: number;
  staff_id: number;
  role_code: string;
  fee: number | null;
  location: string | null;
  status: string;
  plate_selected: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AssignmentEventSummary = {
  id: number;
  category: string;
  competition_name: string;
  competition_code: string | null;
  matchday: number | null;
  home_team_name_short: string | null;
  away_team_name_short: string | null;
  venue_name: string | null;
  ko_italy: string | null;
  pre_duration_minutes: number;
  standard_onsite: string | null;
  standard_cologno: string | null;
  location: string | null;
  show_name: string | null;
  status: string;
};

export type AssignmentStaffSummary = {
  id: number;
  surname: string;
  name: string;
  email: string | null;
  company: string | null;
  default_role_code: string | null;
  default_location: string | null;
  plates: string | null;
  user_level: string;
};

export type AssignmentWithEventAndStaff = {
  assignment: AssignmentDTO;
  event: AssignmentEventSummary;
  staff: AssignmentStaffSummary;
};

export type AssignmentWithEvent = {
  assignment: AssignmentDTO;
  event: AssignmentEventSummary;
};

function buildAssignmentsQuery(
  conditions: string[],
  params: unknown[],
  limit: number,
  offset: number
) {
  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const paramIdx = params.length + 1;

  const selectCols = `
    a.id, a.event_id, a.staff_id, a.role_code, a.fee, a.location, a.status,
    a.plate_selected, a.notes, a.created_at, a.updated_at,
    e.id as e_id, e.category, e.competition_name, e.competition_code, e.matchday,
    e.home_team_name_short, e.away_team_name_short, e.venue_name, e.ko_italy,
    e.pre_duration_minutes, e.standard_onsite, e.standard_cologno,
    e.location as e_location, e.show_name, e.status as e_status,
    s.id as s_id, s.surname, s.name, s.email, s.company, s.default_role_code,
    s.default_location, s.plates, s.user_level
  `;

  return {
    countSql: `SELECT COUNT(*)::int as count
      FROM assignments a
      JOIN events e ON e.id = a.event_id
      JOIN staff s ON s.id = a.staff_id
      ${whereClause}`,
    itemsSql: `SELECT ${selectCols}
      FROM assignments a
      JOIN events e ON e.id = a.event_id
      JOIN staff s ON s.id = a.staff_id
      ${whereClause}
      ORDER BY e.ko_italy ASC NULLS LAST, a.id ASC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    params: [...params, limit, offset],
  };
}

function rowToAssignmentWithEventAndStaff(row: Record<string, unknown>): AssignmentWithEventAndStaff {
  return {
    assignment: {
      id: row.id as number,
      event_id: row.event_id as number,
      staff_id: row.staff_id as number,
      role_code: row.role_code as string,
      fee: row.fee as number | null,
      location: row.location as string | null,
      status: row.status as string,
      plate_selected: row.plate_selected as string | null,
      notes: row.notes as string | null,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    },
    event: {
      id: row.e_id as number,
      category: row.category as string,
      competition_name: row.competition_name as string,
      competition_code: row.competition_code as string | null,
      matchday: row.matchday as number | null,
      home_team_name_short: row.home_team_name_short as string | null,
      away_team_name_short: row.away_team_name_short as string | null,
      venue_name: row.venue_name as string | null,
      ko_italy: row.ko_italy != null ? String(row.ko_italy) : null,
      pre_duration_minutes: row.pre_duration_minutes as number,
      standard_onsite: row.standard_onsite as string | null,
      standard_cologno: row.standard_cologno as string | null,
      location: row.e_location as string | null,
      show_name: row.show_name as string | null,
      status: row.e_status as string,
    },
    staff: {
      id: row.s_id as number,
      surname: row.surname as string,
      name: row.name as string,
      email: row.email as string | null,
      company: row.company as string | null,
      default_role_code: row.default_role_code as string | null,
      default_location: row.default_location as string | null,
      plates: row.plates as string | null,
      user_level: row.user_level as string,
    },
  };
}

router.get("/", async (req: Request, res) => {
  try {
    const staff_id = (req.query.staff_id as string)?.trim();
    const event_id = (req.query.event_id as string)?.trim();
    const status = (req.query.status as string)?.trim();
    const from = (req.query.from as string)?.trim();
    const to = (req.query.to as string)?.trim();
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit), 10) || 50, 1),
      200
    );
    const offset = Math.max(parseInt(String(req.query.offset), 10) || 0, 0);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (staff_id) {
      conditions.push(`a.staff_id = $${paramIdx}`);
      params.push(parseInt(staff_id, 10));
      paramIdx++;
    }
    if (event_id) {
      conditions.push(`a.event_id = $${paramIdx}`);
      params.push(parseInt(event_id, 10));
      paramIdx++;
    }
    if (status) {
      conditions.push(`a.status = $${paramIdx}`);
      params.push(status);
      paramIdx++;
    }
    if (from) {
      conditions.push(`e.ko_italy >= $${paramIdx}::timestamptz`);
      params.push(from);
      paramIdx++;
    }
    if (to) {
      conditions.push(`e.ko_italy <= $${paramIdx}::timestamptz`);
      params.push(to);
      paramIdx++;
    }

    const { countSql, itemsSql, params: queryParams } = buildAssignmentsQuery(
      conditions,
      params,
      limit,
      offset
    );

    const countResult = await pool.query<{ count: string }>(countSql, params);
    const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

    const itemsResult = await pool.query(itemsSql, queryParams);
    const items = itemsResult.rows.map((r) =>
      rowToAssignmentWithEventAndStaff(r as Record<string, unknown>)
    );

    res.json({ items, total });
  } catch (err) {
    console.error("GET /api/assignments error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

router.patch("/:id", async (req: Request, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid assignment id" });
      return;
    }

    const { status, plate_selected, notes } = req.body;

    const currentResult = await pool.query(
      "SELECT * FROM assignments WHERE id = $1",
      [id]
    );
    if (currentResult.rows.length === 0) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }

    const current = currentResult.rows[0] as Record<string, unknown>;
    const newStatus =
      typeof status === "string" ? status : (current.status as string);
    const newPlateSelected =
      plate_selected !== undefined ? plate_selected : current.plate_selected;
    const newNotes = notes !== undefined ? notes : current.notes;

    await pool.query(
      `UPDATE assignments SET
        status = $1,
        plate_selected = $2,
        notes = $3,
        updated_at = now()
       WHERE id = $4`,
      [newStatus, newPlateSelected, newNotes, id]
    );

    const updatedResult = await pool.query(
      "SELECT * FROM assignments WHERE id = $1",
      [id]
    );
    const row = updatedResult.rows[0] as Record<string, unknown>;
    const assignment: AssignmentDTO = {
      id: row.id as number,
      event_id: row.event_id as number,
      staff_id: row.staff_id as number,
      role_code: row.role_code as string,
      fee: row.fee as number | null,
      location: row.location as string | null,
      status: row.status as string,
      plate_selected: row.plate_selected as string | null,
      notes: row.notes as string | null,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };

    res.json(assignment);
  } catch (err) {
    console.error("PATCH /api/assignments/:id error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
