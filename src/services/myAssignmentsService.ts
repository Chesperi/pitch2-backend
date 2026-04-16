import { pool } from "../db";
import { resolveStaffDbIntegerId } from "./staffService";
import type { StaffId } from "../types/staffId";

const ROME_TZ = { timeZone: "Europe/Rome" } as const;

export type MyAssignmentCrewMember = {
  staff_id: StaffId | null;
  staff_name: string | null;
  role_name: string;
  location: string | null;
  status: string;
};

export type MyAssignmentListItem = {
  assignmentId: number;
  eventId: string;
  competition_name: string;
  show_name: string | null;
  home_team_name_short: string | null;
  away_team_name_short: string | null;
  matchday: number | null;
  date: string | null;
  weekday: string;
  ko_time: string | null;
  location: string | null;
  role_name: string;
  status: string;
  notes: string | null;
  plate_selected: string | null;
};

export type MyAssignmentDetail = MyAssignmentListItem & {
  crew: MyAssignmentCrewMember[];
};

type ListRow = {
  assignment_id: number;
  event_id: string;
  competition_name: string;
  show_name: string | null;
  home_team_name_short: string | null;
  away_team_name_short: string | null;
  matchday: number | null;
  event_date: Date | string | null;
  ko_italy_time: string | null;
  role_location: string | null;
  role_name: string;
  status: string;
  notes: string | null;
  request_car_pass: boolean | null;
  plate_selected: string | null;
};

function formatKoItalyParts(
  eventDate: Date | string | null,
  koTime: string | null
): {
  date: string | null;
  weekday: string;
  ko_time: string | null;
} {
  let dStr = "";
  if (eventDate instanceof Date) {
    if (!Number.isNaN(eventDate.getTime())) {
      dStr = eventDate.toISOString().slice(0, 10);
    }
  } else if (typeof eventDate === "string") {
    const trimmed = eventDate.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      dStr = trimmed.slice(0, 10);
    } else if (trimmed) {
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        dStr = parsed.toISOString().slice(0, 10);
      } else {
        dStr = trimmed.slice(0, 10);
      }
    }
  }
  const tStr = koTime != null ? String(koTime).trim() : "";
  const iso = dStr && tStr ? `${dStr}T${tStr}` : dStr || tStr;
  if (!iso) {
    return { date: null, weekday: "", ko_time: null };
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { date: dStr || null, weekday: "", ko_time: tStr || null };
  }

  const date = dStr || d.toISOString().slice(0, 10);

  const weekdayRaw = new Intl.DateTimeFormat("it-IT", {
    ...ROME_TZ,
    weekday: "long",
  }).format(d);
  const weekday =
    weekdayRaw.length > 0
      ? weekdayRaw.charAt(0).toUpperCase() + weekdayRaw.slice(1)
      : "";

  const ko_time = new Intl.DateTimeFormat("it-IT", {
    ...ROME_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

  return { date, weekday, ko_time };
}

function rowToListItem(row: ListRow): MyAssignmentListItem {
  const { date, weekday, ko_time } = formatKoItalyParts(
    row.event_date,
    row.ko_italy_time
  );
  return {
    assignmentId: row.assignment_id,
    eventId: String(row.event_id),
    competition_name: row.competition_name,
    show_name: row.show_name,
    home_team_name_short: row.home_team_name_short,
    away_team_name_short: row.away_team_name_short,
    matchday: row.matchday,
    date,
    weekday,
    ko_time,
    location: row.role_location,
    role_name: row.role_name,
    status: row.status,
    notes: row.notes,
    plate_selected: row.plate_selected,
  };
}

export async function listMyAssignments(
  staffSessionKey: StaffId
): Promise<MyAssignmentListItem[]> {
  const staffPk = await resolveStaffDbIntegerId(staffSessionKey);
  if (staffPk == null) return [];

  const result = await pool.query<ListRow>(
    `SELECT
       a.id AS assignment_id,
       a.event_id,
       e.competition_name,
       e.show_name,
       e.home_team_name_short,
       e.away_team_name_short,
       e.matchday,
       e.date AS event_date,
       e.ko_italy_time,
       a.role_location,
       COALESCE(NULLIF(TRIM(r.description), ''), r.role_code) AS role_name,
       a.status,
       a.notes,
       a.request_car_pass,
       a.plate_selected
     FROM assignments a
     INNER JOIN events e ON e.id = a.event_id
     INNER JOIN roles r ON r.role_code = a.role_code AND r.location = a.role_location
     WHERE a.staff_id = $1
     ORDER BY e.date ASC NULLS LAST, e.ko_italy_time ASC NULLS LAST, a.id ASC`,
    [staffPk]
  );

  return result.rows.map((row) => rowToListItem(row));
}

type CrewRow = {
  staff_id: number | null;
  staff_name: string | null;
  role_name: string;
  role_location: string;
  status: string;
};

export async function getMyAssignmentDetail(
  staffSessionKey: StaffId,
  assignmentId: number
): Promise<MyAssignmentDetail | null> {
  const staffPk = await resolveStaffDbIntegerId(staffSessionKey);
  if (staffPk == null) return null;

  const mine = await pool.query<ListRow>(
    `SELECT
       a.id AS assignment_id,
       a.event_id,
       e.competition_name,
       e.show_name,
       e.home_team_name_short,
       e.away_team_name_short,
       e.matchday,
       e.date AS event_date,
       e.ko_italy_time,
       a.role_location,
       COALESCE(NULLIF(TRIM(r.description), ''), r.role_code) AS role_name,
       a.status,
       a.notes,
       a.request_car_pass,
       a.plate_selected
     FROM assignments a
     INNER JOIN events e ON e.id = a.event_id
     INNER JOIN roles r ON r.role_code = a.role_code AND r.location = a.role_location
     WHERE a.id = $1 AND a.staff_id = $2`,
    [assignmentId, staffPk]
  );

  const baseRow = mine.rows[0];
  if (!baseRow) return null;

  const crewResult = await pool.query<CrewRow>(
    `SELECT
       a.staff_id,
       CASE
         WHEN a.staff_id IS NULL THEN NULL
         ELSE NULLIF(
           TRIM(BOTH FROM CONCAT_WS(' ', s.name, s.surname)),
           ''
         )
       END AS staff_name,
       COALESCE(NULLIF(TRIM(r.description), ''), r.role_code) AS role_name,
       r.location AS role_location,
       a.status
     FROM assignments a
     INNER JOIN roles r ON r.role_code = a.role_code AND r.location = a.role_location
     LEFT JOIN staff s ON s.id = a.staff_id
     WHERE a.event_id = $1
     ORDER BY a.id ASC`,
    [baseRow.event_id]
  );

  const crew: MyAssignmentCrewMember[] = crewResult.rows.map((r) => ({
    staff_id: r.staff_id != null ? String(r.staff_id) : null,
    staff_name: r.staff_name,
    role_name: r.role_name,
    location: r.role_location,
    status: r.status,
  }));

  return {
    ...rowToListItem(baseRow),
    crew,
  };
}

export type UpdateMyAssignmentPayload = {
  notes?: string | null;
  request_car_pass?: boolean | null;
  plate_selected?: string | null;
  status?: "REJECTED";
};

export async function updateMyAssignment(
  staffSessionKey: StaffId,
  assignmentId: number,
  payload: UpdateMyAssignmentPayload
): Promise<boolean> {
  const staffPk = await resolveStaffDbIntegerId(staffSessionKey);
  if (staffPk == null) return false;

  const fragments: string[] = [];
  const values: unknown[] = [];
  let n = 1;

  if (payload.notes !== undefined) {
    fragments.push(`notes = $${n++}`);
    values.push(payload.notes);
  }
  if (payload.request_car_pass !== undefined) {
    fragments.push(`request_car_pass = $${n++}`);
    values.push(payload.request_car_pass);
  }
  if (payload.plate_selected !== undefined) {
    fragments.push(`plate_selected = $${n++}`);
    values.push(payload.plate_selected);
  }
  if (payload.status === "REJECTED") {
    fragments.push(`status = 'REJECTED'`);
  }

  fragments.push(`updated_at = now()`);

  const idPh = n++;
  const staffPh = n++;
  values.push(assignmentId, staffPk);

  const sql = `UPDATE assignments SET ${fragments.join(
    ", "
  )} WHERE id = $${idPh} AND staff_id = $${staffPh}`;

  const result = await pool.query(sql, values);
  return result.rowCount != null && result.rowCount > 0;
}

export async function confirmMyAssignment(
  staffSessionKey: StaffId,
  assignmentId: number
): Promise<boolean> {
  const staffPk = await resolveStaffDbIntegerId(staffSessionKey);
  if (staffPk == null) return false;

  const result = await pool.query(
    `UPDATE assignments
     SET status = 'CONFIRMED', updated_at = now()
     WHERE id = $1 AND staff_id = $2 AND status = 'SENT'`,
    [assignmentId, staffPk]
  );
  return result.rowCount != null && result.rowCount > 0;
}

export async function confirmAllMyAssignments(staffSessionKey: StaffId): Promise<number> {
  const staffPk = await resolveStaffDbIntegerId(staffSessionKey);
  if (staffPk == null) return 0;

  const result = await pool.query(
    `UPDATE assignments
     SET status = 'CONFIRMED', updated_at = now()
     WHERE staff_id = $1 AND status = 'SENT'`,
    [staffPk]
  );
  return result.rowCount ?? 0;
}
