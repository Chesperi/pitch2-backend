import { Router, Request, Response } from "express";
import { pool } from "../db";
import {
  requirePitch2Session,
  AuthenticatedRequest,
} from "../middleware/requirePitch2Session";
import {
  listMyAssignments,
  getMyAssignmentDetail,
  updateMyAssignment,
  confirmMyAssignment,
  confirmAllMyAssignments,
  type UpdateMyAssignmentPayload,
} from "../services/myAssignmentsService";
import {
  requirePageEdit,
  requirePageRead,
} from "../middleware/requirePageAccess";
import { resolveStaffDbIntegerId } from "../services/staffService";

const router = Router();

/**
 * Router montato su `/api/my-assignments` — API principale per la dashboard freelance
 * «Le mie assegnazioni» (staff loggato via `pitch2_session`).
 *
 * Usata dal frontend con `requirePitch2Session`: lista, dettaglio con `crew[]` per evento,
 * PATCH note, conferma singola / conferma tutte (`SENT` → `CONFIRMED`).
 * Shape tipizzata: `MyAssignmentListItem` / `MyAssignmentDetail` in `myAssignmentsService.ts`.
 */

function parseAssignmentIdParam(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

router.get(
  "/car-plates",
  requirePitch2Session,
  async (req: Request, res: Response) => {
    try {
      const staffSessionId = (req as AuthenticatedRequest).staffId;
      const staffPk = await resolveStaffDbIntegerId(staffSessionId);
      if (staffPk == null) {
        res.status(404).json({ plates: [] });
        return;
      }

      const result = await pool.query<{ plates: string | null }>(
        `SELECT plates
         FROM staff
         WHERE id = $1
         LIMIT 1`,
        [staffPk]
      );

      const raw = result.rows[0]?.plates ?? "";
      const plates = String(raw)
        .split(/[,\n]/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      res.status(200).json({ plates });
    } catch (err) {
      console.error("GET /api/my-assignments/car-plates error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get(
  "/",
  requirePitch2Session,
  async (req: Request, res: Response) => {
    try {
      if (!(await requirePageRead(req, res, "le_mie_assegnazioni"))) return;
      const staffId = (req as AuthenticatedRequest).staffId;
      const items = await listMyAssignments(staffId);
      res.status(200).json(items);
    } catch (err) {
      console.error("GET /api/my-assignments error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post(
  "/confirm-all",
  requirePitch2Session,
  async (req: Request, res: Response) => {
    try {
      if (!(await requirePageEdit(req, res, "le_mie_assegnazioni"))) return;
      const staffId = (req as AuthenticatedRequest).staffId;
      const updatedCount = await confirmAllMyAssignments(staffId);
      res.status(200).json({ success: true, updatedCount });
    } catch (err) {
      console.error("POST /api/my-assignments/confirm-all error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get(
  "/:assignmentId",
  requirePitch2Session,
  async (req: Request, res: Response) => {
    try {
      if (!(await requirePageRead(req, res, "le_mie_assegnazioni"))) return;
      const staffId = (req as AuthenticatedRequest).staffId;
      const assignmentId = parseAssignmentIdParam(req.params.assignmentId);
      if (assignmentId == null) {
        res.status(404).json({ error: "Assignment not found" });
        return;
      }

      const detail = await getMyAssignmentDetail(staffId, assignmentId);
      if (!detail) {
        res.status(404).json({ error: "Assignment not found" });
        return;
      }

      res.status(200).json(detail);
    } catch (err) {
      console.error("GET /api/my-assignments/:assignmentId error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.patch(
  "/:assignmentId",
  requirePitch2Session,
  async (req: Request, res: Response) => {
    try {
      if (!(await requirePageEdit(req, res, "le_mie_assegnazioni"))) return;
      const staffId = (req as AuthenticatedRequest).staffId;
      const assignmentId = parseAssignmentIdParam(req.params.assignmentId);
      if (assignmentId == null) {
        res.status(404).json({ error: "Assignment not found" });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const payload: UpdateMyAssignmentPayload = {};
      if ("notes" in body) {
        const v = body.notes;
        payload.notes = v === null || v === undefined ? null : String(v);
      }
      if ("request_car_pass" in body) {
        const v = body.request_car_pass;
        if (v === null || v === undefined) {
          payload.request_car_pass = null;
        } else if (typeof v === "boolean") {
          payload.request_car_pass = v;
        } else {
          payload.request_car_pass = null;
        }
      }
      if ("requestCarPass" in body && !("request_car_pass" in body)) {
        const v = body.requestCarPass;
        if (v === null || v === undefined) payload.request_car_pass = null;
        else if (typeof v === "boolean") payload.request_car_pass = v;
      }
      if ("plate_selected" in body) {
        const v = body.plate_selected;
        payload.plate_selected =
          v === null || v === undefined ? null : String(v);
      }
      if ("plateSelected" in body && !("plate_selected" in body)) {
        const v = body.plateSelected;
        payload.plate_selected =
          v === null || v === undefined ? null : String(v);
      }
      if (body.status === "REJECTED") {
        payload.status = "REJECTED";
      }

      const ok = await updateMyAssignment(staffId, assignmentId, payload);
      if (!ok) {
        res.status(404).json({ error: "Assignment not found" });
        return;
      }
      res.status(200).json({ success: true });
    } catch (err) {
      console.error("PATCH /api/my-assignments/:assignmentId error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post(
  "/:assignmentId/confirm",
  requirePitch2Session,
  async (req: Request, res: Response) => {
    try {
      if (!(await requirePageEdit(req, res, "le_mie_assegnazioni"))) return;
      const staffId = (req as AuthenticatedRequest).staffId;
      const assignmentId = parseAssignmentIdParam(req.params.assignmentId);
      if (assignmentId == null) {
        res.status(404).json({ error: "Assignment not found" });
        return;
      }

      const ok = await confirmMyAssignment(staffId, assignmentId);
      if (!ok) {
        res.status(404).json({ error: "Assignment not found" });
        return;
      }
      res.status(200).json({ success: true });
    } catch (err) {
      console.error(
        "POST /api/my-assignments/:assignmentId/confirm error:",
        err
      );
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
