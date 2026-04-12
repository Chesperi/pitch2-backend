import { Router, Request, Response } from "express";
import { requirePitch2Session } from "../middleware/requirePitch2Session";
import {
  requirePageEdit,
  requirePageRead,
} from "../middleware/requirePageAccess";
import {
  listLookupValues,
  createLookupValue,
  updateLookupValue,
  deleteLookupValue,
} from "../services/lookupValuesService";
import type {
  CreateLookupValuePayload,
  UpdateLookupValuePayload,
} from "../types";

const router = Router();

const PAGE_KEY = "database";

function parseIdParam(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

function isDuplicateMessage(e: unknown): boolean {
  return (
    e instanceof Error &&
    e.message === "Valore già esistente in questa categoria"
  );
}

router.get("/", requirePitch2Session, async (req: Request, res: Response) => {
  try {
    if (!(await requirePageRead(req, res, PAGE_KEY))) return;
    const category =
      typeof req.query.category === "string"
        ? req.query.category.trim() || undefined
        : undefined;
    const rows = await listLookupValues(category);
    res.json(rows);
  } catch (e) {
    console.error("GET /api/lookup-values", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requirePitch2Session, async (req: Request, res: Response) => {
  try {
    if (!(await requirePageEdit(req, res, PAGE_KEY))) return;
    const body = req.body as Record<string, unknown>;
    const category = body.category;
    const value = body.value;
    if (typeof category !== "string" || typeof value !== "string") {
      res.status(400).json({ error: "category e value (string) sono obbligatori" });
      return;
    }
    const payload: CreateLookupValuePayload = {
      category,
      value,
      sort_order:
        body.sort_order !== undefined ? Number(body.sort_order) : undefined,
    };
    const row = await createLookupValue(payload);
    res.status(201).json(row);
  } catch (e) {
    if (isDuplicateMessage(e)) {
      res.status(409).json({
        error: "Valore già esistente in questa categoria",
      });
      return;
    }
    if (e instanceof Error && e.message.includes("obbligatori")) {
      res.status(400).json({ error: e.message });
      return;
    }
    console.error("POST /api/lookup-values", e);
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
      const body = req.body as Record<string, unknown>;
      const payload: UpdateLookupValuePayload = {};
      if (body.category !== undefined) {
        payload.category = String(body.category);
      }
      if (body.value !== undefined) {
        payload.value = String(body.value);
      }
      if (body.sort_order !== undefined) {
        payload.sort_order = Number(body.sort_order);
      }
      const row = await updateLookupValue(id, payload);
      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(row);
    } catch (e) {
      if (isDuplicateMessage(e)) {
        res.status(409).json({
          error: "Valore già esistente in questa categoria",
        });
        return;
      }
      console.error("PATCH /api/lookup-values/:id", e);
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
      const ok = await deleteLookupValue(id);
      if (!ok) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(204).send();
    } catch (e) {
      console.error("DELETE /api/lookup-values/:id", e);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
