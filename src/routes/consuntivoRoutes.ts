import { Router, Request, Response } from "express";
import { pool } from "../db";
import type { StaffId } from "../types/staffId";
import { resolveStaffDbIntegerId } from "../services/staffService";
import { requirePageRead } from "../middleware/requirePageAccess";
import { getFinanceAccessForRequest } from "../middleware/financeAccess";

const router = Router();
export const providersRouter = Router();

export type ConsuntivoRow = {
  eventId: string;
  eventDate: string | null;
  competitionName: string | null;
  matchday: number | null;
  staffId: StaffId;
  staffName: string;
  providerId: StaffId | null;
  providerName: string | null;
  providerSurname: string | null;
  providerCompany: string | null;
  roleCode: string;
  roleName: string;
  location: string | null;
  fee: number | null;
  extraFee: number | null;
  invoicedAmount: number | null;
  assignmentStatus: string;
};

type ConsuntivoFilterOptionRow = {
  matchday: number | null;
  staff_id: number;
  staff_name: string | null;
  staff_surname: string | null;
  role_code: string;
  role_description: string | null;
  role_location: string | null;
  assignment_status: string;
  competition_name: string | null;
  provider_id: number | null;
  provider_name: string | null;
  provider_surname: string | null;
  provider_company: string | null;
};

export type ConsuntivoResponse = {
  items: ConsuntivoRow[];
  total: number;
  totalAmount: number | null;
};

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

function parseOptionalCompetition(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

function parseOptionalArray(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length > 0);
}

function parseOptionalRoleLocation(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().toUpperCase();
  return s.length > 0 ? s : null;
}

function parseOptionalPositiveIntArray(raw: unknown): number[] {
  return parseOptionalArray(raw)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function parseOptionalPositiveInt(raw: unknown): number | null {
  const values = parseOptionalPositiveIntArray(raw);
  return values.length > 0 ? values[0] : null;
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

providersRouter.get("/", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageRead(req, res, "consuntivo"))) return;
    const result = await pool.query<{
      id: number;
      name: string | null;
      surname: string | null;
      company: string | null;
    }>(
      `SELECT id, name, surname, company
       FROM staff
       WHERE upper(user_level) = 'PROVIDER'
       ORDER BY COALESCE(NULLIF(company, ''), surname) ASC, id ASC`
    );

    const items = result.rows.map((row) => {
      const name = row.name ?? "";
      const surname = row.surname ?? "";
      const company = row.company != null && String(row.company).trim() !== ""
        ? String(row.company).trim()
        : null;
      const fallback = `${name} ${surname}`.trim();
      return {
        id: row.id,
        name,
        surname,
        company,
        label: company ?? fallback,
      };
    });

    res.json(items);
  } catch (err) {
    console.error("GET /api/providers error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/filter-options", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageRead(req, res, "consuntivo"))) return;
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

    const staffIdValues = parseOptionalPositiveIntArray(req.query.staffIds);
    if (staffIdValues.length > 0) {
      conditions.push(`a.staff_id = ANY($${p++}::int[])`);
      params.push(staffIdValues);
    } else {
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
    }

    const roleCodes = parseOptionalArray(req.query.roleCodes);
    if (roleCodes.length > 0) {
      conditions.push(`a.role_code = ANY($${p++}::text[])`);
      params.push(roleCodes);
    } else {
      const roleCode = parseOptionalRoleCode(req.query.roleCode);
      if (roleCode != null) {
        conditions.push(`a.role_code = $${p++}`);
        params.push(roleCode);
      }
    }

    const roleLocation = parseOptionalRoleLocation(
      req.query.roleLocation ?? req.query.role_location
    );
    if (roleLocation != null) {
      conditions.push(`a.role_location = $${p++}`);
      params.push(roleLocation);
    }

    const statuses = parseOptionalArray(req.query.statuses);
    if (statuses.length > 0) {
      conditions.push(`a.status = ANY($${p++}::text[])`);
      params.push(statuses);
    } else {
      const status = String(req.query.status ?? "").trim();
      if (status) {
        conditions.push(`a.status = $${p++}`);
        params.push(status);
      }
    }

    const providerIds = parseOptionalPositiveIntArray(req.query.providerIds);
    if (providerIds.length > 0) {
      conditions.push(`s.provider_id = ANY($${p++}::int[])`);
      params.push(providerIds);
    } else {
      const providerId = parseOptionalPositiveInt(req.query.providerId);
      if (providerId != null) {
        conditions.push(`s.provider_id = $${p++}`);
        params.push(providerId);
      }
    }

    const matchdays = parseOptionalPositiveIntArray(req.query.matchdays);
    if (matchdays.length > 0) {
      conditions.push(`e.matchday = ANY($${p++}::int[])`);
      params.push(matchdays);
    } else {
      const matchday = parseOptionalPositiveInt(req.query.matchday);
      if (matchday != null) {
        conditions.push(`e.matchday = $${p++}`);
        params.push(matchday);
      }
    }

    const competitions = parseOptionalArray(req.query.competitions);
    if (competitions.length > 0) {
      conditions.push(`e.competition_name = ANY($${p++}::text[])`);
      params.push(competitions);
    } else {
      const competition = parseOptionalCompetition(req.query.competition);
      if (competition != null) {
        conditions.push(`e.competition_name = $${p++}`);
        params.push(competition);
      }
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const sql = `
      SELECT DISTINCT
        e.matchday AS matchday,
        a.staff_id AS staff_id,
        s.name AS staff_name,
        s.surname AS staff_surname,
        a.role_code AS role_code,
        r.description AS role_description,
        a.role_location AS role_location,
        a.status AS assignment_status,
        e.competition_name AS competition_name,
        s.provider_id AS provider_id,
        provider_staff.name AS provider_name,
        provider_staff.surname AS provider_surname,
        provider_staff.company AS provider_company
      FROM assignments a
      JOIN events e ON e.id = a.event_id
      JOIN staff s ON s.id = a.staff_id
      JOIN roles r ON r.role_code = a.role_code AND r.location = a.role_location
      LEFT JOIN staff provider_staff ON provider_staff.id = s.provider_id
      ${whereClause}
    `;

    const result = await pool.query<ConsuntivoFilterOptionRow>(sql, params);
    const rows = result.rows;

    const matchdaysOut = Array.from(
      new Set(
        rows
          .map((row) => row.matchday)
          .filter((v): v is number => v != null && Number.isFinite(v))
      )
    ).sort((a, b) => a - b);

    const staffOut = Array.from(
      new Map(
        rows
          .map((row) => ({
            id: row.staff_id,
            name: row.staff_name ?? "",
            surname: row.staff_surname ?? "",
          }))
          .filter((row) => Number.isFinite(row.id))
          .map((row) => [row.id, row])
      ).values()
    ).sort((a, b) =>
      a.surname === b.surname
        ? a.name.localeCompare(b.name, "it")
        : a.surname.localeCompare(b.surname, "it")
    );

    const rolesOut = Array.from(
      new Map(
        rows.map((row) => [
          `${row.role_code}::${row.role_location ?? ""}`,
          {
            code: row.role_code,
            description: row.role_description ?? null,
            location: row.role_location ?? null,
          },
        ])
      ).values()
    ).sort((a, b) =>
      a.code === b.code
        ? String(a.location ?? "").localeCompare(String(b.location ?? ""), "it")
        : a.code.localeCompare(b.code, "it")
    );

    const providersOut = Array.from(
      new Map(
        rows
          .filter((row) => row.provider_id != null)
          .map((row) => [
            Number(row.provider_id),
            {
              id: Number(row.provider_id),
              name: row.provider_name ?? "",
              surname: row.provider_surname ?? "",
              company: row.provider_company ?? null,
              label:
                row.provider_company != null && String(row.provider_company).trim() !== ""
                  ? String(row.provider_company).trim()
                  : `${row.provider_name ?? ""} ${row.provider_surname ?? ""}`.trim(),
            },
          ])
      ).values()
    ).sort((a, b) => a.label.localeCompare(b.label, "it"));

    const competitionsOut = Array.from(
      new Set(
        rows
          .map((row) => (row.competition_name ?? "").trim())
          .filter((name) => name.length > 0)
      )
    ).sort((a, b) => a.localeCompare(b, "it"));

    const statusesOut = Array.from(
      new Set(
        rows
          .map((row) => String(row.assignment_status ?? "").trim())
          .filter((value) => value.length > 0)
      )
    ).sort((a, b) => a.localeCompare(b, "it"));

    res.json({
      matchdays: matchdaysOut,
      staff: staffOut,
      roles: rolesOut,
      providers: providersOut,
      competitions: competitionsOut,
      statuses: statusesOut,
    });
  } catch (err) {
    console.error("GET /api/consuntivo/filter-options error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageRead(req, res, "consuntivo"))) return;
    const showFinance = await getFinanceAccessForRequest(req);
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

    const staffIdValues = parseOptionalPositiveIntArray(req.query.staffIds);
    if (staffIdValues.length > 0) {
      conditions.push(`a.staff_id = ANY($${p++}::int[])`);
      params.push(staffIdValues);
    } else {
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
    }

    const roleCodes = parseOptionalArray(req.query.roleCodes);
    if (roleCodes.length > 0) {
      conditions.push(`a.role_code = ANY($${p++}::text[])`);
      params.push(roleCodes);
    } else {
      const roleCode = parseOptionalRoleCode(req.query.roleCode);
      if (roleCode != null) {
        conditions.push(`a.role_code = $${p++}`);
        params.push(roleCode);
      }
    }

    const roleLocation = parseOptionalRoleLocation(
      req.query.roleLocation ?? req.query.role_location
    );
    if (roleLocation != null) {
      conditions.push(`a.role_location = $${p++}`);
      params.push(roleLocation);
    }

    const statuses = parseOptionalArray(req.query.statuses);
    if (statuses.length > 0) {
      conditions.push(`a.status = ANY($${p++}::text[])`);
      params.push(statuses);
    } else {
      const status = String(req.query.status ?? "").trim();
      if (status) {
        conditions.push(`a.status = $${p++}`);
        params.push(status);
      }
    }

    const providerIds = parseOptionalPositiveIntArray(req.query.providerIds);
    if (providerIds.length > 0) {
      conditions.push(`s.provider_id = ANY($${p++}::int[])`);
      params.push(providerIds);
    } else {
      const providerId = parseOptionalPositiveInt(req.query.providerId);
      if (providerId != null) {
        conditions.push(`s.provider_id = $${p++}`);
        params.push(providerId);
      }
    }

    const matchdays = parseOptionalPositiveIntArray(req.query.matchdays);
    if (matchdays.length > 0) {
      conditions.push(`e.matchday = ANY($${p++}::int[])`);
      params.push(matchdays);
    } else {
      const matchday = parseOptionalPositiveInt(req.query.matchday);
      if (matchday != null) {
        conditions.push(`e.matchday = $${p++}`);
        params.push(matchday);
      }
    }

    const competitions = parseOptionalArray(req.query.competitions);
    if (competitions.length > 0) {
      conditions.push(`e.competition_name = ANY($${p++}::text[])`);
      params.push(competitions);
    } else {
      const competition = parseOptionalCompetition(req.query.competition);
      if (competition != null) {
        conditions.push(`e.competition_name = $${p++}`);
        params.push(competition);
      }
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const sql = `
      SELECT
        a.event_id AS event_id,
        e.date AS event_date,
        e.ko_italy_time AS event_ko_italy_time,
        e.competition_name AS competition_name,
        e.matchday AS matchday,
        a.staff_id AS staff_id,
        s.surname AS staff_surname,
        s.name AS staff_name,
        provider_staff.id AS provider_id,
        provider_staff.name AS provider_name,
        provider_staff.surname AS provider_surname,
        provider_staff.company AS provider_company,
        COALESCE(srf.fee, s.fee, 0) AS staff_fee,
        COALESCE(srf.extra_fee, s.extra_fee, 0) AS staff_extra_fee,
        a.role_code AS role_code,
        r.description AS role_description,
        r.location AS role_location,
        a.status AS assignment_status
      FROM assignments a
      JOIN events e ON e.id = a.event_id
      JOIN staff s ON s.id = a.staff_id
      JOIN roles r ON r.role_code = a.role_code AND r.location = a.role_location
      LEFT JOIN staff provider_staff
        ON provider_staff.id = s.provider_id
      LEFT JOIN staff_role_fees srf
        ON srf.staff_id = a.staff_id
       AND srf.role_code = a.role_code
       AND srf.location = a.role_location
      ${whereClause}
      ORDER BY e.date DESC NULLS LAST, e.ko_italy_time DESC NULLS LAST, e.id DESC, a.id DESC
    `;

    const result = await pool.query<{
      event_id: string;
      event_date: unknown;
      event_ko_italy_time: unknown;
      competition_name: string | null;
      matchday: number | null;
      staff_id: number;
      staff_surname: string;
      staff_name: string;
      provider_id: number | null;
      provider_name: string | null;
      provider_surname: string | null;
      provider_company: string | null;
      staff_fee: unknown;
      staff_extra_fee: unknown;
      role_code: string;
      role_description: string | null;
      role_location: string | null;
      assignment_status: string;
    }>(sql, params);

    const items: ConsuntivoRow[] = result.rows.map((row) => {
      const fee = feeToNumber(row.staff_fee);
      const extraFee = feeToNumber(row.staff_extra_fee);
      const rc = row.role_code;
      const rn =
        row.role_description != null && String(row.role_description).trim()
          ? String(row.role_description).trim()
          : rc;

      return {
        eventId: String(row.event_id),
        eventDate: combineEventDate(row.event_date, row.event_ko_italy_time),
        competitionName: row.competition_name ?? null,
        matchday: row.matchday,
        staffId: String(row.staff_id) as StaffId,
        staffName: `${row.staff_surname} ${row.staff_name}`.trim(),
        providerId: row.provider_id != null ? (String(row.provider_id) as StaffId) : null,
        providerName: row.provider_name,
        providerSurname: row.provider_surname,
        providerCompany: row.provider_company,
        roleCode: rc,
        roleName: rn,
        location: row.role_location ?? null,
        fee: showFinance ? fee : null,
        extraFee: showFinance ? extraFee : null,
        invoicedAmount: showFinance ? null : null,
        assignmentStatus: row.assignment_status,
      };
    });

    const totalAmount = items.reduce(
      (sum, it) => sum + (it.fee ?? 0) + (it.extraFee ?? 0),
      0
    );

    const body: ConsuntivoResponse = {
      items,
      total: items.length,
      totalAmount: showFinance ? totalAmount : null,
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
