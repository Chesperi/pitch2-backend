import { Router, Request, Response } from "express";
import { pool } from "../db";
import {
  getAccreditationAreasByOwner,
  type AccreditationAreaLegend,
  type AccreditationAreaMapping,
} from "../services/accreditationAreasService";

export type GetAccreditationAreasResponse = {
  ownerCode: string;
  mappings: AccreditationAreaMapping[];
  legends: AccreditationAreaLegend[];
};

const router = Router();

router.patch("/:ownerCode/:roleCode", async (req: Request, res: Response) => {
  const ownerCode = String(req.params.ownerCode ?? "").trim().toLowerCase();
  const roleCode = String(req.params.roleCode ?? "").trim().toUpperCase();
  const areasRaw = req.body?.areas;
  const areas = typeof areasRaw === "string" ? areasRaw.trim() : "";

  if (!ownerCode) {
    res.status(400).json({ error: "ownerCode is required" });
    return;
  }
  if (!roleCode) {
    res.status(400).json({ error: "roleCode is required" });
    return;
  }
  if (!areas) {
    res.status(400).json({ error: "areas is required" });
    return;
  }

  try {
    const result = await pool.query<{
      id: number;
      owner_code: string;
      role_code: string;
      areas: string;
    }>(
      `UPDATE accreditation_areas
       SET areas = $1
       WHERE lower(owner_code) = $2
         AND upper(role_code) = $3
       RETURNING id, owner_code, role_code, areas`,
      [areas, ownerCode, roleCode]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: "Accreditation area mapping not found" });
      return;
    }

    const row = result.rows[0];
    res.json({
      id: row.id,
      ownerCode: row.owner_code,
      roleCode: row.role_code,
      areas: row.areas,
    });
  } catch (err) {
    console.error(
      "PATCH /api/accreditation-areas/:ownerCode/:roleCode error:",
      err
    );
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:ownerCode", async (req: Request, res: Response) => {
  const raw = req.params.ownerCode;
  const ownerCode = raw != null ? String(raw).trim() : "";
  if (!ownerCode) {
    res.status(400).json({ error: "ownerCode is required" });
    return;
  }

  try {
    const { mappings, legends } = await getAccreditationAreasByOwner(ownerCode);
    const body: GetAccreditationAreasResponse = {
      ownerCode: ownerCode.toLowerCase(),
      mappings,
      legends,
    };
    res.json(body);
  } catch (err) {
    console.error("GET /api/accreditation-areas/:ownerCode error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
