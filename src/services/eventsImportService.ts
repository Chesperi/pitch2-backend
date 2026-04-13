import { pool } from "../db";
import type { AppliedRuleFields, ImportPreviewItem } from "../types";
import { applyRulesToEvent } from "./eventRulesService";

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

/**
 * Costruisce una stringa datetime con offset Europe/Rome (stesso stile di `utcDateToKoItalyIso`)
 * da data calendario italiana DD/MM/YYYY e orario HH:MM.
 */
export function composeKoItalyFromParts(
  dataDdMmYyyy: string,
  orarioHhMm: string
): string {
  const [dd, mm, yyyy] = dataDdMmYyyy.split("/").map((x) => parseInt(x.trim(), 10));
  const timeNorm = orarioHhMm.replace(",", ":");
  const [hh, mi] = timeNorm.split(":").map((x) => parseInt(x.trim(), 10));
  if (![dd, mm, yyyy, hh, mi].every((n) => Number.isFinite(n))) {
    return "";
  }

  const matchesRomeWall = (utcMs: number): boolean => {
    const wall = new Intl.DateTimeFormat("sv-SE", {
      timeZone: ROME_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(utcMs));
    const [datePart, timePart] = wall.split(" ");
    if (!datePart || !timePart) return false;
    const [y, mo, da] = datePart.split("-").map((x) => parseInt(x, 10));
    const [hStr, miStr] = timePart.split(":").map((x) => parseInt(x, 10));
    return y === yyyy && mo === mm && da === dd && hStr === hh && miStr === mi;
  };

  const start = Date.UTC(yyyy, mm - 1, dd, 0, 0, 0) - 18 * 3600000;
  const end = Date.UTC(yyyy, mm - 1, dd, 23, 59, 59) + 18 * 3600000;
  for (let utcMs = start; utcMs <= end; utcMs += 60000) {
    if (!matchesRomeWall(utcMs)) continue;
    const d = new Date(utcMs);
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
    const offParts = new Intl.DateTimeFormat("en-US", {
      timeZone: ROME_TZ,
      timeZoneName: "longOffset",
    }).formatToParts(d);
    const tzRaw =
      offParts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
    const suffix = tzRaw.startsWith("GMT") ? tzRaw.slice(3) : "+00:00";
    const [datePart, timePart] = wall.split(" ");
    return `${datePart}T${timePart}${suffix}`;
  }
  return "";
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
  externalMatchId: string
): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM events
     WHERE external_match_id = $1
     LIMIT 1`,
    [String(externalMatchId)]
  );
  return (r.rowCount ?? 0) > 0;
}

async function zonaEventExistsAtSlot(
  showName: string,
  date: string,
  koItalyTime: string
): Promise<boolean> {
  const t = koItalyTime.length >= 5 ? koItalyTime.slice(0, 5) : koItalyTime;
  const r = await pool.query(
    `SELECT 1 FROM events
     WHERE TRIM(show_name) = $1
       AND date = $2::date
       AND ko_italy_time = $3::time
     LIMIT 1`,
    [showName.trim(), date, `${t}:00`]
  );
  return (r.rowCount ?? 0) > 0;
}

async function insertZonaStudioEvent(params: {
  id: string;
  competitionName: "Serie A" | "Serie B";
  showName: string;
  matchday: number;
  date: string;
  koItalyTime: string;
  rules: AppliedRuleFields;
  preDuration: number;
}): Promise<boolean> {
  if (
    await zonaEventExistsAtSlot(params.showName, params.date, params.koItalyTime)
  ) {
    return false;
  }

  const fixed: Record<string, unknown> = {
    standard_onsite: "WORLD FEED",
    standard_cologno: "GALLERY",
    facilities: "GALLERY03",
    show_name: params.showName,
    pre_duration_minutes: params.preDuration,
    rights_holder: "DAZN",
    studio: null as string | null,
    standard_combo_id: null as number | null,
  };

  const rules = params.rules;
  for (const k of Object.keys(rules) as (keyof AppliedRuleFields)[]) {
    if (k === "is_top_match") continue;
    const rv = rules[k];
    if (rv == null || rv === "") continue;
    const cv = fixed[k];
    if (cv == null || cv === "") {
      fixed[k] = rv;
    }
  }

  try {
    await pool.query(
      `INSERT INTO events (
        id, category, date, status, competition_name, external_match_id,
        matchday, day, ko_italy_time, pre_duration_minutes,
        home_team_name_short, away_team_name_short, venue_name,
        standard_onsite, standard_cologno, facilities, studio, show_name,
        standard_combo_id, rights_holder, client, format_name, episode,
        name_episode, start_time, notes, is_top_match
      ) VALUES (
        $1, $2, $3, $4, $5, NULL, $6, NULL, $7, $8,
        NULL, NULL, NULL,
        $9, $10, $11, $12, $13, $14, $15, NULL, NULL, NULL,
        NULL, NULL, NULL, false
      )`,
      [
        params.id,
        "STUDIO SHOW",
        params.date,
        "TBC",
        params.competitionName,
        params.matchday,
        params.koItalyTime,
        Number(fixed.pre_duration_minutes ?? 0),
        fixed.standard_onsite,
        fixed.standard_cologno,
        fixed.facilities,
        fixed.studio,
        fixed.show_name,
        fixed.standard_combo_id,
        fixed.rights_holder,
      ]
    );
    return true;
  } catch (e) {
    console.error("insertZonaStudioEvent", e);
    return false;
  }
}

/**
 * Dopo import match: crea eventi STUDIO SHOW "Zona Serie A/B" per slot con 2+ partite
 * stesso ko_italy e stessa competition (Serie A o B).
 */
export async function generateZonaEvents(
  items: ImportPreviewItem[],
  confirmedKos: string[]
): Promise<number> {
  const koSet = new Set(confirmedKos);
  const scoped = items.filter((i) => koSet.has(i.ko_italy));
  const groups = new Map<string, ImportPreviewItem[]>();
  for (const item of scoped) {
    const key = `${item.ko_italy}\0${item.competition_name.trim()}`;
    const arr = groups.get(key) ?? [];
    arr.push(item);
    groups.set(key, arr);
  }

  let created = 0;
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    const comp = group[0].competition_name.trim();
    if (comp !== "Serie A" && comp !== "Serie B") continue;

    const koIt = group[0].ko_italy;
    const rules = await applyRulesToEvent({
      competition_name: comp,
      ko_italy: koIt,
    });
    const { date: dateStr, koItalyTime } = splitKoItalyForDb(koIt);
    if (!dateStr || !koItalyTime) continue;

    const isA = comp === "Serie A";
    const showName = isA ? "Zona Serie A" : "Zona Serie B";
    const pre = isA ? 14 : 5;
    const idPart = `${dateStr}-${koItalyTime.replace(/:/g, "-")}`;
    const id = isA ? `zona-seriea-${idPart}` : `zona-serieb-${idPart}`;
    const matchday = group[0].matchday ?? 0;

    const ok = await insertZonaStudioEvent({
      id,
      competitionName: comp,
      showName,
      matchday,
      date: dateStr,
      koItalyTime,
      rules,
      preDuration: pre,
    });
    if (ok) created++;
  }

  return created;
}

export async function insertEventFromImportItem(
  item: ImportPreviewItem
): Promise<void> {
  const query = `
  INSERT INTO events (
    id, category, date, status, competition_name, external_match_id,
    matchday, day, ko_italy_time, pre_duration_minutes,
    home_team_name_short, away_team_name_short, venue_name,
    standard_onsite, standard_cologno, facilities, studio, show_name,
    standard_combo_id, rights_holder, client, format_name, episode,
    name_episode, start_time, notes, is_top_match
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
    $21, $22, $23, $24, $25, $26, $27
  )
`;

  const sf = item.suggested_fields ?? {};
  const { date: dateStr, koItalyTime } = splitKoItalyForDb(item.ko_italy);
  const extId = String(item.external_match_id);
  const matchday = item.matchday ?? null;
  const pre = sf.pre_duration_minutes ?? null;
  const id = `import-${extId}`;

  const values = [
    id, // $1  id
    "MATCH", // $2  category
    dateStr, // $3  date
    "TBC", // $4  status
    item.competition_name, // $5  competition_name
    extId, // $6  external_match_id
    matchday, // $7  matchday
    null, // $8  day
    koItalyTime, // $9  ko_italy_time
    pre, // $10 pre_duration_minutes
    item.home_team, // $11 home_team_name_short
    item.away_team, // $12 away_team_name_short
    item.venue ?? null, // $13 venue_name
    sf.standard_onsite ?? null, // $14 standard_onsite
    sf.standard_cologno ?? null, // $15 standard_cologno
    sf.facilities ?? null, // $16 facilities
    sf.studio ?? null, // $17 studio
    sf.show_name ?? null, // $18 show_name
    sf.standard_combo_id ?? null, // $19 standard_combo_id
    item.rights_holder ?? sf.rights_holder ?? null, // $20 rights_holder
    null, // $21 client
    null, // $22 format_name
    null, // $23 episode
    null, // $24 name_episode
    null, // $25 start_time
    null, // $26 notes
    Boolean(sf.is_top_match ?? false), // $27 is_top_match
  ];

  await pool.query(query, values);
}
