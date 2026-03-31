import { Router, Request, Response } from "express";
import { pool } from "../db";
import type { StaffId } from "../types/staffId";
import { resolveStaffDbIntegerId } from "../services/staffService";

const router = Router();

export type ConsuntivoRow = {
  eventId: string;
  eventDate: string | null;
  matchday: number | null;
  staffId: StaffId;
  staffName: string;
  roleCode: string;
  roleName: string;
  location: string | null;
  fee: number;
  assignmentStatus: string;
};

export type ConsuntivoResponse = {
  items: ConsuntivoRow[];
  total: number;
  totalAmount: number;
};

function parseOptionalEventId(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

function parseOptionalDate(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const t = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

function parseOptionalRoleCode(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

function parseOptionalRoleLocation(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().toUpperCase();
  return s.length > 0 ? s : null;
}

function feeToNumber(fee: unknown): number {
  if (fee == null) return 0;
  const n = parseFloat(String(fee).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function combineEventDate(
  date: unknown,
  koTime: unknown
): string | null {
  const d = date != null ? String(date).slice(0, 10) : "";
  const t = koTime != null ? String(koTime).trim() : "";
  if (!d && !t) return null;
  if (d && t) return `${d}T${t}`;
  return d || t || null;
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const conditions: string[] = ["a.staff_id IS NOT NULL"];
    const params: unknown[] = [];
    let p = 1;

    const fromD = parseOptionalDate(req.query.from);
    const toD = parseOptionalDate(req.query.to);
    if (fromD) {
      conditions.push(`e.date >= $${p++}::date`);
      params.push(fromD);
    }
    if (toD) {
      conditions.push(`e.date <= $${p++}::date`);
      params.push(toD);
    }

    const eventId = parseOptionalEventId(req.query.eventId);
    if (eventId != null) {
      conditions.push(`a.event_id = $${p++}`);
      params.push(eventId);
    }

    const staffKey = req.query.staffId != null ? String(req.query.staffId).trim() : "";
    if (staffKey) {
      const staffPk = await resolveStaffDbIntegerId(staffKey);
      if (staffPk == null) {
        res.status(400).json({ error: "Invalid staffId" });
        return;
      }
      conditions.push(`a.staff_id = $${p++}`);
      params.push(staffPk);
    }

    const roleCode = parseOptionalRoleCode(req.query.roleCode ?? req.query.roleId);
    if (roleCode != null) {
      conditions.push(`a.role_code = $${p++}`);
      params.push(roleCode);
    }

    const roleLocation = parseOptionalRoleLocation(
      req.query.roleLocation ?? req.query.role_location
    );
    if (roleLocation != null) {
      conditions.push(`a.role_location = $${p++}`);
      params.push(roleLocation);
    }

    const status = String(req.query.status ?? "").trim();
    if (status) {
      conditions.push(`a.status = $${p++}`);
      params.push(status);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const sql = `
      SELECT
        a.event_id AS event_id,
        e.date AS event_date,
        e.ko_italy_time AS event_ko_italy_time,
        e.matchday AS matchday,
        a.staff_id AS staff_id,
        s.surname AS staff_surname,
        s.name AS staff_name,
        s.fee AS staff_fee,
        a.role_code AS role_code,
        r.description AS role_description,
        r.location AS role_location,
        a.status AS assignment_status
      FROM assignments a
      JOIN events e ON e.id = a.event_id
      JOIN staff s ON s.id = a.staff_id
      JOIN roles r ON r.role_code = a.role_code AND r.location = a.role_location
      ${whereClause}
      ORDER BY e.date DESC NULLS LAST, e.ko_italy_time DESC NULLS LAST, e.id DESC, a.id DESC
    `;

    const result = await pool.query<{
      event_id: string;
      event_date: unknown;
      event_ko_italy_time: unknown;
      matchday: number | null;
      staff_id: number;
      staff_surname: string;
      staff_name: string;
      staff_fee: unknown;
      role_code: string;
      role_description: string | null;
      role_location: string | null;
      assignment_status: string;
    }>(sql, params);

    const items: ConsuntivoRow[] = result.rows.map((row) => {
      const fee = feeToNumber(row.staff_fee);
      const rc = row.role_code;
      const rn =
        row.role_description != null && String(row.role_description).trim()
          ? String(row.role_description).trim()
          : rc;

      return {
        eventId: String(row.event_id),
        eventDate: combineEventDate(row.event_date, row.event_ko_italy_time),
        matchday: row.matchday,
        staffId: String(row.staff_id) as StaffId,
        staffName: `${row.staff_surname} ${row.staff_name}`.trim(),
        roleCode: rc,
        roleName: rn,
        location: row.role_location ?? null,
        fee,
        assignmentStatus: row.assignment_status,
      };
    });

    const totalAmount = items.reduce((sum, it) => sum + it.fee, 0);

    const body: ConsuntivoResponse = {
      items,
      total: items.length,
      totalAmount,
    };

    res.json(body);
  } catch (err) {
    console.error("GET /api/consuntivo error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
