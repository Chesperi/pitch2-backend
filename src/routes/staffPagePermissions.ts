import { Router, Request, Response } from "express";
import { pool } from "../db";
import {
  requirePageEdit,
  requirePageRead,
} from "../middleware/requirePageAccess";
import type { StaffId } from "../types/staffId";
import { isStaffId, normalizeStaffId } from "../types/staffId";

const router = Router();

export const PAGE_KEYS = [
  "le_mie_assegnazioni",
  "eventi",
  "designazioni",
  "accrediti",
  "call_sheet",
  "database",
  "cookies_jar",
  "consuntivo",
  "cronologia",
  "master",
] as const;

export type PageKey = (typeof PAGE_KEYS)[number];

export type AccessLevel = "none" | "view" | "edit";

export type StaffPermissionsRow = {
  staffId: StaffId;
  name: string;
  email: string;
  permissions: {
    pageKey: string;
    accessLevel: AccessLevel;
  }[];
};

function isPageKey(s: string): s is PageKey {
  return (PAGE_KEYS as readonly string[]).includes(s);
}

function isAccessLevel(s: string): s is AccessLevel {
  return s === "none" || s === "view" || s === "edit";
}

type PatchBody = {
  staffId?: unknown;
  pageKey?: unknown;
  accessLevel?: unknown;
};

router.get("/", async (_req: Request, res: Response) => {
  try {
    if (!(await requirePageRead(_req, res, "master"))) return;
    const staffResult = await pool.query<{
      id: string;
      surname: string;
      name: string;
      email: string | null;
    }>(
      `SELECT id, surname, name, email
       FROM staff
       WHERE active = true
       ORDER BY surname ASC, name ASC, id ASC`
    );

    const staffRows = staffResult.rows;
    if (staffRows.length === 0) {
      res.json({ items: [] as StaffPermissionsRow[] });
      return;
    }

    const ids = staffRows.map((s) => normalizeStaffId(String(s.id)));
    const permResult = await pool.query<{
      staff_id: string;
      page_key: string;
      access_level: string;
    }>(
      `SELECT staff_id, page_key, access_level
       FROM staff_page_permissions
       WHERE staff_id = ANY($1::uuid[])`,
      [ids]
    );

    const permMap = new Map<string, Map<string, AccessLevel>>();
    for (const r of permResult.rows) {
      if (!isAccessLevel(r.access_level)) continue;
      if (!isPageKey(r.page_key)) continue;
      const sid = normalizeStaffId(String(r.staff_id));
      let m = permMap.get(sid);
      if (!m) {
        m = new Map();
        permMap.set(sid, m);
      }
      m.set(r.page_key, r.access_level);
    }

    const items: StaffPermissionsRow[] = staffRows.map((s) => {
      const sid = normalizeStaffId(String(s.id));
      const byPage = permMap.get(sid) ?? new Map();
      const permissions = PAGE_KEYS.map((pageKey) => ({
        pageKey,
        accessLevel: (byPage.get(pageKey) ?? "none") as AccessLevel,
      }));
      const fullName = `${s.surname} ${s.name}`.trim();
      return {
        staffId: sid as StaffId,
        name: fullName,
        email: s.email ?? "",
        permissions,
      };
    });

    res.json({ items });
  } catch (err) {
    console.error("GET /api/staff-page-permissions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageEdit(req, res, "master"))) return;
    const body = req.body as PatchBody;
    const staffIdRaw = body.staffId;
    const pageKeyRaw = body.pageKey;
    const accessLevelRaw = body.accessLevel;

    const staffIdStr =
      typeof staffIdRaw === "string"
        ? staffIdRaw.trim()
        : String(staffIdRaw ?? "").trim();
    if (!isStaffId(staffIdStr)) {
      res.status(400).json({ error: "staffId must be a staff UUID" });
      return;
    }
    const staffId = normalizeStaffId(staffIdStr);

    const pageKey =
      typeof pageKeyRaw === "string" ? pageKeyRaw.trim() : "";
    if (!pageKey || !isPageKey(pageKey)) {
      res.status(400).json({
        error: `pageKey must be one of: ${PAGE_KEYS.join(", ")}`,
      });
      return;
    }

    const accessLevel =
      typeof accessLevelRaw === "string"
        ? accessLevelRaw.trim().toLowerCase()
        : "";
    if (!isAccessLevel(accessLevel)) {
      res.status(400).json({
        error: 'accessLevel must be "none", "view", or "edit"',
      });
      return;
    }

    const staffCheck = await pool.query("SELECT 1 FROM staff WHERE id = $1", [
      staffId,
    ]);
    if (staffCheck.rowCount === 0) {
      res.status(404).json({ error: "Staff not found" });
      return;
    }

    if (accessLevel === "none") {
      await pool.query(
        `DELETE FROM staff_page_permissions
         WHERE staff_id = $1 AND page_key = $2`,
        [staffId, pageKey]
      );
    } else {
      await pool.query(
        `INSERT INTO staff_page_permissions (staff_id, page_key, access_level)
         VALUES ($1, $2, $3)
         ON CONFLICT (staff_id, page_key)
         DO UPDATE SET
           access_level = EXCLUDED.access_level,
           updated_at = now()`,
        [staffId, pageKey, accessLevel]
      );
    }

    res.status(204).end();
  } catch (err) {
    console.error("PATCH /api/staff-page-permissions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
