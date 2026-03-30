import { Router, Request, Response } from "express";
import { pool } from "../db";

const router = Router();

router.get("/search", async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string | undefined)?.trim() ?? "";
    if (!q) {
      res.json([]);
      return;
    }

    const sql = `
      SELECT
        id,
        surname,
        name,
        company,
        default_role_code,
        default_location,
        plates,
        notes
      FROM staff
      WHERE active = true
        AND (
          lower(surname) LIKE lower($1)
          OR lower(name) LIKE lower($1)
        )
      ORDER BY surname ASC, name ASC
      LIMIT 20
    `;
    const like = `%${q}%`;
    const result = await pool.query<{
      id: number;
      surname: string;
      name: string;
      company: string | null;
      default_role_code: string | null;
      default_location: string | null;
      plates: string | null;
      notes: string | null;
    }>(sql, [like]);

    const items = result.rows.map((row) => ({
      id: row.id,
      surname: row.surname,
      name: row.name,
      company: row.company,
      defaultRoleCode: row.default_role_code,
      defaultLocation: row.default_location,
      plates: row.plates,
      notes: row.notes,
    }));

    res.json(items);
  } catch (err) {
    console.error("GET /api/staff/search error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
