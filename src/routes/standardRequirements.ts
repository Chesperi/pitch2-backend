import { Router, Request } from "express";
import { pool } from "../db";
import type { StandardRequirementWithRole } from "../types";

const router = Router();

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

// GET /api/standard-requirements
// Con filtri: standardOnsite, standardCologno (obbligatori per filtro), site (opzionale)
// Senza filtri: restituisce tutti (per pagina Database), con paginazione
router.get("/", async (req: Request, res) => {
  try {
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

export default router;
