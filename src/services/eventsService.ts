import { randomUUID } from "crypto";
import { pool } from "../db";
import type {
  Event,
  AssignmentWithJoins,
  AssignmentStatus,
  EventAssignmentsStatus,
  EventListFilters,
  EventListPagination,
  EventCreatePayload,
  EventUpdatePayload,
} from "../types";
import { ensureAssignmentsForEvent } from "./assignmentsGenerator";

const EVENT_COLUMNS = [
  "id",
  "category",
  "date",
  "status",
  "standard_combo_id",
  "competition_name",
  "matchday",
  "day",
  "ko_italy_time",
  "venue_name",
  "venue_address",
  "venue_city",
  "pre_duration_minutes",
  "home_team_name_short",
  "away_team_name_short",
  "rights_holder",
  "standard_onsite",
  "standard_cologno",
  "facilities",
  "studio",
  "show_name",
  "client",
  "format_name",
  "episode",
  "name_episode",
  "start_time",
  "notes",
  "is_top_match",
].join(", ");

export const EVENT_STATUS_ALLOWED = [
  "TBC",
  "TBD",
  "OK",
  "CONFIRMED",
  "CANCELLED",
] as const;

export type AllowedEventStatus = (typeof EVENT_STATUS_ALLOWED)[number];

export function normalizeEventStatusInput(value: string): AllowedEventStatus | null {
  const upper = String(value ?? "").trim().toUpperCase();
  if (!upper) return null;
  const normalized = upper === "CANCELED" ? "CANCELLED" : upper;
  return (EVENT_STATUS_ALLOWED as readonly string[]).includes(normalized)
    ? (normalized as AllowedEventStatus)
    : null;
}

function combineKoDisplay(date: string | null, time: string | null): string | null {
  if (!date && !time) return null;
  const d = (date ?? "").trim();
  const t = (time ?? "").trim();
  if (d && t) return `${d}T${t}`;
  return d || t || null;
}

function toIsoDateOnly(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function normalizeTextOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export async function findMatchingComboId(
  onsite: string | null | undefined,
  cologno: string | null | undefined,
  facilities: string | null | undefined,
  studio: string | null | undefined
): Promise<number | null> {
  const onsiteNorm = normalizeTextOrNull(onsite);
  const colognoNorm = normalizeTextOrNull(cologno);
  const facilitiesNorm = normalizeTextOrNull(facilities);
  const studioNorm = normalizeTextOrNull(studio);

  if (!onsiteNorm || !colognoNorm) return null;

  const result = await pool.query<{ id: number }>(
    `SELECT id
     FROM standard_combos
     WHERE standard_onsite = $1
       AND standard_cologno = $2
       AND facilities = $3
       AND (
         ($4::text IS NULL AND (studio IS NULL OR studio = '-'))
         OR studio = $4::text
       )
     LIMIT 1`,
    [onsiteNorm, colognoNorm, facilitiesNorm, studioNorm]
  );

  return result.rows[0]?.id ?? null;
}

function mapRowToEvent(row: Record<string, unknown>): Event {
  return {
    id: String(row.id ?? ""),
    category: String(row.category ?? ""),
    date: toIsoDateOnly(row.date),
    status: row.status != null ? String(row.status) : null,
    standardComboId:
      row.standard_combo_id != null ? Number(row.standard_combo_id) : null,
    competitionName: String(row.competition_name ?? ""),
    matchday: row.matchday != null ? Number(row.matchday) : null,
    day: row.day != null ? String(row.day) : null,
    koItalyTime: row.ko_italy_time != null ? String(row.ko_italy_time) : null,
    venueName: row.venue_name != null ? String(row.venue_name) : null,
    venueAddress: row.venue_address != null ? String(row.venue_address) : null,
    venueCity: row.venue_city != null ? String(row.venue_city) : null,
    preDurationMinutes: Number(row.pre_duration_minutes ?? 0),
    homeTeamNameShort:
      row.home_team_name_short != null ? String(row.home_team_name_short) : null,
    awayTeamNameShort:
      row.away_team_name_short != null ? String(row.away_team_name_short) : null,
    rightsHolder: row.rights_holder != null ? String(row.rights_holder) : null,
    standardOnsite: row.standard_onsite != null ? String(row.standard_onsite) : null,
    standardCologno: row.standard_cologno != null ? String(row.standard_cologno) : null,
    facilities: row.facilities != null ? String(row.facilities) : null,
    studio: row.studio != null ? String(row.studio) : null,
    showName: row.show_name != null ? String(row.show_name) : null,
    client: row.client != null ? String(row.client) : null,
    formatName: row.format_name != null ? String(row.format_name) : null,
    episode: row.episode != null ? Number(row.episode) : null,
    nameEpisode: row.name_episode != null ? String(row.name_episode) : null,
    startTime: row.start_time != null ? String(row.start_time) : null,
    notes: row.notes != null ? String(row.notes) : null,
    isTopMatch: Boolean(row.is_top_match),
  };
}

/** Eventi con almeno uno slot assegnato in READY/SENT/CONFIRMED (lista Accrediti). */
export async function listEventsReadyForAccrediti(): Promise<
  Array<{
    event: Event;
    coveredAssignments: number;
    totalAssignments: number;
  }>
> {
  const eventSelect = EVENT_COLUMNS.split(", ")
    .map((c) => `e.${c}`)
    .join(", ");
  const result = await pool.query(
    `SELECT
       ${eventSelect},
       (SELECT COUNT(*)::int FROM assignments a
         WHERE a.event_id = e.id
           AND a.staff_id IS NOT NULL
           AND a.role_location = 'STADIO') AS covered_assignments,
       (SELECT COUNT(*)::int FROM assignments a
         WHERE a.event_id = e.id
           AND a.role_location = 'STADIO') AS total_assignments
     FROM events e
     WHERE EXISTS (
       SELECT 1 FROM assignments a
       WHERE a.event_id = e.id
         AND a.status IN ('READY', 'SENT', 'CONFIRMED')
         AND a.staff_id IS NOT NULL
     )
     ORDER BY e.date ASC NULLS LAST, e.ko_italy_time ASC NULLS LAST, e.id ASC`
  );
  return result.rows.map((row) => {
    const raw = row as Record<string, unknown>;
    const covered = Number(raw.covered_assignments ?? 0);
    const total = Number(raw.total_assignments ?? 0);
    const eventRow: Record<string, unknown> = { ...raw };
    delete eventRow.covered_assignments;
    delete eventRow.total_assignments;
    return {
      event: mapRowToEvent(eventRow),
      coveredAssignments: covered,
      totalAssignments: total,
    };
  });
}

/** Serializzazione REST: snake_case dove serve al client legacy. */
export function eventToApiJson(e: Event): Record<string, unknown> {
  return {
    id: e.id,
    category: e.category,
    date: e.date,
    status: e.status,
    standard_combo_id: e.standardComboId ?? null,
    standardComboId: e.standardComboId ?? null,
    competition_name: e.competitionName,
    competitionName: e.competitionName,
    matchday: e.matchday,
    day: e.day,
    ko_italy_time: e.koItalyTime,
    venue_name: e.venueName,
    venueName: e.venueName,
    venue_address: e.venueAddress,
    venueAddress: e.venueAddress,
    venue_city: e.venueCity,
    venueCity: e.venueCity,
    koItaly: combineKoDisplay(e.date, e.koItalyTime),
    pre_duration_minutes: e.preDurationMinutes,
    preDurationMinutes: e.preDurationMinutes,
    home_team_name_short: e.homeTeamNameShort,
    away_team_name_short: e.awayTeamNameShort,
    rights_holder: e.rightsHolder,
    standard_onsite: e.standardOnsite,
    standard_cologno: e.standardCologno,
    facilities: e.facilities,
    studio: e.studio,
    show_name: e.showName,
    client: e.client,
    format_name: e.formatName,
    episode: e.episode,
    name_episode: e.nameEpisode,
    start_time: e.startTime,
    notes: e.notes,
    is_top_match: e.isTopMatch,
    isTopMatch: e.isTopMatch,
  };
}

export async function getEventAssignmentsStatus(
  eventId: string
): Promise<EventAssignmentsStatus> {
  const result = await pool.query<{
    total_count: string;
    unassigned_count: string;
    ready_count: string;
    sent_count: string;
    confirmed_count: string;
  }>(
    `SELECT
       COUNT(*)::int AS total_count,
       SUM(CASE WHEN staff_id IS NULL THEN 1 ELSE 0 END)::int AS unassigned_count,
       SUM(CASE WHEN status = 'READY' THEN 1 ELSE 0 END)::int AS ready_count,
       SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END)::int AS sent_count,
       SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END)::int AS confirmed_count
     FROM assignments
     WHERE event_id = $1`,
    [eventId]
  );
  const row = result.rows[0];
  const total = Number(row?.total_count ?? 0);
  const unassigned = Number(row?.unassigned_count ?? 0);
  const ready = Number(row?.ready_count ?? 0);
  const sent = Number(row?.sent_count ?? 0);
  const confirmed = Number(row?.confirmed_count ?? 0);

  // Priorita assoluta: finche ci sono slot vuoti, evento in bozza.
  if (total === 0 || unassigned > 0) return "DRAFT";
  if (confirmed === total) return "CONFIRMED";
  if (sent === total) return "SENT";
  if (ready > 0) return "READY_TO_SEND";
  return "DRAFT";
}

function mapRowToAssignmentWithJoins(row: Record<string, unknown>): AssignmentWithJoins {
  const ko = combineKoDisplay(
    toIsoDateOnly(row.e_date),
    row.e_ko_italy_time != null ? String(row.e_ko_italy_time) : null
  );
  return {
    id: row.a_id as number,
    eventId: String(row.a_event_id ?? ""),
    roleCode: String(row.a_role_code ?? ""),
    roleLocation: String(row.a_role_location ?? ""),
    staffId: row.a_staff_id != null ? Number(row.a_staff_id) : null,
    status: row.a_status as AssignmentStatus,
    notes: row.a_notes as string | null,
    createdAt: String(row.a_created_at),
    updatedAt: String(row.a_updated_at),
    eventCategory: row.e_category as string,
    eventCompetitionName: row.e_competition_name as string,
    eventMatchDay: row.e_matchday as number | null,
    eventHomeTeamNameShort: row.e_home_team_name_short as string | null,
    eventAwayTeamNameShort: row.e_away_team_name_short as string | null,
    eventKoItaly: ko,
    eventStatus: String(row.e_status ?? ""),
    staffSurname: row.s_surname as string | null,
    staffName: row.s_name as string | null,
    staffEmail: row.s_email as string | null,
    staffPhone: row.s_phone as string | null,
    staffCompany: row.s_company as string | null,
    staffFee: row.s_fee != null ? String(row.s_fee) : null,
    staffPlates: row.s_plates as string | null,
    roleDescription: row.r_description != null ? String(row.r_description) : null,
  };
}

const DESIGNABLE_WHERE = `standard_onsite IS NOT NULL AND standard_onsite <> ''
  AND standard_cologno IS NOT NULL AND standard_cologno <> ''
  AND standard_combo_id IS NOT NULL
  AND status IN ('OK', 'CONFIRMED')`;

const ASSIGNMENT_EVENT_ROLE_SELECT = `
  a.id as a_id, a.event_id as a_event_id, a.role_code as a_role_code, a.staff_id as a_staff_id,
  a.status as a_status, a.notes as a_notes, a.created_at as a_created_at, a.updated_at as a_updated_at,
  e.category as e_category, e.competition_name as e_competition_name, e.matchday as e_matchday,
  e.date as e_date, e.ko_italy_time as e_ko_italy_time,
  e.home_team_name_short as e_home_team_name_short, e.away_team_name_short as e_away_team_name_short,
  e.status as e_status,
  s.surname as s_surname, s.name as s_name, s.email as s_email, s.phone as s_phone,
  s.company as s_company, s.fee as s_fee, s.plates as s_plates,
  r.role_code as r_role_code, r.description as r_description, r.location as r_location
`;

function buildListWhereClause(
  filters: EventListFilters
): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (filters.q?.trim()) {
    conditions.push(
      `(home_team_name_short ILIKE $${i} OR away_team_name_short ILIKE $${i}
        OR competition_name ILIKE $${i} OR show_name ILIKE $${i})`
    );
    params.push(`%${filters.q.trim()}%`);
    i++;
  }
  if (filters.category?.trim()) {
    conditions.push(`category = $${i}`);
    params.push(filters.category.trim());
    i++;
  }
  if (filters.competitionName?.trim()) {
    conditions.push(`competition_name ILIKE $${i}`);
    params.push(`%${filters.competitionName.trim()}%`);
    i++;
  }
  if (filters.matchday !== undefined && !Number.isNaN(filters.matchday)) {
    conditions.push(`matchday = $${i}`);
    params.push(filters.matchday);
    i++;
  }
  if (filters.status?.trim()) {
    conditions.push(`status = $${i}`);
    params.push(filters.status.trim());
    i++;
  }
  if (filters.dateFrom?.trim()) {
    conditions.push(`date >= $${i}::date`);
    params.push(filters.dateFrom.trim());
    i++;
  }
  if (filters.dateTo?.trim()) {
    conditions.push(`date <= $${i}::date`);
    params.push(filters.dateTo.trim());
    i++;
  }
  if (filters.onlyDesignable) {
    conditions.push(`(${DESIGNABLE_WHERE})`);
  }
  const assignmentsStatus = (filters as EventListFilters & { assignmentsStatus?: string })
    .assignmentsStatus;
  if (assignmentsStatus === "DRAFT") {
    conditions.push(
      `NOT EXISTS (SELECT 1 FROM assignments a WHERE a.event_id = events.id)
       OR EXISTS (SELECT 1 FROM assignments a WHERE a.event_id = events.id AND a.staff_id IS NULL)
       OR EXISTS (SELECT 1 FROM assignments a WHERE a.event_id = events.id AND a.status = 'DRAFT')`
    );
  } else if (assignmentsStatus === "READY_TO_SEND") {
    conditions.push(
      `EXISTS (SELECT 1 FROM assignments a WHERE a.event_id = events.id)
       AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.event_id = events.id AND a.staff_id IS NULL)
       AND EXISTS (SELECT 1 FROM assignments a WHERE a.event_id = events.id AND a.status = 'READY')`
    );
  } else if (assignmentsStatus === "SENT") {
    conditions.push(
      `EXISTS (SELECT 1 FROM assignments a WHERE a.event_id = events.id)
       AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.event_id = events.id AND a.staff_id IS NULL)
       AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.event_id = events.id AND a.status <> 'SENT')`
    );
  } else if (assignmentsStatus === "CONFIRMED") {
    conditions.push(
      `EXISTS (SELECT 1 FROM assignments a WHERE a.event_id = events.id)
       AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.event_id = events.id AND a.staff_id IS NULL)
       AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.event_id = events.id AND a.status <> 'CONFIRMED')`
    );
  }

  const clause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { clause, params };
}

export async function listEvents(
  filters: EventListFilters,
  pagination: EventListPagination
): Promise<{ items: Event[]; total: number }> {
  const { clause, params } = buildListWhereClause(filters);
  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::int as count FROM events ${clause}`,
    params
  );
  const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

  const limit = pagination.limit;
  const offset = pagination.offset;
  const dataParams = [...params, limit, offset];
  const limIdx = params.length + 1;
  const offIdx = params.length + 2;

  const itemsResult = await pool.query(
    `SELECT ${EVENT_COLUMNS}
     FROM events
     ${clause}
     ORDER BY date ASC NULLS LAST, ko_italy_time ASC NULLS LAST, id ASC
     LIMIT $${limIdx} OFFSET $${offIdx}`,
    dataParams
  );

  const items = itemsResult.rows.map((r) =>
    mapRowToEvent(r as Record<string, unknown>)
  );
  return { items, total };
}

export async function listDesignableEvents(
  pagination: EventListPagination
): Promise<{ items: Event[]; total: number }> {
  const where = `WHERE ${DESIGNABLE_WHERE}`;
  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::int as count FROM events ${where}`
  );
  const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

  const itemsResult = await pool.query(
    `SELECT ${EVENT_COLUMNS}
     FROM events
     ${where}
     ORDER BY date ASC NULLS LAST, ko_italy_time ASC NULLS LAST, id ASC
     LIMIT $1 OFFSET $2`,
    [pagination.limit, pagination.offset]
  );

  const items = itemsResult.rows.map((r) =>
    mapRowToEvent(r as Record<string, unknown>)
  );
  return { items, total };
}

export async function getEventById(id: string): Promise<Event | null> {
  const result = await pool.query(
    `SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return null;
  return mapRowToEvent(result.rows[0] as Record<string, unknown>);
}

export async function createEvent(payload: EventCreatePayload): Promise<Event> {
  const id = payload.id?.trim() || randomUUID();
  const explicitComboProvided = payload.standardComboId !== undefined;
  const matchedComboId = explicitComboProvided
    ? payload.standardComboId ?? null
    : await findMatchingComboId(
        payload.standardOnsite ?? null,
        payload.standardCologno ?? null,
        payload.facilities ?? null,
        payload.studio ?? null
      );

  const result = await pool.query(
    `INSERT INTO events (
      id, category, date, status, standard_combo_id, competition_name, matchday, day, ko_italy_time,
      venue_name, venue_address, venue_city,
      pre_duration_minutes, home_team_name_short, away_team_name_short, rights_holder,
      standard_onsite, standard_cologno, facilities, studio, show_name, client, format_name,
      episode, name_episode, start_time, notes, is_top_match
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28
    )
    RETURNING ${EVENT_COLUMNS}`,
    [
      id,
      payload.category,
      payload.date ?? null,
      payload.status ?? "TBD",
      matchedComboId,
      payload.competitionName,
      payload.matchday ?? null,
      payload.day ?? null,
      payload.koItalyTime ?? null,
      payload.venueName ?? null,
      payload.venueAddress ?? null,
      payload.venueCity ?? null,
      payload.preDurationMinutes ?? 0,
      payload.homeTeamNameShort ?? null,
      payload.awayTeamNameShort ?? null,
      payload.rightsHolder ?? null,
      payload.standardOnsite ?? null,
      payload.standardCologno ?? null,
      payload.facilities ?? null,
      payload.studio ?? null,
      payload.showName ?? null,
      payload.client ?? null,
      payload.formatName ?? null,
      payload.episode ?? null,
      payload.nameEpisode ?? null,
      payload.startTime ?? null,
      payload.notes ?? null,
      payload.isTopMatch ?? false,
    ]
  );

  const event = mapRowToEvent(result.rows[0] as Record<string, unknown>);
  const st = event.status ?? "";
  if (["OK", "CONFIRMED"].includes(st)) {
    await ensureAssignmentsForEvent(pool, event.id);
  }

  return event;
}

const UPDATE_FIELD_MAP: Array<{
  col: string;
  pick: (p: EventUpdatePayload) => unknown;
}> = [
  { col: "category", pick: (p) => p.category },
  { col: "date", pick: (p) => p.date },
  { col: "status", pick: (p) => p.status },
  { col: "standard_combo_id", pick: (p) => p.standardComboId },
  { col: "competition_name", pick: (p) => p.competitionName },
  { col: "matchday", pick: (p) => p.matchday },
  { col: "day", pick: (p) => p.day },
  { col: "ko_italy_time", pick: (p) => p.koItalyTime },
  { col: "venue_name", pick: (p) => p.venueName },
  { col: "venue_address", pick: (p) => p.venueAddress },
  { col: "venue_city", pick: (p) => p.venueCity },
  { col: "pre_duration_minutes", pick: (p) => p.preDurationMinutes },
  { col: "home_team_name_short", pick: (p) => p.homeTeamNameShort },
  { col: "away_team_name_short", pick: (p) => p.awayTeamNameShort },
  { col: "rights_holder", pick: (p) => p.rightsHolder },
  { col: "standard_onsite", pick: (p) => p.standardOnsite },
  { col: "standard_cologno", pick: (p) => p.standardCologno },
  { col: "facilities", pick: (p) => p.facilities },
  { col: "studio", pick: (p) => p.studio },
  { col: "show_name", pick: (p) => p.showName },
  { col: "client", pick: (p) => p.client },
  { col: "format_name", pick: (p) => p.formatName },
  { col: "episode", pick: (p) => p.episode },
  { col: "name_episode", pick: (p) => p.nameEpisode },
  { col: "start_time", pick: (p) => p.startTime },
  { col: "notes", pick: (p) => p.notes },
  { col: "is_top_match", pick: (p) => p.isTopMatch },
];

export async function updateEvent(
  id: string,
  payload: EventUpdatePayload
): Promise<Event | null> {
  const currentResult = await pool.query(
    `SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1`,
    [id]
  );
  if (currentResult.rows.length === 0) return null;

  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;
  let statusChanged = false;
  let standardChanged = false;
  const standardComboIdProvided = hasOwn(payload as object, "standardComboId");

  for (const { col, pick } of UPDATE_FIELD_MAP) {
    const val = pick(payload);
    if (val !== undefined) {
      fields.push(`${col} = $${paramIdx}`);
      values.push(val);
      paramIdx++;
      if (col === "status") statusChanged = true;
      if (
        col === "standard_onsite" ||
        col === "standard_cologno" ||
        col === "facilities" ||
        col === "studio" ||
        col === "standard_combo_id"
      ) {
        standardChanged = true;
      }
    }
  }

  if (standardChanged && !standardComboIdProvided) {
    const current = mapRowToEvent(currentResult.rows[0] as Record<string, unknown>);
    const onsite = payload.standardOnsite ?? current.standardOnsite ?? null;
    const cologno = payload.standardCologno ?? current.standardCologno ?? null;
    const facilities = payload.facilities ?? current.facilities ?? null;
    const studio = payload.studio ?? current.studio ?? null;
    const autoComboId = await findMatchingComboId(onsite, cologno, facilities, studio);
    fields.push(`standard_combo_id = $${paramIdx}`);
    values.push(autoComboId);
    paramIdx++;
  }

  if (fields.length === 0) {
    return mapRowToEvent(currentResult.rows[0] as Record<string, unknown>);
  }

  values.push(id);
  await pool.query(
    `UPDATE events SET ${fields.join(", ")} WHERE id = $${paramIdx}`,
    values
  );

  const updatedResult = await pool.query(
    `SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1`,
    [id]
  );
  const event = mapRowToEvent(updatedResult.rows[0] as Record<string, unknown>);

  if (statusChanged || standardChanged) {
    try {
      await ensureAssignmentsForEvent(pool, id);
    } catch (assignErr) {
      console.error("ensureAssignmentsForEvent error (event still updated):", assignErr);
    }
  }

  return event;
}

export async function autoMatchEventCombosAndListUnmatched(): Promise<{
  matched: number;
  unmatched: number;
  unmatchedEvents: Array<{
    id: string;
    homeTeam: string | null;
    awayTeam: string | null;
    onsite: string | null;
    cologno: string | null;
    facilities: string | null;
    studio: string | null;
  }>;
}> {
  const result = await pool.query<{
    id: string;
    home_team_name_short: string | null;
    away_team_name_short: string | null;
    standard_onsite: string | null;
    standard_cologno: string | null;
    facilities: string | null;
    studio: string | null;
  }>(
    `SELECT id, home_team_name_short, away_team_name_short, standard_onsite, standard_cologno, facilities, studio
     FROM events
     WHERE standard_combo_id IS NULL
       AND standard_onsite IS NOT NULL
       AND standard_onsite <> ''
       AND standard_cologno IS NOT NULL
       AND standard_cologno <> ''`
  );

  let matched = 0;
  const unmatchedEvents: Array<{
    id: string;
    homeTeam: string | null;
    awayTeam: string | null;
    onsite: string | null;
    cologno: string | null;
    facilities: string | null;
    studio: string | null;
  }> = [];

  for (const row of result.rows) {
    const comboId = await findMatchingComboId(
      row.standard_onsite,
      row.standard_cologno,
      row.facilities,
      row.studio
    );

    if (comboId != null) {
      await pool.query(
        `UPDATE events
         SET standard_combo_id = $1
         WHERE id = $2`,
        [comboId, row.id]
      );
      matched++;
      continue;
    }

    unmatchedEvents.push({
      id: row.id,
      homeTeam: row.home_team_name_short,
      awayTeam: row.away_team_name_short,
      onsite: row.standard_onsite,
      cologno: row.standard_cologno,
      facilities: row.facilities,
      studio: row.studio,
    });
  }

  return {
    matched,
    unmatched: unmatchedEvents.length,
    unmatchedEvents,
  };
}

export async function softCancelEvent(id: string): Promise<boolean> {
  const exists = await pool.query("SELECT 1 FROM events WHERE id = $1", [id]);
  if (exists.rows.length === 0) return false;

  await pool.query(`UPDATE events SET status = 'CANCELLED' WHERE id = $1`, [id]);
  return true;
}

export async function bulkUpdateEventStatus(
  eventIds: string[],
  statusInput: string
): Promise<{ updated: number; status: AllowedEventStatus }> {
  const status = normalizeEventStatusInput(statusInput);
  if (!status) {
    throw new Error("INVALID_EVENT_STATUS");
  }

  const uniqueIds = Array.from(
    new Set(eventIds.map((v) => String(v ?? "").trim()).filter(Boolean))
  );
  if (uniqueIds.length === 0) {
    return { updated: 0, status };
  }

  const result = await pool.query(
    `UPDATE events
     SET status = $1
     WHERE id = ANY($2::text[])
     RETURNING id`,
    [status, uniqueIds]
  );

  return { updated: result.rowCount ?? 0, status };
}

export async function deleteEventPermanently(id: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM events WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function eventExists(id: string): Promise<boolean> {
  const r = await pool.query("SELECT 1 FROM events WHERE id = $1", [id]);
  return r.rows.length > 0;
}

export async function runGenerateAssignmentsFromStandard(
  eventId: string
): Promise<AssignmentWithJoins[]> {
  await ensureAssignmentsForEvent(pool, eventId);

  const itemsResult = await pool.query(
    `SELECT ${ASSIGNMENT_EVENT_ROLE_SELECT}
     FROM assignments a
     JOIN events e ON e.id = a.event_id
     JOIN roles r ON r.role_code = a.role_code AND r.location = a.role_location
     LEFT JOIN staff s ON s.id = a.staff_id
     WHERE a.event_id = $1
     ORDER BY e.date ASC NULLS LAST, e.ko_italy_time ASC NULLS LAST, a.id ASC`,
    [eventId]
  );

  return itemsResult.rows.map((r) =>
    mapRowToAssignmentWithJoins(r as Record<string, unknown>)
  );
}

export async function setAssignmentsReadyForEvent(
  eventId: string,
  assignmentIds: number[]
): Promise<number> {
  const placeholders = assignmentIds.map((_, i) => `$${i + 2}`).join(", ");
  const result = await pool.query(
    `UPDATE assignments
     SET status = 'READY', updated_at = now()
     WHERE id IN (${placeholders}) AND event_id = $1
     RETURNING id`,
    [eventId, ...assignmentIds]
  );

  return result.rowCount ?? 0;
}
