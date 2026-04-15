import { Router, Request } from "express";
import { pool } from "../db";
import { createMagicLinkForStaff } from "../services/authMagicLinkUrl";
import { requirePitch2Session, AuthenticatedRequest } from "../middleware/requirePitch2Session";
import {
  requirePageEdit,
  requirePageRead,
} from "../middleware/requirePageAccess";
import { sendDesignazioniEmail } from "../services/brevo";
import {
  renderDesignazioniEmail,
  type DesignazioniEmailEvent,
} from "../templates/designazioniEmail";
import { resolveStaffDbIntegerId } from "../services/staffService";
import { isStaffId, normalizeStaffId } from "../types/staffId";

type AssignmentRow = {
  a_id: number;
  a_event_id: string;
  a_role_code: string;
  a_role_location: string;
  a_staff_id: number | null;
  a_status: string;
  a_notes: string | null;
  e_competition_name: string;
  e_category: string;
  e_home_team_name_short: string | null;
  e_away_team_name_short: string | null;
  e_date: string | Date | null;
  e_ko_italy_time: string | null;
  e_matchday: number | null;
  e_pre_duration_minutes: number | null;
  e_standard_onsite: string | null;
  e_standard_cologno: string | null;
  e_status: string;
  e_show_name: string | null;
  e_rights_holder: string | null;
  e_facilities: string | null;
  e_studio: string | null;
  r_description: string | null;
  r_role_code: string;
  r_location: string;
  s_name: string | null;
  s_surname: string | null;
  s_email: string | null;
  s_fee: string | null;
  s_plates: string | null;
};

function toKoDateTime(row: AssignmentRow): Date | null {
  const d = row.e_date != null ? String(row.e_date).slice(0, 10) : "";
  const t = row.e_ko_italy_time != null ? String(row.e_ko_italy_time).trim() : "";
  if (!d && !t) return null;
  const iso = d && t ? `${d}T${t}` : d || t;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatDateLine(row: AssignmentRow): string {
  const ko = toKoDateTime(row);
  if (!ko) return "—";
  const day = ko.toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = ko.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const pre = row.e_pre_duration_minutes ?? 45;
  return `${day} — KO: ${time} — PRE: ${pre} min`;
}

function mapAssignmentsToEvents(rows: AssignmentRow[]): DesignazioniEmailEvent[] {
  return rows.map((a) => {
    const competition = a.e_competition_name || a.e_category || "";
    const home = (a.e_home_team_name_short ?? "").trim();
    const away = (a.e_away_team_name_short ?? "").trim();
    const matchTitle =
      home && away
        ? `${home} vs ${away}`
        : (a.e_show_name ?? "").trim() ||
          (a.e_competition_name ?? "").trim() ||
          "Evento senza titolo";
    const dateLine = formatDateLine(a);
    const roleCode = (a.a_role_code ?? a.r_role_code ?? "").trim() || "—";
    const roleLocation = (a.a_role_location ?? a.r_location ?? "").trim() || "—";
    const roleLine = `Ruolo: ${roleCode} | Sede: ${roleLocation}`;
    return { competition, matchTitle, dateLine, roleLine };
  });
}

const router = Router();

const selectCols = `
  a.id as a_id, a.event_id as a_event_id, a.role_code as a_role_code, a.role_location as a_role_location,
  a.staff_id as a_staff_id,
  a.status as a_status, a.notes as a_notes, a.created_at as a_created_at, a.updated_at as a_updated_at,
  e.category as e_category, e.competition_name as e_competition_name, e.matchday as e_matchday,
  e.home_team_name_short as e_home_team_name_short, e.away_team_name_short as e_away_team_name_short,
  e.date as e_date, e.ko_italy_time as e_ko_italy_time,
  e.pre_duration_minutes as e_pre_duration_minutes,
  e.standard_onsite as e_standard_onsite, e.standard_cologno as e_standard_cologno,
  e.status as e_status, e.show_name as e_show_name,
  e.rights_holder as e_rights_holder, e.facilities as e_facilities, e.studio as e_studio,
  s.surname as s_surname, s.name as s_name, s.email as s_email, s.phone as s_phone,
  s.company as s_company, s.fee as s_fee, s.plates as s_plates,
  r.role_code as r_role_code, r.description as r_description, r.location as r_location
`;

router.get("/me", requirePitch2Session, async (req: Request, res) => {
  try {
    if (!(await requirePageRead(req, res, "designazioni"))) return;
    const sessionKey = (req as AuthenticatedRequest).staffId;
    const staffPk = await resolveStaffDbIntegerId(sessionKey);
    if (staffPk == null) {
      res.status(403).json({ error: "Staff not found" });
      return;
    }

    const result = await pool.query(
      `SELECT ${selectCols}
       FROM assignments a
       JOIN events e ON e.id = a.event_id
       JOIN roles r ON r.role_code = a.role_code AND r.location = a.role_location
       LEFT JOIN staff s ON s.id = a.staff_id
       WHERE a.staff_id = $1
       ORDER BY e.date ASC NULLS LAST, e.ko_italy_time ASC NULLS LAST, a.id ASC`,
      [staffPk]
    );

    const rows = result.rows as AssignmentRow[];
    const items = rows.map((r) => ({
      assignment: {
        id: r.a_id,
        event_id: r.a_event_id,
        role_code: r.a_role_code,
        role_location: r.a_role_location,
        staff_id: r.a_staff_id ?? null,
        fee: r.s_fee ?? null,
        location: r.r_location,
        status: r.a_status,
        plate_selected: null,
        notes: r.a_notes,
        created_at: "",
        updated_at: "",
      },
      event: {
        id: r.a_event_id,
        category: r.e_category,
        competition_name: r.e_competition_name,
        matchday: r.e_matchday,
        home_team_name_short: r.e_home_team_name_short,
        away_team_name_short: r.e_away_team_name_short,
        ko_italy:
          r.e_date != null || r.e_ko_italy_time != null
            ? (() => {
                const d =
                  r.e_date != null ? String(r.e_date).slice(0, 10) : "";
                const t = (r.e_ko_italy_time ?? "").trim();
                return d && t ? `${d}T${t}` : d || t || null;
              })()
            : null,
        pre_duration_minutes: r.e_pre_duration_minutes ?? 0,
        standard_onsite: r.e_standard_onsite,
        standard_cologno: r.e_standard_cologno,
        show_name: r.e_show_name,
        rights_holder: r.e_rights_holder,
        facilities: r.e_facilities,
        studio: r.e_studio,
        status: r.e_status,
      },
    }));

    const staffPlates =
      rows.length > 0 ? (rows[0] as AssignmentRow).s_plates ?? null : null;
    return res.status(200).json({ items, staffPlates });
  } catch (err) {
    console.error("GET /api/designazioni/me error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

router.post("/send-person", async (req: Request, res) => {
  try {
    if (!(await requirePageEdit(req, res, "designazioni"))) return;
    const { staffId: bodyStaffId, assignmentIds } = req.body as {
      staffId: unknown;
      assignmentIds: number[];
    };

    let staffPk: number | null = null;
    if (typeof bodyStaffId === "string" && isStaffId(bodyStaffId.trim())) {
      staffPk = await resolveStaffDbIntegerId(normalizeStaffId(bodyStaffId.trim()));
    } else if (
      typeof bodyStaffId === "number" &&
      Number.isInteger(bodyStaffId) &&
      bodyStaffId > 0
    ) {
      staffPk = bodyStaffId;
    } else if (typeof bodyStaffId === "string" && /^\d+$/.test(bodyStaffId.trim())) {
      staffPk = parseInt(bodyStaffId.trim(), 10);
    }

    if (
      staffPk == null ||
      !Array.isArray(assignmentIds) ||
      assignmentIds.length === 0
    ) {
      res.status(400).json({ error: "Missing staffId or assignmentIds" });
      return;
    }

    const placeholders = assignmentIds.map((_, i) => `$${i + 2}`).join(", ");
    const result = await pool.query(
      `SELECT ${selectCols}
       FROM assignments a
       JOIN events e ON e.id = a.event_id
       JOIN roles r ON r.role_code = a.role_code AND r.location = a.role_location
       LEFT JOIN staff s ON s.id = a.staff_id
       WHERE a.id IN (${placeholders}) AND a.staff_id = $1`,
      [staffPk, ...assignmentIds]
    );

    const assignments = result.rows as AssignmentRow[];
    if (assignments.length === 0) {
      res.status(404).json({ error: "No assignments found" });
      return;
    }

    const staff = assignments[0];
    const staffEmail = staff.s_email?.trim();
    if (!staffEmail) {
      res.status(400).json({ error: "Staff has no email" });
      return;
    }

    const staffName =
      `${staff.s_name ?? ""} ${staff.s_surname ?? ""}`.trim() || staffEmail;

    const magicUrl = await createMagicLinkForStaff(String(staffPk));

    const events = mapAssignmentsToEvents(assignments);
    const html = renderDesignazioniEmail({
      staffName,
      events,
      magicUrl,
    });

    await sendDesignazioniEmail({
      toEmail: staffEmail,
      toName: staffName,
      subject: "Le tue designazioni aggiornate",
      htmlContent: html,
    });

    const sentIds = assignments.map((a) => a.a_id);
    if (sentIds.length > 0) {
      await pool.query(
        `UPDATE assignments
         SET status = 'SENT', updated_at = now()
         WHERE id = ANY($1::int[]) AND status = 'READY'`,
        [sentIds]
      );
    }

    console.log("SEND PERSON MAIL", {
      staffPk,
      assignmentIds,
      count: assignments.length,
      magicUrl,
    });

    return res.status(200).json({ success: true, magicUrl });
  } catch (err) {
    console.error("POST /api/designazioni/send-person error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

router.post("/send-period", async (req: Request, res) => {
  try {
    if (!(await requirePageEdit(req, res, "designazioni"))) return;
    const { from, to } = req.body as { from: string; to: string };

    if (!from || !to) {
      res.status(400).json({ error: "Missing from/to" });
      return;
    }

    const result = await pool.query(
      `SELECT a.id as a_id, a.staff_id as a_staff_id
       FROM assignments a
       JOIN events e ON e.id = a.event_id
       WHERE e.date >= $1::date AND e.date <= $2::date
       AND a.staff_id IS NOT NULL`,
      [from, to]
    );

    const map = new Map<number, Set<number>>();
    for (const row of result.rows) {
      const sid = Number((row as { a_staff_id: unknown }).a_staff_id);
      const id = Number((row as { a_id: unknown }).a_id);
      if (!Number.isFinite(sid) || sid <= 0) continue;
      if (!Number.isFinite(id) || id <= 0) continue;
      const list = map.get(sid) ?? new Set<number>();
      list.add(id);
      map.set(sid, list);
    }

    let sentCount = 0;

    for (const [staffPk, idsSet] of map.entries()) {
      const ids = Array.from(idsSet);
      if (ids.length === 0) continue;
      const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");
      const detailResult = await pool.query(
        `SELECT ${selectCols}
         FROM assignments a
         JOIN events e ON e.id = a.event_id
         JOIN roles r ON r.role_code = a.role_code AND r.location = a.role_location
         LEFT JOIN staff s ON s.id = a.staff_id
         WHERE a.id IN (${placeholders}) AND a.staff_id = $1`,
        [staffPk, ...ids]
      );

      const assignments = detailResult.rows as AssignmentRow[];
      if (assignments.length === 0) continue;

      const st = assignments[0];
      const staffEmail = st.s_email?.trim();
      if (!staffEmail) {
        console.warn("SEND PERIOD: skip staff", staffPk, "(no email)");
        continue;
      }

      const staffName =
        `${st.s_name ?? ""} ${st.s_surname ?? ""}`.trim() || staffEmail;
      const magicUrl = await createMagicLinkForStaff(String(staffPk));

      const events = mapAssignmentsToEvents(assignments);
      const html = renderDesignazioniEmail({
        staffName,
        events,
        magicUrl,
      });

      await sendDesignazioniEmail({
        toEmail: staffEmail,
        toName: staffName,
        subject: "Le tue designazioni aggiornate",
        htmlContent: html,
      });

      const sentIds = assignments.map((a) => a.a_id);
      if (sentIds.length > 0) {
        await pool.query(
          `UPDATE assignments
           SET status = 'SENT', updated_at = now()
           WHERE id = ANY($1::int[]) AND status = 'READY'`,
          [sentIds]
        );
      }
      sentCount++;
    }

    console.log("SEND PERIOD MAIL", {
      from,
      to,
      people: map.size,
      sent: sentCount,
    });

    return res.status(200).json({ success: true, people: map.size, sent: sentCount });
  } catch (err) {
    console.error("POST /api/designazioni/send-period error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
