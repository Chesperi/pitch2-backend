import { Router, Request } from "express";
import { pool } from "../db";
import { getCurrentSession } from "../auth/session";
import { logAuditFromRequest } from "../services/auditLog";
import type { Assignment, AssignmentWithJoins, AssignmentStatus } from "../types";
import type { StaffId } from "../types/staffId";
import { isStaffId, normalizeStaffId } from "../types/staffId";

const router = Router();

const ASSIGNMENT_STATUSES: AssignmentStatus[] = [
  "DRAFT",
  "READY",
  "SENT",
  "CONFIRMED",
  "REJECTED",
];

function rowToAssignmentWithJoins(row: Record<string, unknown>): AssignmentWithJoins {
  const koItaly = row.e_ko_italy;
  return {
    id: row.a_id as number,
    eventId: row.a_event_id as number,
    roleId: row.a_role_id as number,
    staffId:
      row.a_staff_id != null ? String(row.a_staff_id) : null,
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
    eventKoItaly: koItaly != null ? String(koItaly) : null,
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

function rowToAssignment(row: Record<string, unknown>): Assignment {
  return {
    id: row.id as number,
    eventId: row.event_id as number,
    roleId: row.role_id as number,
    staffId: row.staff_id != null ? String(row.staff_id) : null,
    status: row.status as AssignmentStatus,
    notes: row.notes as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function fetchRoleCodeById(roleId: number): Promise<string | null> {
  const r = await pool.query<{ code: string }>(
    "SELECT code FROM roles WHERE id = $1",
    [roleId]
  );
  return r.rows[0]?.code ?? null;
}

async function fetchStaffDefaultRoleById(staffId: StaffId): Promise<{
  exists: boolean;
  default_role_code: string | null;
}> {
  const r = await pool.query<{ default_role_code: string | null }>(
    "SELECT default_role_code FROM staff WHERE id = $1",
    [staffId]
  );
  if (r.rows.length === 0) {
    return { exists: false, default_role_code: null };
  }
  return { exists: true, default_role_code: r.rows[0].default_role_code };
}

// GET /api/assignments - list designazioni (optional eventId, staffId, from, to filter)
router.get("/", async (req: Request, res) => {
  try {
    const eventId = (req.query.eventId as string)?.trim();
    const staffId = (req.query.staffId as string)?.trim();
    const from = (req.query.from as string)?.trim();
    const to = (req.query.to as string)?.trim();
    let limit = Math.min(
      Math.max(parseInt(String(req.query.limit), 10) || 50, 1),
      200
    );
    const offset = Math.max(parseInt(String(req.query.offset), 10) || 0, 0);

    // Quando from/to sono usati, carica tutti gli assignments del periodo (limit più alto)
    if (from && to) {
      limit = 5000;
    }

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (eventId) {
      const eid = parseInt(eventId, 10);
      if (Number.isNaN(eid)) {
        res.status(400).json({ error: "Invalid eventId" });
        return;
      }
      conditions.push(`a.event_id = $${paramIdx}`);
      params.push(eid);
      paramIdx++;
    }

    if (staffId) {
      if (!isStaffId(staffId)) {
        res.status(400).json({ error: "Invalid staffId" });
        return;
      }
      conditions.push(`a.staff_id = $${paramIdx}`);
      params.push(normalizeStaffId(staffId));
      paramIdx++;
    }

    if (from) {
      conditions.push(`e.ko_italy::date >= $${paramIdx}`);
      params.push(from);
      paramIdx++;
    }

    if (to) {
      conditions.push(`e.ko_italy::date <= $${paramIdx}`);
      params.push(to);
      paramIdx++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

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

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::int as count
       FROM assignments a
       JOIN events e ON e.id = a.event_id
       JOIN roles r ON r.id = a.role_id
       LEFT JOIN staff s ON s.id = a.staff_id
       ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

    params.push(limit, offset);
    const itemsResult = await pool.query(
      `SELECT ${selectCols}
       FROM assignments a
       JOIN events e ON e.id = a.event_id
       JOIN roles r ON r.id = a.role_id
       LEFT JOIN staff s ON s.id = a.staff_id
       ${whereClause}
       ORDER BY e.ko_italy ASC NULLS LAST, a.id ASC
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
    const { eventId, roleId } = req.body;

    if (eventId == null || roleId == null) {
      res.status(400).json({ error: "eventId and roleId are required" });
      return;
    }

    const eid = parseInt(String(eventId), 10);
    const rid = parseInt(String(roleId), 10);
    if (Number.isNaN(eid) || Number.isNaN(rid)) {
      res.status(400).json({ error: "eventId and roleId must be valid numbers" });
      return;
    }

    const result = await pool.query(
      `INSERT INTO assignments (event_id, role_id, staff_id, status, notes)
       VALUES ($1, $2, NULL, 'DRAFT', NULL)
       RETURNING *`,
      [eid, rid]
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
 * Se `staffId` è un numero (assegnazione o cambio persona), deve valere
 * `staff.default_role_code === roles.code` del ruolo dello slot (`assignments.role_id`),
 * come il filtro dello StaffPicker sul frontend. `staffId: null` svuota lo slot senza check.
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
      const sid: StaffId | null =
        staffId === null
          ? null
          : isStaffId(String(staffId).trim())
            ? normalizeStaffId(String(staffId).trim())
            : null;
      if (staffId !== null && sid === null) {
        res.status(400).json({ error: "staffId must be a staff UUID or null" });
        return;
      }

      if (sid !== null) {
        const roleId = current.role_id as number;
        const slotRoleCode = await fetchRoleCodeById(roleId);
        if (slotRoleCode == null) {
          res.status(400).json({ error: "Role not found for assignment" });
          return;
        }
        const staffRow = await fetchStaffDefaultRoleById(sid);
        if (!staffRow.exists) {
          res.status(400).json({ error: "Staff not found" });
          return;
        }
        const expected = slotRoleCode.trim();
        const actual = (staffRow.default_role_code ?? "").trim();
        if (actual !== expected) {
          res.status(422).json({
            error: "STAFF_ROLE_NOT_COMPATIBLE",
            message:
              "Lo staff selezionato non è compatibile con il ruolo dello slot.",
            details: {
              expectedRoleCode: slotRoleCode,
              staffDefaultRoleCode: staffRow.default_role_code,
            },
          });
          return;
        }
      }

      updates.push(`staff_id = $${paramIdx}`);
      values.push(sid);
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
          roleId: current.role_id,
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

// DELETE /api/assignments/:id
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
