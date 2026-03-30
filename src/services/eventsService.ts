import { pool } from "../db";
import type {
  Event,
  EventAssignmentsStatus,
  AssignmentWithJoins,
  AssignmentStatus,
  EventListFilters,
  EventListPagination,
  EventCreatePayload,
  EventUpdatePayload,
} from "../types";
import { ensureAssignmentsForEvent } from "./assignmentsGenerator";

const EVENT_COLUMNS =
  "id, external_match_id, category, competition_name, competition_code, matchday," +
  "home_team_name_short, away_team_name_short, venue_name, venue_city, venue_address," +
  "ko_italy, pre_duration_minutes, standard_onsite, standard_cologno," +
  "location AS area_produzione, show_name, rights_holder, facilities, studio," +
  "status, notes, assignments_status";

function mapRowToEvent(row: Record<string, unknown>): Event {
  const assignmentsStatus = row.assignments_status;
  const safeAssignmentsStatus: EventAssignmentsStatus =
    assignmentsStatus === "DRAFT" || assignmentsStatus === "READY_TO_SEND"
      ? (assignmentsStatus as EventAssignmentsStatus)
      : "DRAFT";

  return {
    id: Number(row.id),
    externalMatchId: row.external_match_id != null ? String(row.external_match_id) : null,
    category: String(row.category ?? ""),
    competitionName: String(row.competition_name ?? ""),
    competitionCode: row.competition_code != null ? String(row.competition_code) : null,
    matchDay: row.matchday != null ? String(row.matchday) : null,
    homeTeamNameShort: row.home_team_name_short != null ? String(row.home_team_name_short) : null,
    awayTeamNameShort: row.away_team_name_short != null ? String(row.away_team_name_short) : null,
    venueName: row.venue_name != null ? String(row.venue_name) : null,
    venueCity: row.venue_city != null ? String(row.venue_city) : null,
    venueAddress: row.venue_address != null ? String(row.venue_address) : null,
    koItaly: row.ko_italy != null ? String(row.ko_italy) : null,
    preDurationMinutes: Number(row.pre_duration_minutes ?? 0),
    standardOnsite: row.standard_onsite != null ? String(row.standard_onsite) : null,
    standardCologno: row.standard_cologno != null ? String(row.standard_cologno) : null,
    areaProduzione: row.area_produzione != null ? String(row.area_produzione) : null,
    showName: row.show_name != null ? String(row.show_name) : null,
    rightsHolder: row.rights_holder != null ? String(row.rights_holder) : null,
    facilities: row.facilities != null ? String(row.facilities) : null,
    studio: row.studio != null ? String(row.studio) : null,
    status: String(row.status ?? "TBD"),
    notes: row.notes != null ? String(row.notes) : null,
    assignmentsStatus: safeAssignmentsStatus,
  };
}

/** Serializzazione REST: espone `rights_holder` in snake_case (come colonne DB). */
export function eventToApiJson(e: Event): Record<string, unknown> {
  const { rightsHolder, ...rest } = e;
  return { ...rest, rights_holder: rightsHolder };
}

function mapRowToAssignmentWithJoins(row: Record<string, unknown>): AssignmentWithJoins {
  return {
    id: row.a_id as number,
    eventId: row.a_event_id as number,
    roleId: row.a_role_id as number,
    staffId: row.a_staff_id as number | null,
    status: row.a_status as AssignmentStatus,
    notes: row.a_notes as string | null,
    createdAt: String(row.a_created_at),
    updatedAt: String(row.a_updated_at),
    eventExternalMatchId:
      row.e_external_match_id != null ? String(row.e_external_match_id) : null,
    eventCategory: row.e_category as string,
    eventCompetitionName: row.e_competition_name as string,
    eventCompetitionCode: row.e_competition_code as string | null,
    eventMatchDay: row.e_matchday as number | null,
    eventHomeTeamNameShort: row.e_home_team_name_short as string | null,
    eventAwayTeamNameShort: row.e_away_team_name_short as string | null,
    eventVenueName: row.e_venue_name as string | null,
    eventVenueCity: row.e_venue_city as string | null,
    eventKoItaly: row.e_ko_italy != null ? String(row.e_ko_italy) : null,
    eventStatus: row.e_status as string,
    staffSurname: row.s_surname as string | null,
    staffName: row.s_name as string | null,
    staffEmail: row.s_email as string | null,
    staffPhone: row.s_phone as string | null,
    staffCompany: row.s_company as string | null,
    staffFee: row.s_fee as number | null,
    staffPlates: row.s_plates as string | null,
    roleCode: row.r_code as string,
    roleName: row.r_name as string,
    roleLocation: row.r_location as string,
  };
}

const DESIGNABLE_WHERE = `standard_onsite IS NOT NULL AND standard_onsite <> ''
  AND standard_cologno IS NOT NULL AND standard_cologno <> ''
  AND status IN ('OK', 'CONFIRMED')
  AND assignments_status = 'DRAFT'`;

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
  if (filters.competitionCode?.trim()) {
    conditions.push(`competition_code = $${i}`);
    params.push(filters.competitionCode.trim());
    i++;
  }
  if (filters.matchday !== undefined && !Number.isNaN(filters.matchday)) {
    conditions.push(`matchday = $${i}`);
    params.push(filters.matchday);
    i++;
  }
  if (filters.venueCity?.trim()) {
    conditions.push(`venue_city ILIKE $${i}`);
    params.push(`%${filters.venueCity.trim()}%`);
    i++;
  }
  if (filters.status?.trim()) {
    conditions.push(`status = $${i}`);
    params.push(filters.status.trim());
    i++;
  }
  if (filters.assignmentsStatus?.trim()) {
    conditions.push(`assignments_status = $${i}`);
    params.push(filters.assignmentsStatus.trim());
    i++;
  }
  if (filters.dateFrom?.trim()) {
    conditions.push(`ko_italy >= $${i}::timestamptz`);
    params.push(filters.dateFrom.trim());
    i++;
  }
  if (filters.dateTo?.trim()) {
    conditions.push(`ko_italy <= $${i}::timestamptz`);
    params.push(filters.dateTo.trim());
    i++;
  }
  if (filters.onlyDesignable) {
    conditions.push(`(${DESIGNABLE_WHERE})`);
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
     ORDER BY ko_italy ASC NULLS LAST, id ASC
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
     ORDER BY ko_italy ASC NULLS LAST, id ASC
     LIMIT $1 OFFSET $2`,
    [pagination.limit, pagination.offset]
  );

  const items = itemsResult.rows.map((r) =>
    mapRowToEvent(r as Record<string, unknown>)
  );
  return { items, total };
}

export async function getEventById(id: number): Promise<Event | null> {
  const result = await pool.query(
    `SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return null;
  return mapRowToEvent(result.rows[0] as Record<string, unknown>);
}

export async function createEvent(payload: EventCreatePayload): Promise<Event> {
  const category = payload.category;
  const competitionName = payload.competitionName;
  const competitionCode = payload.competitionCode ?? null;
  const matchday = payload.matchday ?? null;
  const homeTeamNameShort = payload.homeTeamNameShort ?? null;
  const awayTeamNameShort = payload.awayTeamNameShort ?? null;
  const venueName = payload.venueName ?? null;
  const venueCity = payload.venueCity ?? null;
  const venueAddress = payload.venueAddress ?? null;
  const koItaly = payload.koItaly ?? null;
  const preDurationMinutes = payload.preDurationMinutes ?? 0;
  const standardOnsite = payload.standardOnsite ?? null;
  const standardCologno = payload.standardCologno ?? null;
  const location = payload.location ?? null;
  const showName = payload.showName ?? null;
  const rightsHolder = payload.rightsHolder ?? null;
  const facilities = payload.facilities ?? null;
  const studio = payload.studio ?? null;
  const status = payload.status ?? "TBD";
  const notes = payload.notes ?? null;
  const assignmentsStatus: EventAssignmentsStatus =
    payload.assignmentsStatus === "READY_TO_SEND" || payload.assignmentsStatus === "DRAFT"
      ? payload.assignmentsStatus
      : "DRAFT";

  const result = await pool.query(
    `INSERT INTO events (
      external_match_id, category, competition_name, competition_code, matchday,
      home_team_name_short, away_team_name_short, venue_name, venue_city, venue_address,
      ko_italy, pre_duration_minutes, standard_onsite, standard_cologno, location,
      show_name, rights_holder, facilities, studio, status, notes, assignments_status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
    RETURNING ${EVENT_COLUMNS}`,
    [
      payload.externalMatchId ?? null,
      category,
      competitionName,
      competitionCode,
      matchday,
      homeTeamNameShort,
      awayTeamNameShort,
      venueName,
      venueCity,
      venueAddress,
      koItaly,
      preDurationMinutes,
      standardOnsite,
      standardCologno,
      location,
      showName,
      rightsHolder,
      facilities,
      studio,
      status,
      notes,
      assignmentsStatus,
    ]
  );

  const event = mapRowToEvent(result.rows[0] as Record<string, unknown>);

  if (["OK", "CONFIRMED"].includes(status)) {
    await ensureAssignmentsForEvent(pool, event.id);
  }

  return event;
}

const UPDATE_FIELD_MAP: Array<{
  col: string;
  pick: (p: EventUpdatePayload) => unknown;
}> = [
  { col: "external_match_id", pick: (p) => p.externalMatchId },
  { col: "category", pick: (p) => p.category },
  { col: "competition_name", pick: (p) => p.competitionName },
  { col: "competition_code", pick: (p) => p.competitionCode },
  { col: "matchday", pick: (p) => p.matchday },
  { col: "home_team_name_short", pick: (p) => p.homeTeamNameShort },
  { col: "away_team_name_short", pick: (p) => p.awayTeamNameShort },
  { col: "venue_name", pick: (p) => p.venueName },
  { col: "venue_city", pick: (p) => p.venueCity },
  { col: "venue_address", pick: (p) => p.venueAddress },
  { col: "ko_italy", pick: (p) => p.koItaly },
  { col: "pre_duration_minutes", pick: (p) => p.preDurationMinutes },
  { col: "standard_onsite", pick: (p) => p.standardOnsite },
  { col: "standard_cologno", pick: (p) => p.standardCologno },
  { col: "location", pick: (p) => p.location },
  { col: "show_name", pick: (p) => p.showName },
  { col: "rights_holder", pick: (p) => p.rightsHolder },
  { col: "facilities", pick: (p) => p.facilities },
  { col: "studio", pick: (p) => p.studio },
  { col: "status", pick: (p) => p.status },
  { col: "notes", pick: (p) => p.notes },
  {
    col: "assignments_status",
    pick: (p) =>
      p.assignmentsStatus === "DRAFT" || p.assignmentsStatus === "READY_TO_SEND"
        ? p.assignmentsStatus
        : undefined,
  },
];

export async function updateEvent(
  id: number,
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

  for (const { col, pick } of UPDATE_FIELD_MAP) {
    const val = pick(payload);
    if (val !== undefined) {
      fields.push(`${col} = $${paramIdx}`);
      values.push(val);
      paramIdx++;
      if (col === "status") statusChanged = true;
      if (col === "standard_onsite" || col === "standard_cologno") standardChanged = true;
    }
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

/**
 * Soft delete: imposta status = 'CANCELED'.
 * Policy centralizzata qui per eventuale hard delete in futuro.
 */
export async function softCancelEvent(id: number): Promise<boolean> {
  const exists = await pool.query("SELECT 1 FROM events WHERE id = $1", [id]);
  if (exists.rows.length === 0) return false;

  await pool.query(`UPDATE events SET status = 'CANCELED' WHERE id = $1`, [id]);
  return true;
}

export async function eventExists(id: number): Promise<boolean> {
  const r = await pool.query("SELECT 1 FROM events WHERE id = $1", [id]);
  return r.rows.length > 0;
}

export async function runGenerateAssignmentsFromStandard(
  eventId: number
): Promise<AssignmentWithJoins[]> {
  await ensureAssignmentsForEvent(pool, eventId);

  const itemsResult = await pool.query(
    `SELECT a.id as a_id, a.event_id as a_event_id, a.role_id as a_role_id, a.staff_id as a_staff_id,
            a.status as a_status, a.notes as a_notes, a.created_at as a_created_at, a.updated_at as a_updated_at,
            e.external_match_id as e_external_match_id, e.category as e_category, e.competition_name as e_competition_name,
            e.competition_code as e_competition_code, e.matchday as e_matchday,
            e.home_team_name_short as e_home_team_name_short, e.away_team_name_short as e_away_team_name_short,
            e.venue_name as e_venue_name, e.venue_city as e_venue_city, e.ko_italy as e_ko_italy,
            e.status as e_status,
            s.surname as s_surname, s.name as s_name, s.email as s_email, s.phone as s_phone,
            s.company as s_company, s.fee as s_fee, s.plates as s_plates,
            r.code as r_code, r.name as r_name, r.location as r_location
     FROM assignments a
     JOIN events e ON e.id = a.event_id
     JOIN roles r ON r.id = a.role_id
     LEFT JOIN staff s ON s.id = a.staff_id
     WHERE a.event_id = $1
     ORDER BY e.ko_italy ASC NULLS LAST, a.id ASC`,
    [eventId]
  );

  return itemsResult.rows.map((r) =>
    mapRowToAssignmentWithJoins(r as Record<string, unknown>)
  );
}

export async function setAssignmentsReadyForEvent(
  eventId: number,
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

  await pool.query(
    "UPDATE events SET assignments_status = 'READY_TO_SEND' WHERE id = $1",
    [eventId]
  );

  return result.rowCount ?? 0;
}

export async function patchEventAssignmentsStatus(
  id: number,
  assignmentsStatus: EventAssignmentsStatus
): Promise<{ id: number; assignmentsStatus: string } | null> {
  const result = await pool.query(
    "UPDATE events SET assignments_status = $1 WHERE id = $2 RETURNING id, assignments_status",
    [assignmentsStatus, id]
  );

  if (result.rows.length === 0) return null;

  return {
    id: result.rows[0].id as number,
    assignmentsStatus: String(result.rows[0].assignments_status),
  };
}
