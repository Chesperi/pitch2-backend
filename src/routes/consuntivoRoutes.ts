import { Router, Request, Response } from "express";
import { pool } from "../db";

const router = Router();

export type ConsuntivoRow = {
  eventId: number;
  eventDate: string | null;
  matchday: number | null;
  staffId: number;
  staffName: string;
  roleId: number;
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

/** `from`: inizio giornata UTC se solo `yyyy-mm-dd`, altrimenti `Date` da ISO. */
function parseFromInstant(raw: string | undefined): Date | null {
  if (raw === undefined || raw === null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const [y, mo, d] = t.split("-").map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(t);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** `to`: fine giornata UTC se solo `yyyy-mm-dd`, altrimenti `Date` da ISO. */
function parseToInstant(raw: string | undefined): Date | null {
  if (raw === undefined || raw === null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const [y, mo, d] = t.split("-").map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(t);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseOptionalPositiveInt(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const n = parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const conditions: string[] = ["a.staff_id IS NOT NULL"];
    const params: unknown[] = [];
    let p = 1;

    const fromD = parseFromInstant(req.query.from as string | undefined);
    const toD = parseToInstant(req.query.to as string | undefined);
    if (fromD) {
      conditions.push(`e.ko_italy >= $${p++}`);
      params.push(fromD);
    }
    if (toD) {
      conditions.push(`e.ko_italy <= $${p++}`);
      params.push(toD);
    }

    const eventId = parseOptionalPositiveInt(req.query.eventId);
    if (eventId != null) {
      conditions.push(`a.event_id = $${p++}`);
      params.push(eventId);
    }

    const staffId = parseOptionalPositiveInt(req.query.staffId);
    if (staffId != null) {
      conditions.push(`a.staff_id = $${p++}`);
      params.push(staffId);
    }

    const roleId = parseOptionalPositiveInt(req.query.roleId);
    if (roleId != null) {
      conditions.push(`a.role_id = $${p++}`);
      params.push(roleId);
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
        e.ko_italy AS event_ko_italy,
        e.matchday AS matchday,
        a.staff_id AS staff_id,
        s.surname AS staff_surname,
        s.name AS staff_name,
        s.fee AS staff_fee,
        a.role_id AS role_id,
        r.code AS role_code,
        r.name AS role_name,
        r.location AS role_location,
        a.status AS assignment_status
      FROM assignments a
      JOIN events e ON e.id = a.event_id
      JOIN staff s ON s.id = a.staff_id
      JOIN roles r ON r.id = a.role_id
      ${whereClause}
      ORDER BY e.ko_italy DESC NULLS LAST, e.id DESC, a.id DESC
    `;

    const result = await pool.query<{
      event_id: number;
      event_ko_italy: Date | string | null;
      matchday: number | null;
      staff_id: number;
      staff_surname: string;
      staff_name: string;
      staff_fee: number | null;
      role_id: number;
      role_code: string;
      role_name: string;
      role_location: string | null;
      assignment_status: string;
    }>(sql, params);

    const items: ConsuntivoRow[] = result.rows.map((row) => {
      const fee = Number(row.staff_fee) || 0;
      const ko = row.event_ko_italy;
      const eventDate =
        ko == null
          ? null
          : typeof ko === "string"
            ? ko
            : ko instanceof Date
              ? ko.toISOString()
              : String(ko);

      return {
        eventId: row.event_id,
        eventDate,
        matchday: row.matchday,
        staffId: row.staff_id,
        staffName: `${row.staff_surname} ${row.staff_name}`.trim(),
        roleId: row.role_id,
        roleCode: row.role_code,
        roleName: row.role_name,
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
