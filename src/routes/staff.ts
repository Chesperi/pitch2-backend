import { Router, Request } from "express";
import { pool } from "../db";
import type { AssignmentWithEvent, AssignmentStatus } from "../types";

const router = Router();

export type StaffItem = {
  id: number;
  surname: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  default_role_code: string | null;
  default_location: string | null;
  fee: number | null;
  plates: string | null;
  user_level: string;
  active: boolean;
};

router.get("/", async (req: Request, res) => {
  try {
    const q = (req.query.q as string)?.trim() || "";
    const role_code = (req.query.role_code as string)?.trim() || "";
    const location = (req.query.location as string)?.trim() || "";
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
      `SELECT id, surname, name, email, phone, company, default_role_code,
              default_location, fee, plates, user_level, active
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

router.get("/:id/assignments", async (req: Request, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
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

    // Freelance view: only assignments the designatore has sent (SENT, CONFIRMED, REJECTED)
    const conditions: string[] = [
      "a.staff_id = $1",
      "a.status IN ('SENT', 'CONFIRMED', 'REJECTED')",
    ];
    const params: unknown[] = [id];
    let paramIdx = 2;

    if (status) {
      conditions.push(`a.status = $${paramIdx}`);
      params.push(status);
      paramIdx++;
    }
    if (from) {
      conditions.push(`e.ko_italy >= $${paramIdx}::timestamptz`);
      params.push(from);
      paramIdx++;
    }
    if (to) {
      conditions.push(`e.ko_italy <= $${paramIdx}::timestamptz`);
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
      `SELECT a.id, a.event_id, a.role_id, a.staff_id, a.status, a.notes, a.created_at, a.updated_at,
              e.id as e_id, e.external_match_id as e_external_match_id, e.category, e.competition_name,
              e.competition_code, e.matchday, e.home_team_name_short, e.away_team_name_short,
              e.venue_name, e.venue_city, e.venue_address, e.ko_italy, e.pre_duration_minutes,
              e.standard_onsite, e.standard_cologno, e.location as e_area_produzione,
              e.show_name, e.status as e_status
       FROM assignments a
       JOIN events e ON e.id = a.event_id
       ${whereClause}
       ORDER BY e.ko_italy ASC NULLS LAST, a.id ASC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    const items: AssignmentWithEvent[] = itemsResult.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        assignment: {
          id: r.id as number,
          eventId: r.event_id as number,
          roleId: r.role_id as number,
          staffId: r.staff_id as number | null,
          status: r.status as AssignmentStatus,
          notes: r.notes as string | null,
          createdAt: String(r.created_at),
          updatedAt: String(r.updated_at),
        },
        event: {
          id: r.e_id as number,
          externalMatchId: r.e_external_match_id != null ? String(r.e_external_match_id) : null,
          category: r.category as string,
          competitionName: r.competition_name as string,
          competitionCode: r.competition_code as string | null,
          matchday: r.matchday as number | null,
          homeTeamNameShort: r.home_team_name_short as string | null,
          awayTeamNameShort: r.away_team_name_short as string | null,
          venueName: r.venue_name as string | null,
          venueCity: r.venue_city as string | null,
          venueAddress: r.venue_address as string | null,
          koItaly: r.ko_italy != null ? String(r.ko_italy) : null,
          preDurationMinutes: r.pre_duration_minutes as number,
          standardOnsite: r.standard_onsite as string | null,
          standardCologno: r.standard_cologno as string | null,
          areaProduzione: r.e_area_produzione as string | null,
          showName: r.show_name as string | null,
          status: r.e_status as string,
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

export default router;
