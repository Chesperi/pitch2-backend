import { Router, Request, Response } from "express";
import { requirePitch2Session } from "../middleware/requirePitch2Session";
import {
  requirePageEdit,
  requirePageRead,
} from "../middleware/requirePageAccess";
import {
  listEventRules,
  getEventRuleById,
  createEventRule,
  updateEventRule,
  deleteEventRule,
} from "../services/eventRulesService";
import type { CreateEventRulePayload, UpdateEventRulePayload } from "../types";

const router = Router();

const PAGE_KEY = "master";

function parseIdParam(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

router.get("/", requirePitch2Session, async (req: Request, res: Response) => {
  try {
    if (!(await requirePageRead(req, res, PAGE_KEY))) return;
    const rows = await listEventRules();
    res.json(rows);
  } catch (e) {
    console.error("GET /api/event-rules", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get(
  "/:id",
  requirePitch2Session,
  async (req: Request, res: Response) => {
    try {
      if (!(await requirePageRead(req, res, PAGE_KEY))) return;
      const id = parseIdParam(req.params.id);
      if (id == null) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const row = await getEventRuleById(id);
      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(row);
    } catch (e) {
      console.error("GET /api/event-rules/:id", e);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post("/", requirePitch2Session, async (req: Request, res: Response) => {
  try {
    if (!(await requirePageEdit(req, res, PAGE_KEY))) return;
    const body = (req.body ?? {}) as CreateEventRulePayload;
    const row = await createEventRule(body);
    res.status(201).json(row);
  } catch (e) {
    console.error("POST /api/event-rules", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch(
  "/:id",
  requirePitch2Session,
  async (req: Request, res: Response) => {
    try {
      if (!(await requirePageEdit(req, res, PAGE_KEY))) return;
      const id = parseIdParam(req.params.id);
      if (id == null) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const body = (req.body ?? {}) as UpdateEventRulePayload;
      const row = await updateEventRule(id, body);
      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(row);
    } catch (e) {
      console.error("PATCH /api/event-rules/:id", e);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.delete(
  "/:id",
  requirePitch2Session,
  async (req: Request, res: Response) => {
    try {
      if (!(await requirePageEdit(req, res, PAGE_KEY))) return;
      const id = parseIdParam(req.params.id);
      if (id == null) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const ok = await deleteEventRule(id);
      if (!ok) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(204).send();
    } catch (e) {
      console.error("DELETE /api/event-rules/:id", e);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
