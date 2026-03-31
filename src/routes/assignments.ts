import { Router, Request } from "express";
import { pool } from "../db";
import { getCurrentSession } from "../auth/session";
import { logAuditFromRequest } from "../services/auditLog";
import type { Assignment, AssignmentWithJoins, AssignmentStatus } from "../types";
import { resolveStaffDbIntegerId } from "../services/staffService";

const router = Router();

const ASSIGNMENT_STATUSES: AssignmentStatus[] = [
  "DRAFT",
  "READY",
  "SENT",
  "CONFIRMED",
  "REJECTED",
];

const ASSIGNMENT_LIST_SELECT = `
  a.id as a_id, a.event_id as a_event_id, a.role_code as a_role_code, a.role_location as a_role_location,
  a.staff_id as a_staff_id,
  a.status as a_status, a.notes as a_notes, a.created_at as a_created_at, a.updated_at as a_updated_at,
  e.category as e_category, e.competition_name as e_competition_name, e.matchday as e_matchday,
  e.date as e_date, e.ko_italy_time as e_ko_italy_time,
  e.home_team_name_short as e_home_team_name_short, e.away_team_name_short as e_away_team_name_short,
  e.status as e_status,
  s.surname as s_surname, s.name as s_name, s.email as s_email, s.phone as s_phone,
  s.company as s_company, s.fee as s_fee, s.plates as s_plates,
  r.role_code as r_role_code, r.description as r_description, r.location as r_location
`;

function combineKoDisplay(date: string | null, time: string | null): string | null {
  if (!date && !time) return null;
  const d = (date ?? "").trim();
  const t = (time ?? "").trim();
  if (d && t) return `${d}T${t}`;
  return d || t || null;
}

function rowToAssignmentWithJoins(row: Record<string, unknown>): AssignmentWithJoins {
  const koItaly = combineKoDisplay(
    row.e_date != null ? String(row.e_date).slice(0, 10) : null,
    row.e_ko_italy_time != null ? String(row.e_ko_italy_time) : null
  );
  return {
    id: row.a_id as number,
    eventId: String(row.a_event_id ?? ""),
    roleCode: String(row.a_role_code ?? ""),
    roleLocation: String(row.a_role_location ?? ""),
    staffId: row.a_staff_id != null ? Number(row.a_staff_id) : null,
    status: row.a_status as AssignmentStatus,
    notes: row.a_notes as string | null,
    createdAt: String(row.a_created_at),
    updatedAt: String(row.a_updated_at),
    eventCategory: row.e_category as string,
    eventCompetitionName: row.e_competition_name as string,
    eventMatchDay: row.e_matchday as number | null,
    eventHomeTeamNameShort: row.e_home_team_name_short as string | null,
    eventAwayTeamNameShort: row.e_away_team_name_short as string | null,
    eventKoItaly: koItaly,
    eventStatus: String(row.e_status ?? ""),
    staffSurname: row.s_surname as string | null,
    staffName: row.s_name as string | null,
    staffEmail: row.s_email as string | null,
    staffPhone: row.s_phone as string | null,
    staffCompany: row.s_company as string | null,
    staffFee: row.s_fee != null ? String(row.s_fee) : null,
    staffPlates: row.s_plates as string | null,
    roleDescription: row.r_description != null ? String(row.r_description) : null,
  };
}

function rowToAssignment(row: Record<string, unknown>): Assignment {
  return {
    id: row.id as number,
    eventId: String(row.event_id ?? ""),
    roleCode: String(row.role_code ?? ""),
    roleLocation: String(row.role_location ?? ""),
    staffId: row.staff_id != null ? Number(row.staff_id) : null,
    status: row.status as AssignmentStatus,
    notes: row.notes as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function fetchStaffDefaultRoleByPk(staffPk: number): Promise<{
  exists: boolean;
  default_role_code: string | null;
  default_location: string | null;
}> {
  const r = await pool.query<{
    default_role_code: string | null;
    default_location: string | null;
  }>("SELECT default_role_code, default_location FROM staff WHERE id = $1", [staffPk]);
  if (r.rows.length === 0) {
    return { exists: false, default_role_code: null, default_location: null };
  }
  return {
    exists: true,
    default_role_code: r.rows[0].default_role_code,
    default_location: r.rows[0].default_location,
  };
}

async function resolveStaffPkFromBody(raw: unknown): Promise<number | null | "invalid"> {
  if (raw === null) return null;
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return raw;
  const s = String(raw ?? "").trim();
  if (!s) return "invalid";
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return n > 0 ? n : "invalid";
  }
  const resolved = await resolveStaffDbIntegerId(s);
  return resolved ?? "invalid";
}

// GET /api/assignments - list designazioni (optional eventId, staffId, from, to filter)
router.get("/", async (req: Request, res) => {
  try {
    const eventId = (req.query.eventId as string)?.trim();
    const staffIdRaw = (req.query.staffId as string)?.trim();
    const from = (req.query.from as string)?.trim();
    const to = (req.query.to as string)?.trim();
    let limit = Math.min(
      Math.max(parseInt(String(req.query.limit), 10) || 50, 1),
      200
    );
    const offset = Math.max(parseInt(String(req.query.offset), 10) || 0, 0);

    if (from && to) {
      limit = 5000;
    }

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (eventId) {
      conditions.push(`a.event_id = $${paramIdx}`);
      params.push(eventId);
      paramIdx++;
    }

    if (staffIdRaw) {
      const staffPk = await resolveStaffDbIntegerId(staffIdRaw);
      if (staffPk == null) {
        res.status(400).json({ error: "Invalid staffId" });
        return;
      }
      conditions.push(`a.staff_id = $${paramIdx}`);
      params.push(staffPk);
      paramIdx++;
    }

    if (from) {
      conditions.push(`e.date >= $${paramIdx}::date`);
      params.push(from);
      paramIdx++;
    }

    if (to) {
      conditions.push(`e.date <= $${paramIdx}::date`);
      params.push(to);
      paramIdx++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::int as count
       FROM assignments a
       JOIN events e ON e.id = a.event_id
       JOIN roles r ON r.role_code = a.role_code AND r.location = a.role_location
       LEFT JOIN staff s ON s.id = a.staff_id
       ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

    params.push(limit, offset);
    const itemsResult = await pool.query(
      `SELECT ${ASSIGNMENT_LIST_SELECT}
       FROM assignments a
       JOIN events e ON e.id = a.event_id
       JOIN roles r ON r.role_code = a.role_code AND r.location = a.role_location
       LEFT JOIN staff s ON s.id = a.staff_id
       ${whereClause}
       ORDER BY e.date ASC NULLS LAST, e.ko_italy_time ASC NULLS LAST, a.id ASC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    const items = itemsResult.rows.map((r) =>
      rowToAssignmentWithJoins(r as Record<string, unknown>)
    );

    res.json({ items, total });
  } catch (err) {
    console.error("GET /api/assignments error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// POST /api/assignments - create empty slot
router.post("/", async (req: Request, res) => {
  try {
    const { eventId, roleCode, roleLocation } = req.body as {
      eventId?: unknown;
      roleCode?: unknown;
      roleLocation?: unknown;
    };

    const eid =
      eventId != null && String(eventId).trim() !== ""
        ? String(eventId).trim()
        : null;
    const rc =
      typeof roleCode === "string" && roleCode.trim() ? roleCode.trim() : null;
    const rl =
      typeof roleLocation === "string" && roleLocation.trim()
        ? roleLocation.trim().toUpperCase()
        : null;

    if (!eid || !rc || !rl) {
      res.status(400).json({
        error: "eventId, roleCode, and roleLocation are required",
      });
      return;
    }

    const result = await pool.query(
      `INSERT INTO assignments (event_id, role_code, role_location, staff_id, status, notes)
       VALUES ($1, $2, $3, NULL, 'DRAFT', NULL)
       RETURNING *`,
      [eid, rc, rl]
    );

    const row = result.rows[0] as Record<string, unknown>;
    res.status(201).json(rowToAssignment(row));
  } catch (err) {
    console.error("POST /api/assignments error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

/**
 * PATCH /api/assignments/:id — aggiorna `staff_id`, `status`, `notes`.
 * Con staff assegnato, coppia (default_role_code, default_location) dello staff deve coincidere
 * con (role_code, role_location) dello slot.
 */
router.patch("/:id", async (req: Request, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid assignment id" });
      return;
    }

    const { staffId, status, notes } = req.body;

    const currentResult = await pool.query(
      "SELECT * FROM assignments WHERE id = $1",
      [id]
    );
    if (currentResult.rows.length === 0) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }

    const current = currentResult.rows[0] as Record<string, unknown>;
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (staffId !== undefined) {
      const resolved = await resolveStaffPkFromBody(staffId);
      if (resolved === "invalid") {
        res.status(400).json({ error: "staffId must be a staff primary key, session key, or null" });
        return;
      }

      if (resolved !== null) {
        const slotRoleCode = String(current.role_code ?? "").trim();
        const slotRoleLoc = String(current.role_location ?? "").trim();
        if (!slotRoleCode || !slotRoleLoc) {
          res.status(400).json({ error: "Role not found for assignment" });
          return;
        }
        const staffRow = await fetchStaffDefaultRoleByPk(resolved);
        if (!staffRow.exists) {
          res.status(400).json({ error: "Staff not found" });
          return;
        }
        const codeOk =
          (staffRow.default_role_code ?? "").trim() === slotRoleCode;
        const locOk =
          (staffRow.default_location ?? "").trim().toUpperCase() ===
          slotRoleLoc.toUpperCase();
        if (!codeOk || !locOk) {
          res.status(422).json({
            error: "STAFF_ROLE_NOT_COMPATIBLE",
            message:
              "Lo staff selezionato non è compatibile con il ruolo dello slot.",
            details: {
              expectedRoleCode: slotRoleCode,
              expectedRoleLocation: slotRoleLoc,
              staffDefaultRoleCode: staffRow.default_role_code,
              staffDefaultLocation: staffRow.default_location,
            },
          });
          return;
        }
      }

      updates.push(`staff_id = $${paramIdx}`);
      values.push(resolved);
      paramIdx++;
    }

    if (typeof status === "string") {
      if (!ASSIGNMENT_STATUSES.includes(status as AssignmentStatus)) {
        res.status(400).json({
          error: `status must be one of: ${ASSIGNMENT_STATUSES.join(", ")}`,
        });
        return;
      }
      updates.push(`status = $${paramIdx}`);
      values.push(status);
      paramIdx++;
    }

    if (notes !== undefined) {
      updates.push(`notes = $${paramIdx}`);
      values.push(notes === null ? null : String(notes));
      paramIdx++;
    }

    if (updates.length === 0) {
      res.json(rowToAssignment(current));
      return;
    }

    updates.push(`updated_at = now()`);
    values.push(id);

    await pool.query(
      `UPDATE assignments SET ${updates.join(", ")} WHERE id = $${paramIdx}`,
      values
    );

    const updatedResult = await pool.query(
      "SELECT * FROM assignments WHERE id = $1",
      [id]
    );
    const row = updatedResult.rows[0] as Record<string, unknown>;

    if (typeof status === "string" && String(current.status) !== status) {
      const session = getCurrentSession(req);
      void logAuditFromRequest(req, {
        actorType: session ? "staff" : "system",
        ...(session ? { actorId: session.staffId } : {}),
        entityType: "assignment",
        entityId: String(id),
        action: "status_change",
        metadata: {
          from: String(current.status),
          to: status,
          eventId: current.event_id,
          roleCode: current.role_code,
          roleLocation: current.role_location,
        },
      });
    }

    res.json(rowToAssignment(row));
  } catch (err) {
    console.error("PATCH /api/assignments/:id error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

router.delete("/:id", async (req: Request, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid assignment id" });
      return;
    }

    const result = await pool.query(
      "DELETE FROM assignments WHERE id = $1 RETURNING id",
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }

    res.status(204).end();
  } catch (err) {
    console.error("DELETE /api/assignments/:id error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
