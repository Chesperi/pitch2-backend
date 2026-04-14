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
import { supabaseAdmin } from "../supabaseClient";
import type { StaffId } from "../types/staffId";
import { resolveStaffDbIntegerId } from "../services/staffService";
import { createPasswordResetToken } from "../services/passwordResets";
import { sendInviteEmail } from "../services/brevo";

const FRONTEND_BASE =
  process.env.FRONTEND_BASE_URL ||
  process.env.PITCH_FREELANCE_BASE_URL ||
  "https://app.designazionipitch.com";

const router = Router();

function combineEventKo(date: unknown, time: unknown): string | null {
  const d = date != null ? String(date).slice(0, 10) : "";
  const t = time != null ? String(time).trim() : "";
  if (d && t) return `${d}T${t}`;
  return d || t || null;
}

async function resolveStaffPkFromParam(raw: string): Promise<number | null> {
  const t = String(raw ?? "").trim();
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    return n > 0 ? n : null;
  }
  return resolveStaffDbIntegerId(t);
}

/** Allineato a `roles.location` in `src/routes/roles.ts` (estendere se servono altre sedi). */
const ALLOWED_DEFAULT_LOCATIONS = ["STADIO", "COLOGNO", "LEEDS", "REMOTE"] as const;

function isAllowedDefaultLocation(v: string): boolean {
  return (ALLOWED_DEFAULT_LOCATIONS as readonly string[]).includes(v);
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Ritorna `YYYY-MM-DD` o `null`; 400 se valorizzato ma non valido. */
function normalizeDateOfBirthInput(
  raw: unknown,
  fieldLabel: string
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null };
  }
  const s = String(raw).trim();
  if (s === "") {
    return { ok: true, value: null };
  }
  if (!ISO_DATE_ONLY_RE.test(s)) {
    return {
      ok: false,
      error: `${fieldLabel} deve essere nel formato YYYY-MM-DD`,
    };
  }
  const t = Date.parse(`${s}T12:00:00.000Z`);
  if (Number.isNaN(t)) {
    return {
      ok: false,
      error: `${fieldLabel} non è una data valida`,
    };
  }
  return { ok: true, value: s };
}

function normalizeFinanceVisibilityCreate(
  raw: unknown
): { ok: true; value: "HIDDEN" | "VISIBLE" } | { ok: false; error: string } {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { ok: true, value: "HIDDEN" };
  }
  const s = String(raw).trim().toUpperCase();
  if (s !== "HIDDEN" && s !== "VISIBLE") {
    return {
      ok: false,
      error: "financeVisibility deve essere HIDDEN o VISIBLE",
    };
  }
  return { ok: true, value: s };
}

function optTrimString(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

async function rolePairExists(
  roleCode: string,
  roleLocation: string
): Promise<boolean> {
  const r = await pool.query(
    "SELECT 1 FROM roles WHERE role_code = $1 AND location = $2 LIMIT 1",
    [roleCode, roleLocation]
  );
  return (r.rowCount ?? 0) > 0;
}

export type StaffItem = {
  id: number;
  surname: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  default_role_code: string | null;
  default_location: string | null;
  fee: string | null;
  plates: string | null;
  user_level: string;
  active: boolean;
  place_of_birth: string | null;
  date_of_birth: string | null;
  residential_address: string | null;
  id_number: string | null;
  extra_fee: string | null;
  team_dazn: string | null;
  notes: string | null;
  finance_visibility: string;
};

/** Colonne staff per liste e dettagli (GET /api/staff, PATCH response, POST RETURNING). */
const STAFF_ROW_SELECT = `
  id, surname, name, email, phone, company, default_role_code, default_location,
  fee, plates, user_level, active,
  place_of_birth, date_of_birth, residential_address, id_number,
  extra_fee, team_dazn, notes, finance_visibility
`;

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
  if ((before.place_of_birth ?? null) !== (after.place_of_birth ?? null)) {
    changed.push("placeOfBirth");
  }
  if ((before.date_of_birth ?? null) !== (after.date_of_birth ?? null)) {
    changed.push("dateOfBirth");
  }
  if ((before.residential_address ?? null) !== (after.residential_address ?? null)) {
    changed.push("residentialAddress");
  }
  if ((before.id_number ?? null) !== (after.id_number ?? null)) {
    changed.push("idNumber");
  }
  if ((before.extra_fee ?? null) !== (after.extra_fee ?? null)) {
    changed.push("extraFee");
  }
  if ((before.team_dazn ?? null) !== (after.team_dazn ?? null)) {
    changed.push("teamDazn");
  }
  if ((before.notes ?? null) !== (after.notes ?? null)) changed.push("notes");
  if (before.finance_visibility !== after.finance_visibility) {
    changed.push("financeVisibility");
  }
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
      1000
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
      `SELECT ${STAFF_ROW_SELECT}
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
 * Opzionali: `phone`, `company`, `fee`, `plates`,
 * `placeOfBirth`, `dateOfBirth` (YYYY-MM-DD), `residentialAddress`, `idNumber`,
 * `extraFee`, `teamDazn`, `notes`, `financeVisibility` (HIDDEN | VISIBLE; default HIDDEN).
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
    const fee =
      body.fee != null && String(body.fee).trim() !== ""
        ? String(body.fee).trim()
        : null;
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
    if (
      !(await rolePairExists(
        default_role_code,
        default_location.trim().toUpperCase()
      ))
    ) {
      res.status(400).json({
        error:
          "defaultRoleCode and defaultLocation do not match any role (pair must exist in roles)",
      });
      return;
    }

    const dobResult = normalizeDateOfBirthInput(body.dateOfBirth, "dateOfBirth");
    if (!dobResult.ok) {
      res.status(400).json({ error: dobResult.error });
      return;
    }
    const fvResult = normalizeFinanceVisibilityCreate(body.financeVisibility);
    if (!fvResult.ok) {
      res.status(400).json({ error: fvResult.error });
      return;
    }

    const place_of_birth = optTrimString(body.placeOfBirth);
    const date_of_birth = dobResult.value;
    const residential_address = optTrimString(body.residentialAddress);
    const id_number = optTrimString(body.idNumber);
    const extra_fee = optTrimString(body.extraFee);
    const team_dazn = optTrimString(body.teamDazn);
    const notes = optTrimString(body.notes);
    const finance_visibility = fvResult.value;

    const result = await pool.query(
      `INSERT INTO staff (
        surname, name, email, phone, company, default_role_code, default_location, fee, plates,
        user_level, active,
        place_of_birth, date_of_birth, residential_address, id_number,
        extra_fee, team_dazn, notes, finance_visibility
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING ${STAFF_ROW_SELECT}`,
      [
        surname,
        name,
        email,
        phone,
        company,
        default_role_code,
        default_location,
        fee,
        plates,
        user_level,
        active,
        place_of_birth,
        date_of_birth,
        residential_address,
        id_number,
        extra_fee,
        team_dazn,
        notes,
        finance_visibility,
      ]
    );

    const staff = result.rows[0] as StaffItem;

    try {
      await ensureSupabaseUserForStaff({
        id: String(staff.id) as StaffId,
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
        placeOfBirth: staff.place_of_birth,
        dateOfBirth: staff.date_of_birth,
        residentialAddress: staff.residential_address,
        idNumber: staff.id_number,
        extraFee: staff.extra_fee,
        teamDazn: staff.team_dazn,
        notes: staff.notes,
        financeVisibility: staff.finance_visibility,
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
 * POST /api/staff/:id/invite — invia email con link per impostare la password (stesso flusso di forgot-password).
 */
router.post("/:id/invite", async (req: Request, res) => {
  try {
    if (!(await requirePageEdit(req, res, "database"))) return;

    const staffPk = await resolveStaffPkFromParam(req.params.id);
    if (staffPk == null) {
      res.status(400).json({ error: "Invalid staff id" });
      return;
    }

    const result = await pool.query<{
      id: number;
      name: string | null;
      surname: string | null;
      email: string | null;
    }>(
      `SELECT id, name, surname, email FROM staff WHERE id = $1`,
      [staffPk]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Staff not found" });
      return;
    }

    const row = result.rows[0];
    const email = row.email?.trim();
    if (!email) {
      res.status(400).json({ error: "Staff has no email" });
      return;
    }
    if (!isValidEmail(email)) {
      res.status(400).json({ error: "Invalid email" });
      return;
    }

    const token = await createPasswordResetToken(staffPk, email);
    const inviteUrl = `${FRONTEND_BASE.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
    const staffName =
      `${row.name ?? ""} ${row.surname ?? ""}`.trim() || email;

    await sendInviteEmail({
      toEmail: email,
      toName: staffName,
      inviteUrl,
    });

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("POST /api/staff/:id/invite error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

/**
 * DELETE /api/staff/:id — rimuove l'utente Supabase Auth (se collegato) e la riga staff.
 */
router.delete("/:id", async (req: Request, res) => {
  try {
    if (!(await requirePageEdit(req, res, "database"))) return;

    const staffPk = await resolveStaffPkFromParam(req.params.id);
    if (staffPk == null) {
      res.status(400).json({ error: "Invalid staff id" });
      return;
    }

    const result = await pool.query<{ id: number; supabase_id: string | null }>(
      `SELECT id, supabase_id::text AS supabase_id FROM staff WHERE id = $1`,
      [staffPk]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Staff not found" });
      return;
    }

    const supabaseId = result.rows[0].supabase_id?.trim();
    if (supabaseAdmin && supabaseId) {
      const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(
        supabaseId
      );
      if (authErr) {
        const msg = authErr.message.toLowerCase();
        const notFound =
          msg.includes("not found") ||
          msg.includes("user not found") ||
          authErr.status === 404;
        if (!notFound) {
          console.error("DELETE staff: Supabase auth.admin.deleteUser:", authErr);
          res.status(502).json({
            error: "Impossibile eliminare l'utente su Supabase",
          });
          return;
        }
      }
    }

    const del = await pool.query(`DELETE FROM staff WHERE id = $1`, [staffPk]);
    if ((del.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "Staff not found" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/staff/:id error:", err);
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
    const staffPk = await resolveStaffPkFromParam(req.params.id);
    if (staffPk == null) {
      res.status(400).json({ error: "Invalid staff id" });
      return;
    }

    const currentResult = await pool.query<StaffItem>(
      `SELECT ${STAFF_ROW_SELECT} FROM staff WHERE id = $1`,
      [staffPk]
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
    if (body.defaultRoleCode !== undefined || body.defaultLocation !== undefined) {
      const pairCode =
        body.defaultRoleCode !== undefined
          ? String(body.defaultRoleCode ?? "").trim()
          : (beforeStaff.default_role_code ?? "").trim();
      const pairLocRaw =
        body.defaultLocation !== undefined
          ? String(body.defaultLocation ?? "").trim()
          : (beforeStaff.default_location ?? "").trim();
      if (!pairCode || !pairLocRaw) {
        res.status(400).json({
          error:
            "Impossibile validare il ruolo: servono defaultRoleCode e defaultLocation (aggiorna entrambi se manca uno dei due in anagrafica).",
        });
        return;
      }
      if (!(await rolePairExists(pairCode, pairLocRaw.toUpperCase()))) {
        res.status(400).json({
          error:
            "defaultRoleCode e defaultLocation non corrispondono a nessuna riga in roles (coppia univoca).",
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

    let patchDateOfBirth: string | null | undefined = undefined;
    if (body.dateOfBirth !== undefined) {
      const dr = normalizeDateOfBirthInput(body.dateOfBirth, "dateOfBirth");
      if (!dr.ok) {
        res.status(400).json({ error: dr.error });
        return;
      }
      patchDateOfBirth = dr.value;
    }

    let patchFinanceVisibility: "HIDDEN" | "VISIBLE" | undefined = undefined;
    if (body.financeVisibility !== undefined) {
      const s = String(body.financeVisibility).trim().toUpperCase();
      if (s !== "HIDDEN" && s !== "VISIBLE") {
        res.status(400).json({
          error: "financeVisibility deve essere HIDDEN o VISIBLE",
        });
        return;
      }
      patchFinanceVisibility = s as "HIDDEN" | "VISIBLE";
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

    if (body.placeOfBirth !== undefined) {
      map.push([
        "place_of_birth",
        "placeOfBirth",
        body.placeOfBirth === null
          ? null
          : String(body.placeOfBirth).trim() || null,
      ]);
    }
    if (body.residentialAddress !== undefined) {
      map.push([
        "residential_address",
        "residentialAddress",
        body.residentialAddress === null
          ? null
          : String(body.residentialAddress).trim() || null,
      ]);
    }
    if (body.idNumber !== undefined) {
      map.push([
        "id_number",
        "idNumber",
        body.idNumber === null ? null : String(body.idNumber).trim() || null,
      ]);
    }
    if (body.extraFee !== undefined) {
      map.push([
        "extra_fee",
        "extraFee",
        body.extraFee === null ? null : String(body.extraFee).trim() || null,
      ]);
    }
    if (body.teamDazn !== undefined) {
      map.push([
        "team_dazn",
        "teamDazn",
        body.teamDazn === null ? null : String(body.teamDazn).trim() || null,
      ]);
    }
    if (body.notes !== undefined) {
      map.push([
        "notes",
        "notes",
        body.notes === null ? null : String(body.notes).trim() || null,
      ]);
    }
    if (patchDateOfBirth !== undefined) {
      map.push(["date_of_birth", "dateOfBirth", patchDateOfBirth]);
    }
    if (patchFinanceVisibility !== undefined) {
      map.push([
        "finance_visibility",
        "financeVisibility",
        patchFinanceVisibility,
      ]);
    }

    for (const [col, key, val] of map) {
      if (val !== undefined) {
        if (key === "fee") {
          const t = val === null || val === undefined ? "" : String(val).trim();
          fields.push(`${col} = $${paramIdx}`);
          values.push(t === "" ? null : t);
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
        `SELECT ${STAFF_ROW_SELECT} FROM staff WHERE id = $1`,
        [staffPk]
      );
      res.json(fullResult.rows[0]);
      return;
    }

    values.push(staffPk);
    await pool.query(
      `UPDATE staff SET ${fields.join(", ")} WHERE id = $${paramIdx}`,
      values
    );

    const updatedResult = await pool.query<StaffItem>(
      `SELECT ${STAFF_ROW_SELECT} FROM staff WHERE id = $1`,
      [staffPk]
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
          placeOfBirth: staff.place_of_birth,
          dateOfBirth: staff.date_of_birth,
          residentialAddress: staff.residential_address,
          idNumber: staff.id_number,
          extraFee: staff.extra_fee,
          teamDazn: staff.team_dazn,
          notes: staff.notes,
          financeVisibility: staff.finance_visibility,
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
    const staffPk = await resolveStaffPkFromParam(req.params.id);
    if (staffPk == null) {
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

    const conditions: string[] = [
      "a.staff_id = $1",
      "a.status IN ('SENT', 'CONFIRMED', 'REJECTED')",
    ];
    const params: unknown[] = [staffPk];
    let paramIdx = 2;

    if (status) {
      conditions.push(`a.status = $${paramIdx}`);
      params.push(status);
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
      `SELECT a.id, a.event_id, a.role_code, a.role_location, a.staff_id, a.status, a.notes, a.created_at, a.updated_at,
              e.id as e_id, e.category, e.competition_name, e.matchday,
              e.date as e_date, e.ko_italy_time as e_ko_italy_time,
              e.home_team_name_short, e.away_team_name_short, e.pre_duration_minutes,
              e.standard_onsite, e.standard_cologno,
              e.show_name, e.rights_holder, e.facilities, e.studio, e.status as e_status
       FROM assignments a
       JOIN events e ON e.id = a.event_id
       ${whereClause}
       ORDER BY e.date ASC NULLS LAST, e.ko_italy_time ASC NULLS LAST, a.id ASC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    const items: AssignmentWithEvent[] = itemsResult.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        assignment: {
          id: r.id as number,
          eventId: String(r.event_id ?? ""),
          roleCode: String(r.role_code ?? ""),
          roleLocation: String(r.role_location ?? ""),
          staffId: r.staff_id != null ? Number(r.staff_id) : null,
          status: r.status as AssignmentStatus,
          notes: r.notes as string | null,
          createdAt: String(r.created_at),
          updatedAt: String(r.updated_at),
        },
        event: {
          id: String(r.e_id ?? ""),
          category: r.category as string,
          competitionName: r.competition_name as string,
          matchday: r.matchday as number | null,
          homeTeamNameShort: r.home_team_name_short as string | null,
          awayTeamNameShort: r.away_team_name_short as string | null,
          koItaly: combineEventKo(r.e_date, r.e_ko_italy_time),
          preDurationMinutes: Number(r.pre_duration_minutes ?? 0),
          standardOnsite: r.standard_onsite as string | null,
          standardCologno: r.standard_cologno as string | null,
          showName: r.show_name as string | null,
          rightsHolder: r.rights_holder as string | null,
          facilities: r.facilities as string | null,
          studio: r.studio as string | null,
          status: String(r.e_status ?? ""),
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

/**
 * PATCH /api/staff/:id/finance-access
 * Body: { financeAccessOverride: "allow" | "deny" | null }
 */
router.patch("/:id/finance-access", async (req: Request, res) => {
  try {
    if (!(await requirePageEdit(req, res, "master"))) return;
    const staffPk = await resolveStaffPkFromParam(req.params.id);
    if (staffPk == null) {
      res.status(400).json({ error: "Invalid staff id" });
      return;
    }
    const value = (req.body as { financeAccessOverride?: unknown })
      .financeAccessOverride;
    let financeVisibility: "VISIBLE" | "HIDDEN";
    if (value === "allow") {
      financeVisibility = "VISIBLE";
    } else if (value === "deny" || value === null || value === "default") {
      financeVisibility = "HIDDEN";
    } else {
      res.status(400).json({
        error: "financeAccessOverride must be allow, deny or null",
      });
      return;
    }
    const result = await pool.query<StaffItem>(
      `UPDATE staff
       SET finance_visibility = $1
       WHERE id = $2
       RETURNING ${STAFF_ROW_SELECT}`,
      [financeVisibility, staffPk]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Staff not found" });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("PATCH /api/staff/:id/finance-access error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
