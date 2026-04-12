import { pool } from "../db";
import type {
  AppliedRuleFields,
  CreateEventRulePayload,
  EventRule,
  UpdateEventRulePayload,
} from "../types";

function mapRowToEventRule(row: Record<string, unknown>): EventRule {
  const tf = (v: unknown): string | null =>
    v == null ? null : String(v).trim().slice(0, 8);
  return {
    id: Number(row.id),
    competition_name:
      row.competition_name != null ? String(row.competition_name) : null,
    day_of_week:
      row.day_of_week != null ? Number(row.day_of_week) : null,
    ko_time_from: tf(row.ko_time_from),
    ko_time_to: tf(row.ko_time_to),
    standard_onsite:
      row.standard_onsite != null ? String(row.standard_onsite) : null,
    standard_cologno:
      row.standard_cologno != null ? String(row.standard_cologno) : null,
    facilities: row.facilities != null ? String(row.facilities) : null,
    studio: row.studio != null ? String(row.studio) : null,
    show_name: row.show_name != null ? String(row.show_name) : null,
    pre_duration_minutes:
      row.pre_duration_minutes != null
        ? Number(row.pre_duration_minutes)
        : null,
    priority: Number(row.priority ?? 0),
    notes: row.notes != null ? String(row.notes) : null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export async function listEventRules(): Promise<EventRule[]> {
  const result = await pool.query(
    `SELECT *
     FROM event_rules
     ORDER BY priority DESC, id DESC`
  );
  return result.rows.map((r) => mapRowToEventRule(r as Record<string, unknown>));
}

export async function getEventRuleById(id: number): Promise<EventRule | null> {
  const result = await pool.query(
    `SELECT * FROM event_rules WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return null;
  return mapRowToEventRule(result.rows[0] as Record<string, unknown>);
}

export async function createEventRule(
  payload: CreateEventRulePayload
): Promise<EventRule> {
  const result = await pool.query(
    `INSERT INTO event_rules (
      competition_name, day_of_week, ko_time_from, ko_time_to,
      standard_onsite, standard_cologno, facilities, studio, show_name,
      pre_duration_minutes, priority, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *`,
    [
      payload.competition_name?.trim() || null,
      payload.day_of_week ?? null,
      payload.ko_time_from?.trim() || null,
      payload.ko_time_to?.trim() || null,
      payload.standard_onsite?.trim() || null,
      payload.standard_cologno?.trim() || null,
      payload.facilities?.trim() || null,
      payload.studio?.trim() || null,
      payload.show_name?.trim() || null,
      payload.pre_duration_minutes ?? null,
      payload.priority ?? 0,
      payload.notes?.trim() || null,
    ]
  );
  return mapRowToEventRule(result.rows[0] as Record<string, unknown>);
}

export async function updateEventRule(
  id: number,
  payload: UpdateEventRulePayload
): Promise<EventRule | null> {
  const existing = await getEventRuleById(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: unknown[] = [];
  let p = 1;

  const set = (col: string, val: unknown) => {
    fields.push(`${col} = $${p++}`);
    values.push(val);
  };

  if (payload.competition_name !== undefined) {
    set("competition_name", payload.competition_name.trim() || null);
  }
  if (payload.day_of_week !== undefined) {
    set("day_of_week", payload.day_of_week);
  }
  if (payload.ko_time_from !== undefined) {
    set("ko_time_from", payload.ko_time_from.trim() || null);
  }
  if (payload.ko_time_to !== undefined) {
    set("ko_time_to", payload.ko_time_to.trim() || null);
  }
  if (payload.standard_onsite !== undefined) {
    set("standard_onsite", payload.standard_onsite.trim() || null);
  }
  if (payload.standard_cologno !== undefined) {
    set("standard_cologno", payload.standard_cologno.trim() || null);
  }
  if (payload.facilities !== undefined) {
    set("facilities", payload.facilities.trim() || null);
  }
  if (payload.studio !== undefined) {
    set("studio", payload.studio.trim() || null);
  }
  if (payload.show_name !== undefined) {
    set("show_name", payload.show_name.trim() || null);
  }
  if (payload.pre_duration_minutes !== undefined) {
    set("pre_duration_minutes", payload.pre_duration_minutes);
  }
  if (payload.priority !== undefined) {
    set("priority", payload.priority);
  }
  if (payload.notes !== undefined) {
    set("notes", payload.notes.trim() || null);
  }

  if (fields.length === 0) {
    return existing;
  }

  fields.push(`updated_at = now()`);
  values.push(id);

  const result = await pool.query(
    `UPDATE event_rules SET ${fields.join(", ")} WHERE id = $${p} RETURNING *`,
    values
  );
  if (result.rows.length === 0) return null;
  return mapRowToEventRule(result.rows[0] as Record<string, unknown>);
}

export async function deleteEventRule(id: number): Promise<boolean> {
  const result = await pool.query(`DELETE FROM event_rules WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

function parseTimeToMinutes(t: string | null): number | null {
  if (t == null || !String(t).trim()) return null;
  const parts = String(t).trim().split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] ?? "0", 10);
  if (Number.isNaN(h)) return null;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}

const ROME_TZ = "Europe/Rome";

/** 0 = domenica … 6 = sabato, calendario locale Europe/Rome. */
function dayOfWeekInRome(d: Date): number {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: ROME_TZ,
    weekday: "short",
  }).format(d);
  const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    label
  );
  return idx >= 0 ? idx : d.getDay();
}

/** Minuti da mezzanotte in Europe/Rome (fascia oraria KO). */
function minutesOfKoInRome(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ROME_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(d);
  const h = parseInt(
    parts.find((p) => p.type === "hour")?.value ?? "0",
    10
  );
  const m = parseInt(
    parts.find((p) => p.type === "minute")?.value ?? "0",
    10
  );
  return h * 60 + m;
}

function ruleMatches(
  rule: EventRule,
  competitionName: string,
  koDate: Date
): boolean {
  if (
    rule.competition_name != null &&
    rule.competition_name.trim() !== ""
  ) {
    if (
      competitionName.trim().toLowerCase() !==
      rule.competition_name.trim().toLowerCase()
    ) {
      return false;
    }
  }

  if (rule.day_of_week != null && !Number.isNaN(rule.day_of_week)) {
    if (dayOfWeekInRome(koDate) !== rule.day_of_week) {
      return false;
    }
  }

  const fromM = parseTimeToMinutes(rule.ko_time_from);
  const toM = parseTimeToMinutes(rule.ko_time_to);
  if (fromM != null && toM != null) {
    const koM = minutesOfKoInRome(koDate);
    if (koM < fromM || koM > toM) {
      return false;
    }
  }

  return true;
}

function ruleToAppliedFields(rule: EventRule): AppliedRuleFields {
  const out: AppliedRuleFields = {};
  if (rule.standard_onsite != null && rule.standard_onsite.trim() !== "") {
    out.standard_onsite = rule.standard_onsite.trim();
  }
  if (rule.standard_cologno != null && rule.standard_cologno.trim() !== "") {
    out.standard_cologno = rule.standard_cologno.trim();
  }
  if (rule.facilities != null && rule.facilities.trim() !== "") {
    out.facilities = rule.facilities.trim();
  }
  if (rule.studio != null && rule.studio.trim() !== "") {
    out.studio = rule.studio.trim();
  }
  if (rule.show_name != null && rule.show_name.trim() !== "") {
    out.show_name = rule.show_name.trim();
  }
  if (
    rule.pre_duration_minutes != null &&
    !Number.isNaN(rule.pre_duration_minutes)
  ) {
    out.pre_duration_minutes = rule.pre_duration_minutes;
  }
  return out;
}

function comboLookupValue(
  applied: AppliedRuleFields,
  key: "standard_onsite" | "standard_cologno" | "facilities" | "studio"
): string | null {
  const v = applied[key];
  return v === undefined ? null : v;
}

export async function applyRulesToEvent(params: {
  competition_name: string;
  ko_italy: string;
}): Promise<AppliedRuleFields> {
  const rules = await listEventRules();
  const koDate = new Date(params.ko_italy);
  if (Number.isNaN(koDate.getTime())) {
    return {};
  }

  const competition = params.competition_name ?? "";

  for (const rule of rules) {
    if (!ruleMatches(rule, competition, koDate)) {
      continue;
    }

    const applied = ruleToAppliedFields(rule);

    const onsite = comboLookupValue(applied, "standard_onsite");
    const cologno = comboLookupValue(applied, "standard_cologno");
    const facilities = comboLookupValue(applied, "facilities");
    const studio = comboLookupValue(applied, "studio");

    const comboRes = await pool.query<{ id: number }>(
      `SELECT id FROM standard_combos
       WHERE standard_onsite IS NOT DISTINCT FROM $1::text
         AND standard_cologno IS NOT DISTINCT FROM $2::text
         AND facilities IS NOT DISTINCT FROM $3::text
         AND studio IS NOT DISTINCT FROM $4::text
       LIMIT 1`,
      [onsite, cologno, facilities, studio]
    );

    if (comboRes.rows.length > 0) {
      applied.standard_combo_id = comboRes.rows[0].id;
    }

    return applied;
  }

  return {};
}
