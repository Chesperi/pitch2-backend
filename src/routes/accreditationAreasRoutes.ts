import { Router, Request, Response } from "express";
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
