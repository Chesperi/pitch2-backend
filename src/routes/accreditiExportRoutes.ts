import { Router, Request, Response } from "express";
import { pool } from "../db";
import { listAccreditationsByEventId } from "../services/accreditationsService";
import {
  deriveAccreditationOwnerCodeFromHomeTeam,
  getAccreditationAreasByOwner,
} from "../services/accreditationAreasService";
import type {
  AccreditationExportEventMeta,
  AccreditationExportStaffRow,
  GetAccreditiExportMetaResponse,
} from "../types";

const router = Router();

function koItalyToIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

router.get("/:eventId/export-meta", async (req: Request, res: Response) => {
  const eventId = Number.parseInt(req.params.eventId, 10);
  if (!Number.isFinite(eventId) || eventId < 1) {
    res.status(400).json({ error: "Invalid eventId" });
    return;
  }

  try {
    const ev = await pool.query<{
      id: number;
      ko_italy: unknown;
      home_team_name_short: string | null;
      away_team_name_short: string | null;
      venue_name: string | null;
      competition_name: string | null;
    }>(
      `SELECT id, ko_italy, home_team_name_short, away_team_name_short, venue_name, competition_name
       FROM events
       WHERE id = $1`,
      [eventId]
    );

    if (ev.rows.length === 0) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const row = ev.rows[0];
    const ownerCode = deriveAccreditationOwnerCodeFromHomeTeam(
      row.home_team_name_short
    );

    const accreditations = await listAccreditationsByEventId(eventId);
    const staffRows: AccreditationExportStaffRow[] = accreditations.map((a) => ({
      accreditationId: a.id,
      company: a.staffCompany,
      surname: a.staffSurname,
      name: a.staffName,
      placeOfBirth: a.staffPlaceOfBirth,
      dateOfBirth: a.staffDateOfBirth,
      areas: a.areas,
      roleCode: a.roleCode ?? a.staffDefaultRoleCode ?? null,
      plates: a.plates ?? a.staffPlates ?? null,
      notes: a.notes ?? a.staffNotes ?? null,
    }));

    const { mappings, legends } = await getAccreditationAreasByOwner(ownerCode);

    const event: AccreditationExportEventMeta = {
      eventId: row.id,
      koItaly: koItalyToIso(row.ko_italy),
      homeTeam: row.home_team_name_short,
      awayTeam: row.away_team_name_short,
      stadiumName: row.venue_name,
      competitionName: row.competition_name,
      ownerCode,
    };

    const body: GetAccreditiExportMetaResponse = {
      event,
      staff: staffRows,
      areaMappings: mappings,
      areaLegends: legends,
    };

    res.json(body);
  } catch (err) {
    console.error("GET /api/accrediti/:eventId/export-meta error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
