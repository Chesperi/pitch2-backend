import { randomUUID } from "crypto";
import { pool } from "../db";
import type { ImportPreviewItem } from "../types";

const ROME_TZ = "Europe/Rome";

/** Data (YYYY-MM-DD) e ora KO locale Italia per colonne `date` / `ko_italy_time`. */
export function splitKoItalyForDb(koItalyIso: string): {
  date: string | null;
  koItalyTime: string | null;
} {
  const d = new Date(koItalyIso);
  if (Number.isNaN(d.getTime())) {
    return { date: null, koItalyTime: null };
  }
  const wall = new Intl.DateTimeFormat("sv-SE", {
    timeZone: ROME_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
  const [datePart, timePart] = wall.split(" ");
  if (!datePart || !timePart) {
    return { date: null, koItalyTime: null };
  }
  return {
    date: datePart,
    koItalyTime: timePart.length >= 5 ? timePart.slice(0, 5) : timePart,
  };
}

export async function listExternalMatchIdsForCompetition(
  competitionName: string
): Promise<string[]> {
  const name = competitionName.trim();
  const result = await pool.query<{ ext: string }>(
    `SELECT external_match_id::text AS ext
     FROM events
     WHERE competition_name IS NOT NULL
       AND UPPER(TRIM(competition_name)) = UPPER(TRIM($1))
       AND external_match_id IS NOT NULL`,
    [name]
  );
  return result.rows.map((r) => r.ext);
}

export async function eventExistsByExternalMatch(
  externalMatchId: number
): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM events
     WHERE external_match_id = $1
     LIMIT 1`,
    [externalMatchId]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function insertEventFromImportItem(
  item: ImportPreviewItem
): Promise<void> {
  const extId = parseInt(item.external_match_id, 10);
  if (!Number.isFinite(extId)) {
    throw new Error("external_match_id non valido");
  }

  const { date, koItalyTime } = splitKoItalyForDb(item.ko_italy);
  const sf = item.suggested_fields ?? {};
  const pre =
    sf.pre_duration_minutes != null &&
    !Number.isNaN(Number(sf.pre_duration_minutes))
      ? Number(sf.pre_duration_minutes)
      : 0;

  const matchday =
    item.matchday != null && item.matchday > 0 ? item.matchday : null;

  const id = randomUUID();

  await pool.query(
    `INSERT INTO events (
      id, category, date, status, competition_name, external_match_id,
      matchday, day, ko_italy_time, pre_duration_minutes,
      home_team_name_short, away_team_name_short, venue_name,
      standard_onsite, standard_cologno, facilities, studio, show_name,
      standard_combo_id, rights_holder, client, format_name, episode, name_episode, start_time, notes
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27
    )`,
    [
      id,
      "MATCH",
      date,
      "TBC",
      item.competition_name,
      extId,
      matchday,
      null,
      koItalyTime,
      pre,
      item.home_team,
      item.away_team,
      item.venue,
      sf.standard_onsite ?? null,
      sf.standard_cologno ?? null,
      sf.facilities ?? null,
      sf.studio ?? null,
      sf.show_name ?? null,
      sf.standard_combo_id ?? null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]
  );
}
