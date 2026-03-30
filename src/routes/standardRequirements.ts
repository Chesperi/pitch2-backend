import { Router, Request, Response } from "express";
import { pool } from "../db";
import { getCurrentSession } from "../auth/session";
import {
  requirePageEdit,
  requirePageRead,
} from "../middleware/requirePageAccess";
import { logAuditFromRequest } from "../services/auditLog";
import type { StandardRequirementWithRole } from "../types";

const router = Router();

type StandardRequirementBody = {
  standardOnsite?: string;
  standardCologno?: string;
  site?: string;
  areaProduzione?: string | null;
  roleId?: number;
  quantity?: number;
  notes?: string | null;
};

function standardChangedFields(
  before: StandardRequirementWithRole,
  after: StandardRequirementWithRole
): string[] {
  const ch: string[] = [];
  if (before.standardOnsite !== after.standardOnsite) ch.push("standardOnsite");
  if (before.standardCologno !== after.standardCologno) {
    ch.push("standardCologno");
  }
  if (before.site !== after.site) ch.push("site");
  if (before.areaProduzione !== after.areaProduzione) {
    ch.push("areaProduzione");
  }
  if (before.roleId !== after.roleId) ch.push("roleId");
  if (before.quantity !== after.quantity) ch.push("quantity");
  if ((before.notes ?? null) !== (after.notes ?? null)) ch.push("notes");
  return ch;
}

/** Allowlist `site` (dominio produzione); allineare ai valori già in uso nel DB. */
const ALLOWED_STANDARD_SITES = [
  "STADIO",
  "COLOGNO",
  "GALLERY",
  "VMIX",
  "OFFTUBE",
  "LEEDS",
  "REMOTE",
] as const;

function isAllowedSite(v: string): boolean {
  return (ALLOWED_STANDARD_SITES as readonly string[]).includes(v);
}

function normalizeNotes(n: string | null | undefined): string | null {
  if (n == null) return null;
  const t = String(n).trim();
  return t === "" ? null : t;
}

function normalizeQuantity(q: number | null | undefined): number {
  const n = typeof q === "number" ? q : parseInt(String(q), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function normalizeAreaProduzione(v: string | null | undefined): string {
  if (v == null) return "";
  return String(v).trim();
}

function rowToStandardRequirementWithRole(
  row: Record<string, unknown>
): StandardRequirementWithRole {
  return {
    id: row.id as number,
    standardOnsite: row.standard_onsite as string,
    standardCologno: row.standard_cologno as string,
    site: row.site as string,
    areaProduzione: row.area_produzione as string,
    roleId: row.role_id as number,
    quantity: row.quantity as number,
    notes: row.notes as string | null,
    roleCode: row.role_code as string,
    roleName: row.role_name as string,
    roleLocation: row.role_location as string,
  };
}

const SELECT_COLS = `
  sr.id, sr.standard_onsite, sr.standard_cologno, sr.site, sr.area_produzione,
  sr.role_id, sr.quantity, sr.notes,
  r.code as role_code, r.name as role_name, r.location as role_location
`;

async function roleExists(roleId: number): Promise<boolean> {
  const r = await pool.query("SELECT 1 FROM roles WHERE id = $1", [roleId]);
  return r.rowCount != null && r.rowCount > 0;
}

async function fetchRequirementWithRoleById(
  id: number
): Promise<StandardRequirementWithRole | null> {
  const result = await pool.query(
    `SELECT ${SELECT_COLS}
     FROM standard_requirements sr
     JOIN roles r ON r.id = sr.role_id
     WHERE sr.id = $1`,
    [id]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToStandardRequirementWithRole(row);
}

function parseAndValidateSite(
  raw: string | undefined,
  options: { required: boolean; defaultIfMissing?: string }
): { ok: true; value: string } | { ok: false; error: string } {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    if (options.required && options.defaultIfMissing) {
      return { ok: true, value: options.defaultIfMissing };
    }
    if (options.required) {
      return { ok: false, error: "site is required" };
    }
    return { ok: false, error: "site cannot be empty when provided" };
  }
  const v = String(raw).trim().toUpperCase();
  if (!isAllowedSite(v)) {
    return {
      ok: false,
      error: `site must be one of: ${ALLOWED_STANDARD_SITES.join(", ")}`,
    };
  }
  return { ok: true, value: v };
}

// GET /api/standard-requirements
// Con filtri: standardOnsite, standardCologno (obbligatori per filtro), site (opzionale)
// Senza filtri: restituisce tutti (per pagina Database), con paginazione
router.get("/", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageRead(req, res, "database"))) return;
    const standardOnsite = (req.query.standardOnsite as string)?.trim();
    const standardCologno = (req.query.standardCologno as string)?.trim();
    const site = (req.query.site as string)?.trim();
    const areaProduzione = (req.query.areaProduzione as string)?.trim();
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const pageSize = Math.min(
      Math.max(parseInt(String(req.query.pageSize), 10) || 50, 1),
      200
    );
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (standardOnsite) {
      conditions.push(`sr.standard_onsite = $${paramIdx}`);
      params.push(standardOnsite);
      paramIdx++;
    }
    if (standardCologno) {
      conditions.push(`sr.standard_cologno = $${paramIdx}`);
      params.push(standardCologno);
      paramIdx++;
    }
    if (site) {
      conditions.push(`sr.site = $${paramIdx}`);
      params.push(site);
      paramIdx++;
    }
    if (areaProduzione) {
      conditions.push(`sr.area_produzione = $${paramIdx}`);
      params.push(areaProduzione);
      paramIdx++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::int as count FROM standard_requirements sr JOIN roles r ON r.id = sr.role_id ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

    params.push(pageSize, offset);
    const result = await pool.query(
      `SELECT ${SELECT_COLS}
       FROM standard_requirements sr
       JOIN roles r ON r.id = sr.role_id
       ${whereClause}
       ORDER BY sr.standard_onsite, sr.standard_cologno, sr.site, sr.area_produzione, r.code
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    const items = result.rows.map((r) =>
      rowToStandardRequirementWithRole(r as Record<string, unknown>)
    );

    res.json({ items, total });
  } catch (err) {
    console.error("GET /api/standard-requirements error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageEdit(req, res, "database"))) return;
    const body = req.body as StandardRequirementBody;

    const onsite =
      typeof body.standardOnsite === "string"
        ? body.standardOnsite.trim()
        : "";
    const cologno =
      typeof body.standardCologno === "string"
        ? body.standardCologno.trim()
        : "";
    if (!onsite) {
      res.status(400).json({ error: "standardOnsite is required" });
      return;
    }
    if (!cologno) {
      res.status(400).json({ error: "standardCologno is required" });
      return;
    }

    const rid =
      typeof body.roleId === "number"
        ? body.roleId
        : parseInt(String(body.roleId), 10);
    if (!Number.isFinite(rid) || rid < 1) {
      res.status(400).json({ error: "roleId is required and must be a positive integer" });
      return;
    }
    if (!(await roleExists(rid))) {
      res.status(400).json({ error: "roleId does not reference an existing role" });
      return;
    }

    const siteParsed = parseAndValidateSite(body.site, {
      required: true,
      defaultIfMissing: "STADIO",
    });
    if (!siteParsed.ok) {
      res.status(400).json({ error: siteParsed.error });
      return;
    }

    const area = normalizeAreaProduzione(body.areaProduzione);
    const quantity = normalizeQuantity(body.quantity);
    const notes = normalizeNotes(body.notes);

    const insert = await pool.query<{ id: number }>(
      `INSERT INTO standard_requirements
        (standard_onsite, standard_cologno, site, area_produzione, role_id, quantity, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [onsite, cologno, siteParsed.value, area, rid, quantity, notes]
    );

    const newId = insert.rows[0]?.id;
    if (newId == null) {
      res.status(500).json({ error: "Insert returned no id" });
      return;
    }

    const full = await fetchRequirementWithRoleById(newId);
    if (!full) {
      res.status(500).json({ error: "Failed to load created standard requirement" });
      return;
    }

    const session = getCurrentSession(req);
    void logAuditFromRequest(req, {
      actorType: session ? "staff" : "system",
      ...(session ? { actorId: session.staffId } : {}),
      entityType: "standard",
      entityId: String(full.id),
      action: "create",
      metadata: {
        standardOnsite: full.standardOnsite,
        standardCologno: full.standardCologno,
        site: full.site,
        areaProduzione: full.areaProduzione,
        roleId: full.roleId,
        roleCode: full.roleCode,
        quantity: full.quantity,
        notes: full.notes,
      },
    });

    res.status(201).json(full);
  } catch (err) {
    console.error("POST /api/standard-requirements error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageEdit(req, res, "database"))) return;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid standard requirement id" });
      return;
    }

    const before = await fetchRequirementWithRoleById(id);
    if (!before) {
      res.status(404).json({ error: "Standard requirement not found" });
      return;
    }

    const body = req.body as StandardRequirementBody;
    const fields: string[] = [];
    const values: unknown[] = [];
    let p = 1;

    if (body.standardOnsite !== undefined) {
      const t =
        typeof body.standardOnsite === "string"
          ? body.standardOnsite.trim()
          : "";
      if (!t) {
        res.status(400).json({ error: "standardOnsite cannot be empty" });
        return;
      }
      fields.push(`standard_onsite = $${p++}`);
      values.push(t);
    }

    if (body.standardCologno !== undefined) {
      const t =
        typeof body.standardCologno === "string"
          ? body.standardCologno.trim()
          : "";
      if (!t) {
        res.status(400).json({ error: "standardCologno cannot be empty" });
        return;
      }
      fields.push(`standard_cologno = $${p++}`);
      values.push(t);
    }

    if (body.site !== undefined) {
      const siteParsed = parseAndValidateSite(body.site, { required: false });
      if (!siteParsed.ok) {
        res.status(400).json({ error: siteParsed.error });
        return;
      }
      fields.push(`site = $${p++}`);
      values.push(siteParsed.value);
    }

    if (body.areaProduzione !== undefined) {
      fields.push(`area_produzione = $${p++}`);
      values.push(normalizeAreaProduzione(body.areaProduzione));
    }

    if (body.roleId !== undefined) {
      const rid =
        typeof body.roleId === "number"
          ? body.roleId
          : parseInt(String(body.roleId), 10);
      if (!Number.isFinite(rid) || rid < 1) {
        res.status(400).json({ error: "roleId must be a positive integer" });
        return;
      }
      if (!(await roleExists(rid))) {
        res.status(400).json({ error: "roleId does not reference an existing role" });
        return;
      }
      fields.push(`role_id = $${p++}`);
      values.push(rid);
    }

    if (body.quantity !== undefined) {
      const q = normalizeQuantity(body.quantity);
      fields.push(`quantity = $${p++}`);
      values.push(q);
    }

    if (body.notes !== undefined) {
      fields.push(`notes = $${p++}`);
      values.push(normalizeNotes(body.notes));
    }

    if (fields.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    values.push(id);
    await pool.query(
      `UPDATE standard_requirements SET ${fields.join(", ")} WHERE id = $${p}`,
      values
    );

    const full = await fetchRequirementWithRoleById(id);
    if (!full) {
      res.status(404).json({ error: "Standard requirement not found" });
      return;
    }

    const changedFields = standardChangedFields(before, full);
    if (changedFields.length > 0) {
      const session = getCurrentSession(req);
      void logAuditFromRequest(req, {
        actorType: session ? "staff" : "system",
        ...(session ? { actorId: session.staffId } : {}),
        entityType: "standard",
        entityId: String(full.id),
        action: "update",
        metadata: {
          standardOnsite: full.standardOnsite,
          standardCologno: full.standardCologno,
          site: full.site,
          areaProduzione: full.areaProduzione,
          roleId: full.roleId,
          roleCode: full.roleCode,
          quantity: full.quantity,
          notes: full.notes,
          changedFields,
        },
      });
    }

    res.json(full);
  } catch (err) {
    console.error("PATCH /api/standard-requirements/:id error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
