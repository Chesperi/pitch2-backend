import { pool } from "../db";

const ROME_TZ = { timeZone: "Europe/Rome" } as const;

export type MyAssignmentCrewMember = {
  staff_id: number | null;
  staff_name: string | null;
  role_name: string;
  location: string | null;
  status: string;
};

export type MyAssignmentListItem = {
  assignmentId: number;
  eventId: number;
  competition_name: string;
  competition_code: string | null;
  matchday: number | null;
  date: string | null;
  weekday: string;
  ko_time: string | null;
  venue_name: string | null;
  venue_city: string | null;
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
  event_id: number;
  competition_name: string;
  competition_code: string | null;
  matchday: number | null;
  ko_italy: Date | string | null;
  venue_name: string | null;
  venue_city: string | null;
  event_location: string | null;
  role_name: string;
  status: string;
  notes: string | null;
};

function formatKoItalyParts(koItaly: Date | string | null): {
  date: string | null;
  weekday: string;
  ko_time: string | null;
} {
  if (koItaly == null) {
    return { date: null, weekday: "", ko_time: null };
  }
  const d = koItaly instanceof Date ? koItaly : new Date(koItaly);
  if (Number.isNaN(d.getTime())) {
    return { date: null, weekday: "", ko_time: null };
  }

  const date = new Intl.DateTimeFormat("en-CA", {
    ...ROME_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

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
  const { date, weekday, ko_time } = formatKoItalyParts(row.ko_italy);
  return {
    assignmentId: row.assignment_id,
    eventId: row.event_id,
    competition_name: row.competition_name,
    competition_code: row.competition_code,
    matchday: row.matchday,
    date,
    weekday,
    ko_time,
    venue_name: row.venue_name,
    venue_city: row.venue_city,
    location: row.event_location,
    role_name: row.role_name,
    status: row.status,
    notes: row.notes,
    plate_selected: null,
  };
}

export async function listMyAssignments(
  staffId: number
): Promise<MyAssignmentListItem[]> {
  const result = await pool.query<ListRow>(
    `SELECT
       a.id AS assignment_id,
       a.event_id,
       e.competition_name,
       e.competition_code,
       e.matchday,
       e.ko_italy,
       e.venue_name,
       e.venue_city,
       e.location AS event_location,
       r.name AS role_name,
       a.status,
       a.notes
     FROM assignments a
     INNER JOIN events e ON e.id = a.event_id
     INNER JOIN roles r ON r.id = a.role_id
     WHERE a.staff_id = $1
     ORDER BY e.ko_italy ASC NULLS LAST, a.id ASC`,
    [staffId]
  );

  return result.rows.map(rowToListItem);
}

type CrewRow = {
  staff_id: number | null;
  staff_name: string | null;
  role_name: string;
  role_location: string;
  status: string;
};

export async function getMyAssignmentDetail(
  staffId: number,
  assignmentId: number
): Promise<MyAssignmentDetail | null> {
  const mine = await pool.query<ListRow>(
    `SELECT
       a.id AS assignment_id,
       a.event_id,
       e.competition_name,
       e.competition_code,
       e.matchday,
       e.ko_italy,
       e.venue_name,
       e.venue_city,
       e.location AS event_location,
       r.name AS role_name,
       a.status,
       a.notes
     FROM assignments a
     INNER JOIN events e ON e.id = a.event_id
     INNER JOIN roles r ON r.id = a.role_id
     WHERE a.id = $1 AND a.staff_id = $2`,
    [assignmentId, staffId]
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
       r.name AS role_name,
       r.location AS role_location,
       a.status
     FROM assignments a
     INNER JOIN roles r ON r.id = a.role_id
     LEFT JOIN staff s ON s.id = a.staff_id
     WHERE a.event_id = $1
     ORDER BY a.id ASC`,
    [baseRow.event_id]
  );

  const crew: MyAssignmentCrewMember[] = crewResult.rows.map((r) => ({
    staff_id: r.staff_id,
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

/** Body accettato da PATCH; campi assenti dal DB sono ignorati in SQL (vedi TODO sotto). */
export type UpdateMyAssignmentPayload = {
  notes?: string | null;
  request_car_pass?: boolean | null;
  plate_selected?: string | null;
};

/**
 * Aggiorna solo colonne esistenti. `request_car_pass` e `plate_selected` non sono nel DB:
 * TODO dopo migration, aggiungere SET request_car_pass = $n, plate_selected = $m quando presenti nel payload.
 */
export async function updateMyAssignment(
  staffId: number,
  assignmentId: number,
  payload: UpdateMyAssignmentPayload
): Promise<boolean> {
  const fragments: string[] = [];
  const values: unknown[] = [];
  let n = 1;

  if (payload.notes !== undefined) {
    fragments.push(`notes = $${n++}`);
    values.push(payload.notes);
  }

  fragments.push(`updated_at = now()`);

  const idPh = n++;
  const staffPh = n++;
  values.push(assignmentId, staffId);

  const sql = `UPDATE assignments SET ${fragments.join(
    ", "
  )} WHERE id = $${idPh} AND staff_id = $${staffPh}`;

  const result = await pool.query(sql, values);
  return result.rowCount != null && result.rowCount > 0;
}

/**
 * Conferma una singola assegnazione dello staff.
 * TODO: eventuale colonna confirmed_at TIMESTAMPTZ — SET confirmed_at = now() insieme a status.
 */
export async function confirmMyAssignment(
  staffId: number,
  assignmentId: number
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE assignments
     SET status = 'CONFIRMED', updated_at = now()
     WHERE id = $1 AND staff_id = $2 AND status = 'SENT'`,
    [assignmentId, staffId]
  );
  return result.rowCount != null && result.rowCount > 0;
}

/** Assegnazioni inviate al freelance e ancora da confermare usano lo status `SENT` (v. staff.ts). */
export async function confirmAllMyAssignments(staffId: number): Promise<number> {
  const result = await pool.query(
    `UPDATE assignments
     SET status = 'CONFIRMED', updated_at = now()
     WHERE staff_id = $1 AND status = 'SENT'`,
    [staffId]
  );
  return result.rowCount ?? 0;
}
