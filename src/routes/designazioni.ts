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

type AssignmentRow = {
  a_id: number;
  a_event_id: number;
  a_role_id: number;
  a_staff_id: number | null;
  a_status: string;
  a_notes: string | null;
  e_competition_name: string;
  e_category: string;
  e_home_team_name_short: string | null;
  e_away_team_name_short: string | null;
  e_venue_name: string | null;
  e_venue_city: string | null;
  e_ko_italy: string | Date | null;
  e_matchday: number | null;
  e_pre_duration_minutes: number | null;
  e_standard_onsite: string | null;
  e_standard_cologno: string | null;
  e_status: string;
  e_show_name: string | null;
  e_location: string | null;
  e_rights_holder: string | null;
  e_facilities: string | null;
  e_studio: string | null;
  r_name: string;
  r_code: string;
  r_location: string;
  s_name: string | null;
  s_surname: string | null;
  s_email: string | null;
  s_fee: number | null;
  s_plates: string | null;
};

function formatDateLine(
  koItaly: string | Date | null,
  preMinutes: number | null
): string {
  if (!koItaly) return "—";
  const d = typeof koItaly === "string" ? new Date(koItaly) : koItaly;
  const day = d.toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const pre = preMinutes ?? 45;
  return `${day} — KO: ${time} — PRE: ${pre} min`;
}

function mapAssignmentsToEvents(rows: AssignmentRow[]): DesignazioniEmailEvent[] {
  return rows.map((a) => {
    const competition = a.e_competition_name || a.e_category || "";
    const home = a.e_home_team_name_short ?? "";
    const away = a.e_away_team_name_short ?? "";
    const matchTitle = `${home} vs ${away}`.trim() || "—";
    const dateLine = formatDateLine(
      a.e_ko_italy,
      a.e_pre_duration_minutes
    );
    const roleLabel = a.r_name || a.r_code;
    const standardParts = [a.e_standard_onsite, a.e_standard_cologno].filter(
      Boolean
    );
    const standardLabel = standardParts.join(" / ") || "";
    const roleLine = standardLabel
      ? `Ruolo: ${roleLabel} | Standard: ${standardLabel}`
      : `Ruolo: ${roleLabel}`;
    return { competition, matchTitle, dateLine, roleLine };
  });
}

const router = Router();

/**
 * Router `/api/designazioni/*`: invio email (send-person, send-period) e endpoint freelance legacy.
 *
 * GET `/api/designazioni/me` richiede `pitch2_session`; il client deve usare `credentials: "include"`.
 */

const selectCols = `
  a.id as a_id, a.event_id as a_event_id, a.role_id as a_role_id, a.staff_id as a_staff_id,
  a.status as a_status, a.notes as a_notes, a.created_at as a_created_at, a.updated_at as a_updated_at,
  e.external_match_id as e_external_match_id, e.category as e_category, e.competition_name as e_competition_name,
  e.competition_code as e_competition_code, e.matchday as e_matchday,
  e.home_team_name_short as e_home_team_name_short, e.away_team_name_short as e_away_team_name_short,
  e.venue_name as e_venue_name, e.venue_city as e_venue_city, e.ko_italy as e_ko_italy,
  e.pre_duration_minutes as e_pre_duration_minutes,
  e.standard_onsite as e_standard_onsite, e.standard_cologno as e_standard_cologno,
  e.status as e_status, e.show_name as e_show_name, e.location as e_location,
  e.rights_holder as e_rights_holder, e.facilities as e_facilities, e.studio as e_studio,
  s.surname as s_surname, s.name as s_name, s.email as s_email, s.phone as s_phone,
  s.company as s_company, s.fee as s_fee, s.plates as s_plates,
  r.code as r_code, r.name as r_name, r.location as r_location
`;

/**
 * GET /api/designazioni/me — endpoint legacy per una vista freelance tipo «mie designazioni».
 * In dismissione / merge verso `/api/my-assignments` (shape diversa: righe SQL `AssignmentRow`,
 * payload snake_case, senza `crew`, non allineato a `MyAssignmentListItem`).
 *
 * TODO: valutare rimozione dopo conferma che nessun client (né `fetch` diretti) lo invoca più;
 * al momento il frontend espone ancora `fetchDesignazioniMe` in `lib/api/assignments.ts` ma senza
 * import attivi dalle pagine — verificare prima di eliminare la route.
 */
router.get("/me", requirePitch2Session, async (req: Request, res) => {
  try {
    if (!(await requirePageRead(req, res, "designazioni"))) return;
    const staffId = (req as AuthenticatedRequest).staffId;

    const result = await pool.query(
      `SELECT ${selectCols}
       FROM assignments a
       JOIN events e ON e.id = a.event_id
       JOIN roles r ON r.id = a.role_id
       LEFT JOIN staff s ON s.id = a.staff_id
       WHERE a.staff_id = $1
       ORDER BY e.ko_italy ASC`,
      [staffId]
    );

    const rows = result.rows as AssignmentRow[];
    const items = rows.map((r) => ({
      assignment: {
        id: r.a_id,
        event_id: r.a_event_id,
        role_id: r.a_role_id,
        staff_id: r.a_staff_id ?? 0,
        role_code: r.r_code,
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
        competition_code: null,
        matchday: r.e_matchday,
        home_team_name_short: r.e_home_team_name_short,
        away_team_name_short: r.e_away_team_name_short,
        venue_name: r.e_venue_name ?? r.e_venue_city,
        ko_italy: r.e_ko_italy != null ? String(r.e_ko_italy) : null,
        pre_duration_minutes: r.e_pre_duration_minutes ?? 0,
        standard_onsite: r.e_standard_onsite,
        standard_cologno: r.e_standard_cologno,
        location: r.e_location,
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

// POST /api/designazioni/send-person - invia mail a UNA persona (simulato)
router.post("/send-person", async (req: Request, res) => {
  try {
    if (!(await requirePageEdit(req, res, "designazioni"))) return;
    const { staffId, assignmentIds } = req.body as {
      staffId: number;
      assignmentIds: number[];
    };

    if (
      !staffId ||
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
       JOIN roles r ON r.id = a.role_id
       LEFT JOIN staff s ON s.id = a.staff_id
       WHERE a.id IN (${placeholders}) AND a.staff_id = $1`,
      [staffId, ...assignmentIds]
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

    const magicUrl = await createMagicLinkForStaff(staffId);

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

    console.log("SEND PERSON MAIL", {
      staffId,
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

// POST /api/designazioni/send-period - invia mail a TUTTI nel periodo (simulato)
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
       WHERE e.ko_italy::date >= $1 AND e.ko_italy::date <= $2
       AND a.staff_id IS NOT NULL`,
      [from, to]
    );

    const map = new Map<number, number[]>();
    for (const row of result.rows) {
      const staffId = row.a_staff_id as number;
      const id = row.a_id as number;
      const list = map.get(staffId) ?? [];
      list.push(id);
      map.set(staffId, list);
    }

    let sentCount = 0;

    for (const [staffId, assignmentIds] of map.entries()) {
      const placeholders = assignmentIds.map((_, i) => `$${i + 2}`).join(", ");
      const detailResult = await pool.query(
        `SELECT ${selectCols}
         FROM assignments a
         JOIN events e ON e.id = a.event_id
         JOIN roles r ON r.id = a.role_id
         LEFT JOIN staff s ON s.id = a.staff_id
         WHERE a.id IN (${placeholders}) AND a.staff_id = $1`,
        [staffId, ...assignmentIds]
      );

      const assignments = detailResult.rows as AssignmentRow[];
      if (assignments.length === 0) continue;

      const staff = assignments[0];
      const staffEmail = staff.s_email?.trim();
      if (!staffEmail) {
        console.warn("SEND PERIOD: skip staff", staffId, "(no email)");
        continue;
      }

      const staffName =
        `${staff.s_name ?? ""} ${staff.s_surname ?? ""}`.trim() || staffEmail;
      const magicUrl = await createMagicLinkForStaff(staffId);

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
