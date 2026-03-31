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

function combineEventDateTime(date: unknown, koTime: unknown): string | null {
  const d = date != null ? String(date).slice(0, 10) : "";
  const t = koTime != null ? String(koTime).trim() : "";
  if (!d && !t) return null;
  if (d && t) return `${d}T${t}`;
  return d || t || null;
}

router.get("/:eventId/export-meta", async (req: Request, res: Response) => {
  const eventId = String(req.params.eventId ?? "").trim();
  if (!eventId) {
    res.status(400).json({ error: "Invalid eventId" });
    return;
  }

  try {
    const ev = await pool.query<{
      id: string;
      date: unknown;
      ko_italy_time: unknown;
      home_team_name_short: string | null;
      away_team_name_short: string | null;
      facilities: string | null;
      competition_name: string | null;
    }>(
      `SELECT id, date, ko_italy_time, home_team_name_short, away_team_name_short, facilities, competition_name
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
      koItaly: koItalyToIso(combineEventDateTime(row.date, row.ko_italy_time)),
      homeTeam: row.home_team_name_short,
      awayTeam: row.away_team_name_short,
      stadiumName: row.facilities,
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
