import { Router, Request, Response } from "express";
import { getCurrentSession } from "../auth/session";
import { getPageAccessLevel } from "../services/pagePermissions";
import { PAGE_KEYS } from "./staffPagePermissions";

const router = Router();

export type MePermissionsResponse = {
  staffId: number;
  pagePermissions: {
    pageKey: string;
    accessLevel: "none" | "view" | "edit";
  }[];
};

/**
 * GET /api/me/permissions — permessi pagina per lo staff della sessione corrente.
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const session = getCurrentSession(req);
    if (!session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const pagePermissions = await Promise.all(
      PAGE_KEYS.map(async (pageKey) => ({
        pageKey,
        accessLevel: await getPageAccessLevel(session.staffId, pageKey),
      }))
    );

    const body: MePermissionsResponse = {
      staffId: session.staffId,
      pagePermissions,
    };

    res.json(body);
  } catch (err) {
    console.error("GET /api/me/permissions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
