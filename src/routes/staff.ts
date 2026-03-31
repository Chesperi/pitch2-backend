import { Router, Request } from "express";
import { pool } from "../db";
import { getCurrentSession } from "../auth/session";
import {
  requirePageEdit,
  requirePageRead,
} from "../middleware/requirePageAccess";
import { logAuditFromRequest } from "../services/auditLog";
import type { AssignmentWithEvent, AssignmentStatus } from "../types";
import { ensureSupabaseUserForStaff } from "../services/staffSupabase";
import type { StaffId } from "../types/staffId";
import { isStaffId, normalizeStaffId } from "../types/staffId";

const router = Router();

function parseStaffRouteId(raw: string): StaffId | null {
  const t = String(raw ?? "").trim();
  return isStaffId(t) ? normalizeStaffId(t) : null;
}

/** Allineato a `roles.location` in `src/routes/roles.ts` (estendere se servono altre sedi). */
const ALLOWED_DEFAULT_LOCATIONS = ["STADIO", "COLOGNO", "LEEDS", "REMOTE"] as const;

function isAllowedDefaultLocation(v: string): boolean {
  return (ALLOWED_DEFAULT_LOCATIONS as readonly string[]).includes(v);
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function roleCodeExists(code: string): Promise<boolean> {
  const r = await pool.query("SELECT 1 FROM roles WHERE code = $1 LIMIT 1", [code]);
  return (r.rowCount ?? 0) > 0;
}

export type StaffItem = {
  id: StaffId;
  surname: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  default_role_code: string | null;
  default_location: string | null;
  fee: number | null;
  plates: string | null;
  user_level: string;
  active: boolean;
};

function staffChangedFields(before: StaffItem, after: StaffItem): string[] {
  const changed: string[] = [];
  if (before.surname !== after.surname) changed.push("surname");
  if (before.name !== after.name) changed.push("name");
  if ((before.email ?? null) !== (after.email ?? null)) changed.push("email");
  if ((before.phone ?? null) !== (after.phone ?? null)) changed.push("phone");
  if ((before.company ?? null) !== (after.company ?? null)) changed.push("company");
  if ((before.default_role_code ?? null) !== (after.default_role_code ?? null)) {
    changed.push("defaultRoleCode");
  }
  if ((before.default_location ?? null) !== (after.default_location ?? null)) {
    changed.push("defaultLocation");
  }
  if ((before.fee ?? null) !== (after.fee ?? null)) changed.push("fee");
  if ((before.plates ?? null) !== (after.plates ?? null)) changed.push("plates");
  if (before.user_level !== after.user_level) changed.push("userLevel");
  if (before.active !== after.active) changed.push("active");
  return changed;
}

router.get("/", async (req: Request, res) => {
  try {
    if (!(await requirePageRead(req, res, "database"))) return;
    const q = (req.query.q as string)?.trim() || "";
    const role_code = (req.query.role_code as string)?.trim() || "";
    const location = (req.query.location as string)?.trim() || "";
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
        `(surname ILIKE $${paramIdx} OR name ILIKE $${paramIdx})`
      );
      params.push(`%${q}%`);
      paramIdx++;
    }
    if (role_code) {
      conditions.push(`default_role_code = $${paramIdx}`);
      params.push(role_code);
      paramIdx++;
    }
    if (location) {
      conditions.push(`default_location = $${paramIdx}`);
      params.push(location);
      paramIdx++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::int as count FROM staff ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

    params.push(limit, offset);
    const itemsResult = await pool.query<StaffItem>(
      `SELECT id, surname, name, email, phone, company, default_role_code,
              default_location, fee, plates, user_level, active
       FROM staff
       ${whereClause}
       ORDER BY surname ASC, name ASC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    res.json({ items: itemsResult.rows, total });
  } catch (err) {
    console.error("GET /api/staff error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

/**
 * POST /api/staff — crea una nuova anagrafica staff/freelance.
 * Body (camelCase): obbligatori `surname`, `name`, `email`, `defaultRoleCode`, `defaultLocation`;
 * `userLevel` (se omesso: `FREELANCE`); `active` (se omesso: `true`).
 * Opzionali: `phone`, `company`, `fee`, `plates`.
 */
router.post("/", async (req: Request, res) => {
  try {
    if (!(await requirePageEdit(req, res, "database"))) return;
    const body = req.body;
    const surname = String(body.surname ?? "").trim();
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim();
    const phone = body.phone != null ? String(body.phone).trim() || null : null;
    const company = body.company != null ? String(body.company).trim() || null : null;
    const default_role_code = String(body.defaultRoleCode ?? "").trim();
    const default_location = String(body.defaultLocation ?? "").trim();
    const fee = body.fee != null ? parseInt(String(body.fee), 10) : null;
    const plates = body.plates != null ? String(body.plates).trim() || null : null;
    let user_level: string;
    if (body.userLevel === undefined || body.userLevel === null) {
      user_level = "FREELANCE";
    } else {
      user_level = String(body.userLevel).trim();
      if (!user_level) {
        res.status(400).json({ error: "userLevel cannot be empty" });
        return;
      }
    }
    const active = body.active !== false;

    if (!surname || !name) {
      res.status(400).json({ error: "surname and name are required" });
      return;
    }
    if (!email) {
      res.status(400).json({ error: "email is required" });
      return;
    }
    if (!isValidEmail(email)) {
      res.status(400).json({ error: "email is invalid" });
      return;
    }
    if (!default_role_code) {
      res.status(400).json({ error: "defaultRoleCode is required" });
      return;
    }
    if (!(await roleCodeExists(default_role_code))) {
      res.status(400).json({ error: "defaultRoleCode does not match any role" });
      return;
    }
    if (!default_location) {
      res.status(400).json({ error: "defaultLocation is required" });
      return;
    }
    if (!isAllowedDefaultLocation(default_location)) {
      res.status(400).json({
        error: `defaultLocation must be one of: ${ALLOWED_DEFAULT_LOCATIONS.join(", ")}`,
      });
      return;
    }

    const result = await pool.query(
      `INSERT INTO staff (surname, name, email, phone, company, default_role_code, default_location, fee, plates, user_level, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, surname, name, email, phone, company, default_role_code, default_location, fee, plates, user_level, active`,
      [
        surname,
        name,
        email,
        phone,
        company,
        default_role_code,
        default_location,
        Number.isNaN(fee) ? null : fee,
        plates,
        user_level,
        active,
      ]
    );

    const staff = result.rows[0] as StaffItem;
    staff.id = String(staff.id) as StaffId;

    try {
      await ensureSupabaseUserForStaff({
        id: staff.id,
        email: staff.email,
        name: staff.name,
        surname: staff.surname,
      });
    } catch (supaErr) {
      console.error("ensureSupabaseUserForStaff error (staff created):", supaErr);
    }

    const session = getCurrentSession(req);
    void logAuditFromRequest(req, {
      actorType: session ? "staff" : "system",
      ...(session ? { actorId: session.staffId } : {}),
      entityType: "staff",
      entityId: String(staff.id),
      action: "create",
      metadata: {
        surname: staff.surname,
        name: staff.name,
        email: staff.email,
        defaultRoleCode: staff.default_role_code,
        defaultLocation: staff.default_location,
        userLevel: staff.user_level,
        active: staff.active,
        phone: staff.phone,
        company: staff.company,
        fee: staff.fee,
        plates: staff.plates,
      },
    });

    res.status(201).json(staff);
  } catch (err) {
    console.error("POST /api/staff error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

/**
 * PATCH /api/staff/:id/finance-access — override accesso area economica (`allow` | `deny` | default `NULL`).
 */
router.patch("/:id/finance-access", async (req: Request, res) => {
  try {
    if (!(await requirePageEdit(req, res, "master"))) return;
    const id = parseStaffRouteId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid staff id" });
      return;
    }

    const raw = (req.body as { financeAccessOverride?: unknown })
      .financeAccessOverride;

    let override: string | null;
    if (raw === undefined || raw === null) {
      override = null;
    } else if (raw === "allow" || raw === "deny") {
      override = raw;
    } else {
      res.status(400).json({
        error: 'financeAccessOverride must be "allow", "deny", or null',
      });
      return;
    }

    const result = await pool.query<{
      id: string;
      surname: string;
      name: string;
      email: string | null;
      finance_access_override: string | null;
    }>(
      `UPDATE staff
       SET finance_access_override = $2
       WHERE id = $1
       RETURNING id, surname, name, email, finance_access_override`,
      [id, override]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Staff not found" });
      return;
    }

    const row = result.rows[0];
    res.status(200).json({
      id: String(row.id) as StaffId,
      surname: row.surname,
      name: row.name,
      email: row.email,
      finance_access_override: row.finance_access_override,
    });
  } catch (err) {
    console.error("PATCH /api/staff/:id/finance-access error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

/**
 * PATCH /api/staff/:id — aggiorna parzialmente anagrafica staff.
 * Accetta un sottoinsieme dei campi di POST (camelCase); campi non mappati nel body vengono ignorati.
 */
router.patch("/:id", async (req: Request, res) => {
  try {
    if (!(await requirePageEdit(req, res, "database"))) return;
    const id = parseStaffRouteId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid staff id" });
      return;
    }

    const currentResult = await pool.query<StaffItem>(
      `SELECT id, surname, name, email, phone, company, default_role_code, default_location,
              fee, plates, user_level, active
       FROM staff WHERE id = $1`,
      [id]
    );
    if (currentResult.rows.length === 0) {
      res.status(404).json({ error: "Staff not found" });
      return;
    }
    const beforeStaff = currentResult.rows[0];

    const body = req.body;

    if (body.surname !== undefined) {
      const s = String(body.surname).trim();
      if (!s) {
        res.status(400).json({ error: "surname cannot be empty" });
        return;
      }
    }
    if (body.name !== undefined) {
      const s = String(body.name).trim();
      if (!s) {
        res.status(400).json({ error: "name cannot be empty" });
        return;
      }
    }
    if (body.email !== undefined) {
      if (body.email !== null) {
        const e = String(body.email).trim();
        if (e && !isValidEmail(e)) {
          res.status(400).json({ error: "email is invalid" });
          return;
        }
      }
    }
    if (body.defaultRoleCode !== undefined) {
      const code = String(body.defaultRoleCode ?? "").trim();
      if (!code) {
        res.status(400).json({ error: "defaultRoleCode cannot be empty" });
        return;
      }
      if (!(await roleCodeExists(code))) {
        res.status(400).json({ error: "defaultRoleCode does not match any role" });
        return;
      }
    }
    if (body.defaultLocation !== undefined) {
      const loc = String(body.defaultLocation ?? "").trim();
      if (!loc) {
        res.status(400).json({ error: "defaultLocation cannot be empty" });
        return;
      }
      if (!isAllowedDefaultLocation(loc)) {
        res.status(400).json({
          error: `defaultLocation must be one of: ${ALLOWED_DEFAULT_LOCATIONS.join(", ")}`,
        });
        return;
      }
    }
    if (body.userLevel !== undefined) {
      if (body.userLevel === null) {
        res.status(400).json({ error: "userLevel cannot be null" });
        return;
      }
      if (!String(body.userLevel).trim()) {
        res.status(400).json({ error: "userLevel cannot be empty" });
        return;
      }
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    const map: Array<[string, string, unknown]> = [
      ["surname", "surname", body.surname],
      ["name", "name", body.name],
      ["email", "email", body.email],
      ["phone", "phone", body.phone],
      ["company", "company", body.company],
      ["default_role_code", "defaultRoleCode", body.defaultRoleCode],
      ["default_location", "defaultLocation", body.defaultLocation],
      ["fee", "fee", body.fee],
      ["plates", "plates", body.plates],
      ["user_level", "userLevel", body.userLevel],
      ["active", "active", body.active],
    ];

    for (const [col, key, val] of map) {
      if (val !== undefined) {
        if (key === "fee") {
          const n = parseInt(String(val), 10);
          fields.push(`${col} = $${paramIdx}`);
          values.push(Number.isNaN(n) ? null : n);
        } else if (key === "active") {
          fields.push(`${col} = $${paramIdx}`);
          values.push(val !== false);
        } else if (key === "email") {
          fields.push(`${col} = $${paramIdx}`);
          if (val === null) {
            values.push(null);
          } else {
            const e = String(val).trim();
            values.push(e ? e : null);
          }
        } else {
          fields.push(`${col} = $${paramIdx}`);
          values.push(typeof val === "string" ? val.trim() || null : val);
        }
        paramIdx++;
      }
    }

    if (fields.length === 0) {
      const fullResult = await pool.query<StaffItem>(
        `SELECT id, surname, name, email, phone, company, default_role_code, default_location, fee, plates, user_level, active
         FROM staff WHERE id = $1`,
        [id]
      );
      res.json(fullResult.rows[0]);
      return;
    }

    values.push(id);
    await pool.query(
      `UPDATE staff SET ${fields.join(", ")} WHERE id = $${paramIdx}`,
      values
    );

    const updatedResult = await pool.query<StaffItem>(
      `SELECT id, surname, name, email, phone, company, default_role_code, default_location, fee, plates, user_level, active
       FROM staff WHERE id = $1`,
      [id]
    );
    const staff = updatedResult.rows[0];

    if (staff.email) {
      try {
        await ensureSupabaseUserForStaff({
          id: String(staff.id) as StaffId,
          email: staff.email,
          name: staff.name,
          surname: staff.surname,
        });
      } catch (supaErr) {
        console.error("ensureSupabaseUserForStaff error (staff updated):", supaErr);
      }
    }

    const changedFields = staffChangedFields(beforeStaff, staff);
    if (changedFields.length > 0) {
      const session = getCurrentSession(req);
      void logAuditFromRequest(req, {
        actorType: session ? "staff" : "system",
        ...(session ? { actorId: session.staffId } : {}),
        entityType: "staff",
        entityId: String(staff.id),
        action: "update",
        metadata: {
          surname: staff.surname,
          name: staff.name,
          email: staff.email,
          defaultRoleCode: staff.default_role_code,
          defaultLocation: staff.default_location,
          userLevel: staff.user_level,
          active: staff.active,
          changedFields,
        },
      });
    }

    res.json(staff);
  } catch (err) {
    console.error("PATCH /api/staff error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

/**
 * GET /api/staff/:id/assignments — vista admin / back-office per le assegnazioni di uno
 * staff specifico (`id` in URL, non «me»). Filtra già su status inviati/confermati/rifiutati
 * (`SENT`, `CONFIRMED`, `REJECTED`). Query: `status`, `from`, `to`, `limit`, `offset`.
 * Risposta: `{ items, total }` con `Assignment` + `AssignmentEventSummary` (`AssignmentWithEvent`).
 */
router.get("/:id/assignments", async (req: Request, res) => {
  try {
    if (!(await requirePageRead(req, res, "database"))) return;
    const id = parseStaffRouteId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid staff id" });
      return;
    }

    const status = (req.query.status as string)?.trim();
    const from = (req.query.from as string)?.trim();
    const to = (req.query.to as string)?.trim();
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit), 10) || 50, 1),
      200
    );
    const offset = Math.max(parseInt(String(req.query.offset), 10) || 0, 0);

    // Freelance view: only assignments the designatore has sent (SENT, CONFIRMED, REJECTED)
    const conditions: string[] = [
      "a.staff_id = $1",
      "a.status IN ('SENT', 'CONFIRMED', 'REJECTED')",
    ];
    const params: unknown[] = [id];
    let paramIdx = 2;

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

    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    params.push(limit, offset);

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::int as count
       FROM assignments a
       JOIN events e ON e.id = a.event_id
       ${whereClause}`,
      params.slice(0, -2)
    );
    const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

    const itemsResult = await pool.query(
      `SELECT a.id, a.event_id, a.role_id, a.staff_id, a.status, a.notes, a.created_at, a.updated_at,
              e.id as e_id, e.external_match_id as e_external_match_id, e.category, e.competition_name,
              e.competition_code, e.matchday, e.home_team_name_short, e.away_team_name_short,
              e.venue_name, e.venue_city, e.venue_address, e.ko_italy, e.pre_duration_minutes,
              e.standard_onsite, e.standard_cologno, e.location as e_area_produzione,
              e.show_name, e.rights_holder, e.facilities, e.studio, e.status as e_status
       FROM assignments a
       JOIN events e ON e.id = a.event_id
       ${whereClause}
       ORDER BY e.ko_italy ASC NULLS LAST, a.id ASC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    const items: AssignmentWithEvent[] = itemsResult.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        assignment: {
          id: r.id as number,
          eventId: r.event_id as number,
          roleId: r.role_id as number,
          staffId:
            r.staff_id != null ? String(r.staff_id) : null,
          status: r.status as AssignmentStatus,
          notes: r.notes as string | null,
          createdAt: String(r.created_at),
          updatedAt: String(r.updated_at),
        },
        event: {
          id: r.e_id as number,
          externalMatchId: r.e_external_match_id != null ? String(r.e_external_match_id) : null,
          category: r.category as string,
          competitionName: r.competition_name as string,
          competitionCode: r.competition_code as string | null,
          matchday: r.matchday as number | null,
          homeTeamNameShort: r.home_team_name_short as string | null,
          awayTeamNameShort: r.away_team_name_short as string | null,
          venueName: r.venue_name as string | null,
          venueCity: r.venue_city as string | null,
          venueAddress: r.venue_address as string | null,
          koItaly: r.ko_italy != null ? String(r.ko_italy) : null,
          preDurationMinutes: r.pre_duration_minutes as number,
          standardOnsite: r.standard_onsite as string | null,
          standardCologno: r.standard_cologno as string | null,
          areaProduzione: r.e_area_produzione as string | null,
          showName: r.show_name as string | null,
          rightsHolder: r.rights_holder as string | null,
          facilities: r.facilities as string | null,
          studio: r.studio as string | null,
          status: r.e_status as string,
        },
      };
    });

    res.json({ items, total });
  } catch (err) {
    console.error("GET /api/staff/:id/assignments error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
