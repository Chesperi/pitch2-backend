import { Router, Request, Response } from "express";
import type { PoolClient } from "pg";
import { pool } from "../db";
import {
  requirePageEdit,
  requirePageRead,
} from "../middleware/requirePageAccess";
import type {
  StandardComboWithRequirements,
  StandardRequirementWithRole,
} from "../types";

const router = Router();

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

function normalizeOptionalText(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

function normalizeCoverageType(v: unknown): "FREELANCE" | "PROVIDER" | "EITHER" {
  const t = String(v ?? "FREELANCE").trim().toUpperCase();
  if (t === "PROVIDER" || t === "EITHER") return t;
  return "FREELANCE";
}

function siteForRequirementRow(roleLocationUpper: string): string {
  if (isAllowedSite(roleLocationUpper)) return roleLocationUpper;
  return "STADIO";
}

function reqRowToWithRole(row: Record<string, unknown>): StandardRequirementWithRole {
  const scid = row.standard_combo_id;
  return {
    id: row.id as number,
    standardOnsite: row.standard_onsite as string,
    standardCologno: row.standard_cologno as string,
    site: row.site as string,
    areaProduzione: row.area_produzione as string,
    roleCode: row.role_code as string,
    quantity: row.quantity as number,
    notes: row.notes as string | null,
    roleLocation: row.role_location as string,
    roleDescription:
      row.role_description != null ? String(row.role_description) : null,
    facilities:
      row.facilities != null && String(row.facilities).trim() !== ""
        ? String(row.facilities).trim()
        : null,
    studio:
      row.studio != null && String(row.studio).trim() !== ""
        ? String(row.studio).trim()
        : null,
    coverageType:
      String(row.coverage_type ?? "FREELANCE").toUpperCase() as
        | "FREELANCE"
        | "PROVIDER"
        | "EITHER",
    standardComboId:
      scid != null && scid !== "" && !Number.isNaN(Number(scid))
        ? Number(scid)
        : null,
  };
}

const SELECT_REQ_COLS = `
  sr.id, sr.standard_onsite, sr.standard_cologno, sr.site, sr.area_produzione,
  sr.role_code, sr.role_location, sr.quantity, sr.notes,
  sr.facilities, sr.studio, sr.coverage_type, sr.standard_combo_id,
  r.description as role_description
`;

async function rolePairExists(
  client: PoolClient,
  roleCode: string,
  roleLocation: string
): Promise<boolean> {
  const r = await client.query(
    "SELECT 1 FROM roles WHERE role_code = $1 AND location = $2 LIMIT 1",
    [roleCode, roleLocation]
  );
  return r.rowCount != null && r.rowCount > 0;
}

async function insertComboRequirements(
  client: PoolClient,
  comboId: number,
  header: {
    standardOnsite: string;
    standardCologno: string;
    facilities: string | null;
    studio: string | null;
  },
  lines: ComboRequirementLine[]
): Promise<void> {
  for (const line of lines) {
    const roleCode =
      typeof line.roleCode === "string" ? line.roleCode.trim() : "";
    const roleLocationRaw =
      typeof line.roleLocation === "string" ? line.roleLocation.trim() : "";
    const roleLocation = roleLocationRaw ? roleLocationRaw.toUpperCase() : "";
    if (!roleCode || !roleLocation) {
      throw new Error("Each requirement needs roleCode and roleLocation");
    }
    if (!(await rolePairExists(client, roleCode, roleLocation))) {
      throw new Error(
        `roleCode and roleLocation do not reference an existing role: ${roleCode} / ${roleLocation}`
      );
    }
    const site = siteForRequirementRow(roleLocation);
    const quantity = normalizeQuantity(line.quantity);
    const notes = normalizeNotes(line.notes);
    const coverageType = normalizeCoverageType(line.coverageType);
    await client.query(
      `INSERT INTO standard_requirements
        (standard_onsite, standard_cologno, site, area_produzione,
         role_code, role_location, quantity, notes, facilities, studio, coverage_type, standard_combo_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        header.standardOnsite,
        header.standardCologno,
        site,
        "",
        roleCode,
        roleLocation,
        quantity,
        notes,
        header.facilities,
        header.studio,
        coverageType,
        comboId,
      ]
    );
  }
}

type ComboRequirementLine = {
  roleCode?: string;
  roleLocation?: string;
  quantity?: number;
  coverageType?: string;
  notes?: string | null;
};

type ComboBody = {
  standardOnsite?: string;
  standardCologno?: string;
  facilities?: string | null;
  studio?: string | null;
  notes?: string | null;
  requirements?: ComboRequirementLine[];
};

function comboRowToApi(row: Record<string, unknown>): Omit<
  StandardComboWithRequirements,
  "requirements"
> {
  const ca = row.created_at;
  const createdAt =
    ca instanceof Date
      ? ca.toISOString()
      : ca != null
        ? String(ca)
        : "";
  return {
    id: row.id as number,
    standardOnsite: String(row.standard_onsite ?? ""),
    standardCologno: String(row.standard_cologno ?? ""),
    facilities: normalizeOptionalText(row.facilities as string | null),
    studio: normalizeOptionalText(row.studio as string | null),
    notes: normalizeNotes(row.notes as string | null),
    createdAt,
  };
}

router.get("/", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageRead(req, res, "database"))) return;

    const combosResult = await pool.query(
      `SELECT id, standard_onsite, standard_cologno, facilities, studio, notes, created_at
       FROM standard_combos
       ORDER BY standard_onsite ASC, standard_cologno ASC, id ASC`
    );

    const reqsResult = await pool.query(
      `SELECT ${SELECT_REQ_COLS}
       FROM standard_requirements sr
       JOIN roles r ON r.role_code = sr.role_code AND r.location = sr.role_location
       WHERE sr.standard_combo_id IS NOT NULL
       ORDER BY sr.standard_combo_id ASC, sr.id ASC`
    );

    const byCombo = new Map<number, StandardRequirementWithRole[]>();
    for (const r of reqsResult.rows as Record<string, unknown>[]) {
      const cid = Number(r.standard_combo_id);
      if (!Number.isFinite(cid)) continue;
      const list = byCombo.get(cid) ?? [];
      list.push(reqRowToWithRole(r));
      byCombo.set(cid, list);
    }

    const out: StandardComboWithRequirements[] = combosResult.rows.map(
      (row: Record<string, unknown>) => {
        const base = comboRowToApi(row);
        return {
          ...base,
          requirements: byCombo.get(base.id) ?? [],
        };
      }
    );

    res.json(out);
  } catch (err) {
    console.error("GET /api/standard-combos error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

router.post("/", async (req: Request, res: Response) => {
  const body = req.body as ComboBody;
  if (!(await requirePageEdit(req, res, "database"))) return;

  const onsite =
    typeof body.standardOnsite === "string"
      ? body.standardOnsite.trim()
      : "";
  const cologno =
    typeof body.standardCologno === "string"
      ? body.standardCologno.trim()
      : "";
  if (!onsite || !cologno) {
    res.status(400).json({ error: "standardOnsite and standardCologno are required" });
    return;
  }

  const facilities = normalizeOptionalText(body.facilities);
  const studio = normalizeOptionalText(body.studio);
  const notes = normalizeNotes(body.notes);
  const lines = Array.isArray(body.requirements) ? body.requirements : [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ins = await client.query<{ id: number }>(
      `INSERT INTO standard_combos (standard_onsite, standard_cologno, facilities, studio, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [onsite, cologno, facilities, studio, notes]
    );
    const newId = ins.rows[0]?.id;
    if (newId == null) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "Insert combo returned no id" });
      return;
    }

    await insertComboRequirements(client, newId, {
      standardOnsite: onsite,
      standardCologno: cologno,
      facilities,
      studio,
    }, lines);

    await client.query("COMMIT");

    const full = await loadComboWithRequirements(newId);
    if (!full) {
      res.status(500).json({ error: "Failed to load created combo" });
      return;
    }
    res.status(201).json(full);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /api/standard-combos error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  } finally {
    client.release();
  }
});

async function loadComboWithRequirements(
  id: number
): Promise<StandardComboWithRequirements | null> {
  const c = await pool.query(
    `SELECT id, standard_onsite, standard_cologno, facilities, studio, notes, created_at
     FROM standard_combos WHERE id = $1`,
    [id]
  );
  const crow = c.rows[0] as Record<string, unknown> | undefined;
  if (!crow) return null;

  const reqs = await pool.query(
    `SELECT ${SELECT_REQ_COLS}
     FROM standard_requirements sr
     JOIN roles r ON r.role_code = sr.role_code AND r.location = sr.role_location
     WHERE sr.standard_combo_id = $1
     ORDER BY sr.id ASC`,
    [id]
  );

  const base = comboRowToApi(crow);
  return {
    ...base,
    requirements: reqs.rows.map((r) =>
      reqRowToWithRole(r as Record<string, unknown>)
    ),
  };
}

router.patch("/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid combo id" });
    return;
  }

  const body = req.body as ComboBody;
  if (!(await requirePageEdit(req, res, "database"))) return;

  const client = await pool.connect();
  try {
    const existing = await client.query(
      `SELECT id, standard_onsite, standard_cologno, facilities, studio, notes, created_at
       FROM standard_combos WHERE id = $1`,
      [id]
    );
    const row = existing.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: "Standard combo not found" });
      return;
    }

    let onsite = String(row.standard_onsite ?? "");
    let cologno = String(row.standard_cologno ?? "");
    let facilities = normalizeOptionalText(row.facilities as string | null);
    let studio = normalizeOptionalText(row.studio as string | null);
    let notes = normalizeNotes(row.notes as string | null);

    if (body.standardOnsite !== undefined) {
      const t = String(body.standardOnsite).trim();
      if (!t) {
        res.status(400).json({ error: "standardOnsite cannot be empty" });
        return;
      }
      onsite = t;
    }
    if (body.standardCologno !== undefined) {
      const t = String(body.standardCologno).trim();
      if (!t) {
        res.status(400).json({ error: "standardCologno cannot be empty" });
        return;
      }
      cologno = t;
    }
    if (body.facilities !== undefined) {
      facilities = normalizeOptionalText(body.facilities);
    }
    if (body.studio !== undefined) {
      studio = normalizeOptionalText(body.studio);
    }
    if (body.notes !== undefined) {
      notes = normalizeNotes(body.notes);
    }

    await client.query("BEGIN");

    await client.query(
      `UPDATE standard_combos
       SET standard_onsite = $1, standard_cologno = $2, facilities = $3, studio = $4, notes = $5
       WHERE id = $6`,
      [onsite, cologno, facilities, studio, notes, id]
    );

    if (body.requirements !== undefined) {
      const lines = Array.isArray(body.requirements) ? body.requirements : [];
      await client.query(
        "DELETE FROM standard_requirements WHERE standard_combo_id = $1",
        [id]
      );
      await insertComboRequirements(
        client,
        id,
        { standardOnsite: onsite, standardCologno: cologno, facilities, studio },
        lines
      );
    } else {
      await client.query(
        `UPDATE standard_requirements
         SET standard_onsite = $1, standard_cologno = $2, facilities = $3, studio = $4
         WHERE standard_combo_id = $5`,
        [onsite, cologno, facilities, studio, id]
      );
    }

    await client.query("COMMIT");

    const full = await loadComboWithRequirements(id);
    if (!full) {
      res.status(404).json({ error: "Standard combo not found" });
      return;
    }
    res.json(full);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("PATCH /api/standard-combos/:id error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  } finally {
    client.release();
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageEdit(req, res, "database"))) return;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid combo id" });
      return;
    }
    const del = await pool.query(
      "DELETE FROM standard_combos WHERE id = $1 RETURNING id",
      [id]
    );
    if (del.rowCount === 0) {
      res.status(404).json({ error: "Standard combo not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/standard-combos/:id error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
