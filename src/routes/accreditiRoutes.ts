import { Router, Request, Response } from "express";
import { pool } from "../db";
import { listAccreditationsByEventId } from "../services/accreditationsService";
import { resolveStaffDbIntegerId } from "../services/staffService";
import type {
  AccreditationListItem,
  AccreditationWithStaff,
  GetAccreditiResponse,
} from "../types";

const router = Router();

function toAccreditationListItem(a: AccreditationWithStaff): AccreditationListItem {
  return {
    id: a.id,
    eventId: a.eventId,
    staffId: a.staffId,
    company: a.staffCompany,
    surname: a.staffSurname,
    name: a.staffName,
    roleCode: a.roleCode ?? a.staffDefaultRoleCode ?? null,
    areas: a.areas,
    plates: a.plates ?? a.staffPlates ?? null,
    notes: a.notes ?? a.staffNotes ?? null,
  };
}

router.post("/", async (req: Request, res: Response) => {
  const { eventId, staffId, roleCode, areas, plates, notes } = req.body ?? {};

  const parsedEventId =
    eventId != null && String(eventId).trim() !== ""
      ? String(eventId).trim()
      : "";
  const staffIdRaw =
    typeof staffId === "string" ? staffId.trim() : String(staffId ?? "").trim();
  const parsedStaffPk = staffIdRaw
    ? await resolveStaffDbIntegerId(staffIdRaw)
    : null;

  if (!parsedEventId) {
    res.status(400).json({ error: "Invalid eventId" });
    return;
  }
  if (parsedStaffPk == null) {
    res.status(400).json({ error: "Invalid staffId" });
    return;
  }

  try {
    const evCheck = await pool.query("SELECT 1 FROM events WHERE id = $1", [
      parsedEventId,
    ]);
    if (evCheck.rows.length === 0) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const stCheck = await pool.query(
      "SELECT 1 FROM staff WHERE id = $1 AND active = true",
      [parsedStaffPk]
    );
    if (stCheck.rows.length === 0) {
      res.status(404).json({ error: "Staff not found" });
      return;
    }

    const insertSql = `
      INSERT INTO accreditations (
        event_id,
        staff_id,
        role_code,
        areas,
        plates,
        notes,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, now(), now())
      RETURNING id
    `;
    const result = await pool.query<{ id: number }>(insertSql, [
      parsedEventId,
      parsedStaffPk,
      roleCode != null && String(roleCode).trim() !== ""
        ? String(roleCode).trim()
        : null,
      areas != null && String(areas).trim() !== "" ? String(areas).trim() : null,
      plates != null && String(plates).trim() !== ""
        ? String(plates).trim()
        : null,
      notes != null && String(notes).trim() !== "" ? String(notes).trim() : null,
    ]);

    const newId = result.rows[0]?.id;
    if (newId == null) {
      res.status(500).json({ error: "Insert returned no id" });
      return;
    }

    const accreditations = await listAccreditationsByEventId(parsedEventId);
    const created = accreditations.find((a) => a.id === newId);
    if (!created) {
      res.status(201).json({ id: newId });
      return;
    }

    res.status(201).json(toAccreditationListItem(created));
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") {
      res.status(409).json({
        error: "Accreditation already exists for this event and staff",
      });
      return;
    }
    console.error("POST /api/accrediti error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id/deactivate", async (req: Request, res: Response) => {
  const rawId = req.params.id;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isFinite(id) || id < 1) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE accreditations
       SET active = false,
           updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: "Accreditation not found" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    console.error("PATCH /api/accrediti/:id/deactivate error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:eventId", async (req: Request, res: Response) => {
  const eventId = String(req.params.eventId ?? "").trim();
  if (!eventId) {
    res.status(400).json({ error: "Invalid eventId" });
    return;
  }

  try {
    const raw = await listAccreditationsByEventId(eventId);
    const items = raw.map(toAccreditationListItem);
    const body: GetAccreditiResponse = { eventId, items };
    res.json(body);
  } catch (err) {
    console.error("GET /api/accrediti/:eventId error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
