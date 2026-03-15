import { Router, Request } from "express";
import { pool } from "../db";

const router = Router();

export type EventItem = {
  id: number;
  category: string;
  competition_name: string;
  competition_code: string | null;
  matchday: number | null;
  home_team_name_short: string | null;
  away_team_name_short: string | null;
  venue_name: string | null;
  ko_italy: string | null;
  pre_duration_minutes: number;
  standard_onsite: string | null;
  standard_cologno: string | null;
  location: string | null;
  show_name: string | null;
  status: string;
};

router.get("/", async (req: Request, res) => {
  try {
    const q = (req.query.q as string)?.trim() || "";
    const category = (req.query.category as string)?.trim() || "";
    const status = (req.query.status as string)?.trim() || "";
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
        `(home_team_name_short ILIKE $${paramIdx} OR away_team_name_short ILIKE $${paramIdx}
          OR competition_name ILIKE $${paramIdx} OR show_name ILIKE $${paramIdx})`
      );
      params.push(`%${q}%`);
      paramIdx++;
    }
    if (category) {
      conditions.push(`category = $${paramIdx}`);
      params.push(category);
      paramIdx++;
    }
    if (status) {
      conditions.push(`status = $${paramIdx}`);
      params.push(status);
      paramIdx++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::int as count FROM events ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

    params.push(limit, offset);
    const itemsResult = await pool.query<EventItem>(
      `SELECT id, category, competition_name, competition_code, matchday,
              home_team_name_short, away_team_name_short, venue_name, ko_italy,
              pre_duration_minutes, standard_onsite, standard_cologno,
              location, show_name, status
       FROM events
       ${whereClause}
       ORDER BY ko_italy ASC NULLS LAST, id ASC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    res.json({ items: itemsResult.rows, total });
  } catch (err) {
    console.error("GET /api/events error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
