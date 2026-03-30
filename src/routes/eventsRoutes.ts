import { Router, Request, Response } from "express";
import type {
  EventAssignmentsStatus,
  EventCreatePayload,
  EventUpdatePayload,
  EventListFilters,
} from "../types";
import { getCurrentSession } from "../auth/session";
import {
  requirePageEdit,
  requirePageRead,
} from "../middleware/requirePageAccess";
import { logAuditFromRequest } from "../services/auditLog";
import {
  listEvents,
  listDesignableEvents,
  getEventById,
  createEvent,
  updateEvent,
  softCancelEvent,
  eventExists,
  runGenerateAssignmentsFromStandard,
  setAssignmentsReadyForEvent,
  patchEventAssignmentsStatus,
  eventToApiJson,
} from "../services/eventsService";

const router = Router();

const EVENT_ASSIGNMENTS_STATUSES: EventAssignmentsStatus[] = [
  "DRAFT",
  "READY_TO_SEND",
];

function parseEventId(req: Request, res: Response): number | null {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid event id" });
    return null;
  }
  return id;
}

function parsePagination(req: Request): { limit: number; offset: number } {
  const limit = Math.min(
    Math.max(parseInt(String(req.query.limit), 10) || 50, 1),
    200
  );
  const offset = Math.max(parseInt(String(req.query.offset), 10) || 0, 0);
  return { limit, offset };
}

function parseListFilters(req: Request): EventListFilters {
  const q = (req.query.q as string)?.trim() || undefined;
  const category = (req.query.category as string)?.trim() || undefined;
  const competitionName =
    (req.query.competition_name as string)?.trim() ||
    (req.query.competitionName as string)?.trim() ||
    undefined;
  const competitionCode =
    (req.query.competition_code as string)?.trim() ||
    (req.query.competitionCode as string)?.trim() ||
    undefined;
  const matchdayRaw = req.query.matchday ?? req.query.matchDay;
  const matchday =
    matchdayRaw !== undefined && matchdayRaw !== ""
      ? parseInt(String(matchdayRaw), 10)
      : undefined;
  const venueCity =
    (req.query.venue_city as string)?.trim() ||
    (req.query.venueCity as string)?.trim() ||
    undefined;
  const status = (req.query.status as string)?.trim() || undefined;
  const assignmentsStatus =
    (req.query.assignments_status as string)?.trim() ||
    (req.query.assignmentsStatus as string)?.trim() ||
    undefined;
  const dateFrom =
    (req.query.date_from as string)?.trim() ||
    (req.query.dateFrom as string)?.trim() ||
    undefined;
  const dateTo =
    (req.query.date_to as string)?.trim() ||
    (req.query.dateTo as string)?.trim() ||
    undefined;
  const onlyDesignable =
    String(req.query.onlyDesignable).toLowerCase() === "true" ||
    String(req.query.only_designable).toLowerCase() === "true";

  return {
    q,
    category,
    competitionName,
    competitionCode,
    matchday: matchday !== undefined && !Number.isNaN(matchday) ? matchday : undefined,
    venueCity,
    status,
    assignmentsStatus,
    dateFrom,
    dateTo,
    onlyDesignable: onlyDesignable || undefined,
  };
}

function parseCreatePayload(body: Record<string, unknown>): EventCreatePayload | null {
  const category = body.category as string | undefined;
  const competitionName =
    (body.competition_name as string) ??
    (body.competitionName as string);

  if (
    typeof category !== "string" ||
    !category.trim() ||
    typeof competitionName !== "string" ||
    !competitionName.trim()
  ) {
    return null;
  }

  const ext =
    body.external_match_id ?? body.externalMatchId;
  const externalMatchId =
    ext === null || ext === undefined
      ? undefined
      : typeof ext === "number"
        ? ext
        : parseInt(String(ext), 10);

  const assignmentsRaw = body.assignments_status ?? body.assignmentsStatus;
  const assignmentsStatus =
    assignmentsRaw === "READY_TO_SEND" || assignmentsRaw === "DRAFT"
      ? assignmentsRaw
      : undefined;

  return {
    externalMatchId: Number.isNaN(externalMatchId as number) ? null : externalMatchId,
    category: category.trim(),
    competitionName: competitionName.trim(),
    competitionCode: (body.competition_code ?? body.competitionCode) as string | null | undefined,
    matchday:
      body.matchday !== undefined || body.matchDay !== undefined
        ? (() => {
            const n = Number(body.matchday ?? body.matchDay);
            return Number.isFinite(n) ? n : null;
          })()
        : undefined,
    homeTeamNameShort: (body.home_team_name_short ??
      body.homeTeamNameShort) as string | null | undefined,
    awayTeamNameShort: (body.away_team_name_short ??
      body.awayTeamNameShort) as string | null | undefined,
    venueName: (body.venue_name ?? body.venueName) as string | null | undefined,
    venueCity: (body.venue_city ?? body.venueCity) as string | null | undefined,
    venueAddress: (body.venue_address ?? body.venueAddress) as string | null | undefined,
    koItaly: (body.ko_italy ?? body.koItaly) as string | null | undefined,
    preDurationMinutes:
      body.pre_duration_minutes !== undefined || body.preDurationMinutes !== undefined
        ? Number(body.pre_duration_minutes ?? body.preDurationMinutes)
        : undefined,
    standardOnsite: (body.standard_onsite ?? body.standardOnsite) as string | null | undefined,
    standardCologno: (body.standard_cologno ?? body.standardCologno) as string | null | undefined,
    location: (body.location ?? body.areaProduzione) as string | null | undefined,
    showName: (body.show_name ?? body.showName) as string | null | undefined,
    rightsHolder: (body.rights_holder ?? body.rightsHolder) as string | null | undefined,
    facilities: (body.facilities as string | null | undefined),
    studio: (body.studio as string | null | undefined),
    status: (body.status as string) ?? undefined,
    notes: (body.notes as string) ?? undefined,
    assignmentsStatus,
  };
}

function parseUpdatePayload(body: Record<string, unknown>): EventUpdatePayload {
  const p: EventUpdatePayload = {};
  if (body.external_match_id !== undefined || body.externalMatchId !== undefined) {
    const v = body.external_match_id ?? body.externalMatchId;
    p.externalMatchId =
      v === null ? null : typeof v === "number" ? v : parseInt(String(v), 10);
  }
  if (body.category !== undefined) p.category = String(body.category);
  if (body.competition_name !== undefined || body.competitionName !== undefined) {
    p.competitionName = String(body.competition_name ?? body.competitionName);
  }
  if (body.competition_code !== undefined || body.competitionCode !== undefined) {
    p.competitionCode = (body.competition_code ?? body.competitionCode) as string | null;
  }
  if (body.matchday !== undefined || body.matchDay !== undefined) {
    const n = Number(body.matchday ?? body.matchDay);
    p.matchday = Number.isFinite(n) ? n : null;
  }
  if (body.home_team_name_short !== undefined || body.homeTeamNameShort !== undefined) {
    p.homeTeamNameShort = (body.home_team_name_short ??
      body.homeTeamNameShort) as string | null;
  }
  if (body.away_team_name_short !== undefined || body.awayTeamNameShort !== undefined) {
    p.awayTeamNameShort = (body.away_team_name_short ??
      body.awayTeamNameShort) as string | null;
  }
  if (body.venue_name !== undefined || body.venueName !== undefined) {
    p.venueName = (body.venue_name ?? body.venueName) as string | null;
  }
  if (body.venue_city !== undefined || body.venueCity !== undefined) {
    p.venueCity = (body.venue_city ?? body.venueCity) as string | null;
  }
  if (body.venue_address !== undefined || body.venueAddress !== undefined) {
    p.venueAddress = (body.venue_address ?? body.venueAddress) as string | null;
  }
  if (body.ko_italy !== undefined || body.koItaly !== undefined) {
    p.koItaly = (body.ko_italy ?? body.koItaly) as string | null;
  }
  if (body.pre_duration_minutes !== undefined || body.preDurationMinutes !== undefined) {
    p.preDurationMinutes = Number(body.pre_duration_minutes ?? body.preDurationMinutes);
  }
  if (body.standard_onsite !== undefined || body.standardOnsite !== undefined) {
    p.standardOnsite = (body.standard_onsite ?? body.standardOnsite) as string | null;
  }
  if (body.standard_cologno !== undefined || body.standardCologno !== undefined) {
    p.standardCologno = (body.standard_cologno ?? body.standardCologno) as string | null;
  }
  if (body.location !== undefined || body.areaProduzione !== undefined) {
    p.location = (body.location ?? body.areaProduzione) as string | null;
  }
  if (body.show_name !== undefined || body.showName !== undefined) {
    p.showName = (body.show_name ?? body.showName) as string | null;
  }
  if (body.rights_holder !== undefined || body.rightsHolder !== undefined) {
    p.rightsHolder = (body.rights_holder ?? body.rightsHolder) as string | null;
  }
  if (body.facilities !== undefined) p.facilities = body.facilities as string | null;
  if (body.studio !== undefined) p.studio = body.studio as string | null;
  if (body.status !== undefined) p.status = String(body.status);
  if (body.notes !== undefined) p.notes = body.notes as string | null;
  const as = body.assignments_status ?? body.assignmentsStatus;
  if (as === "DRAFT" || as === "READY_TO_SEND") p.assignmentsStatus = as;
  return p;
}

// GET /api/events/designable — prima di /:id
router.get("/designable", async (_req: Request, res: Response) => {
  try {
    if (!(await requirePageRead(_req, res, "eventi"))) return;
    const pagination = parsePagination(_req);
    const { items, total } = await listDesignableEvents(pagination);
    res.json({ items: items.map(eventToApiJson), total });
  } catch (err) {
    console.error("GET /api/events/designable error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// GET /api/events
router.get("/", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageRead(req, res, "eventi"))) return;
    const filters = parseListFilters(req);
    const pagination = parsePagination(req);
    const { items, total } = await listEvents(filters, pagination);
    res.json({ items: items.map(eventToApiJson), total });
  } catch (err) {
    console.error("GET /api/events error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// GET /api/events/:id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageRead(req, res, "eventi"))) return;
    const id = parseEventId(req, res);
    if (id === null) return;

    const event = await getEventById(id);
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    res.json(eventToApiJson(event));
  } catch (err) {
    console.error("GET /api/events/:id error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// POST /api/events
router.post("/", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageEdit(req, res, "eventi"))) return;
    const payload = parseCreatePayload(req.body as Record<string, unknown>);
    if (!payload) {
      res.status(400).json({
        error: "category and competition_name (or competitionName) are required",
      });
      return;
    }

    const event = await createEvent(payload);
    res.status(201).json(eventToApiJson(event));
  } catch (err) {
    console.error("POST /api/events error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

async function handleUpdate(req: Request, res: Response): Promise<void> {
  if (!(await requirePageEdit(req, res, "eventi"))) return;
  const id = parseEventId(req, res);
  if (id === null) return;

  const payload = parseUpdatePayload(req.body as Record<string, unknown>);
  const event = await updateEvent(id, payload);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(eventToApiJson(event));
}

// PUT /api/events/:id
router.put("/:id", async (req: Request, res: Response) => {
  try {
    await handleUpdate(req, res);
  } catch (err) {
    console.error("PUT /api/events/:id error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// PATCH /api/events/:id (stesso comportamento di PUT)
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    await handleUpdate(req, res);
  } catch (err) {
    console.error("PATCH /api/events/:id error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// DELETE /api/events/:id — soft cancel (status CANCELED)
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageEdit(req, res, "eventi"))) return;
    const id = parseEventId(req, res);
    if (id === null) return;

    const ok = await softCancelEvent(id);
    if (!ok) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/events/:id error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// POST /api/events/:id/generate-assignments-from-standard
router.post("/:id/generate-assignments-from-standard", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageEdit(req, res, "eventi"))) return;
    const id = parseEventId(req, res);
    if (id === null) return;

    if (!(await eventExists(id))) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const items = await runGenerateAssignmentsFromStandard(id);
    res.json({ items });
  } catch (err) {
    console.error("POST /api/events/:id/generate-assignments-from-standard error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// POST /api/events/:id/assignments-ready
router.post("/:id/assignments-ready", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageEdit(req, res, "eventi"))) return;
    const eventId = parseEventId(req, res);
    if (eventId === null) return;

    const { assignmentIds } = req.body;

    if (!Array.isArray(assignmentIds) || assignmentIds.length === 0) {
      res.status(400).json({ error: "assignmentIds must be a non-empty array" });
      return;
    }

    const ids = assignmentIds
      .map((x: unknown) => parseInt(String(x), 10))
      .filter((n: number) => !Number.isNaN(n));

    if (ids.length === 0) {
      res.status(400).json({ error: "assignmentIds must contain valid numbers" });
      return;
    }

    const updated = await setAssignmentsReadyForEvent(eventId, ids);

    const session = getCurrentSession(req);
    void logAuditFromRequest(req, {
      actorType: session ? "staff" : "system",
      ...(session ? { actorId: session.staffId } : {}),
      entityType: "event",
      entityId: String(eventId),
      action: "assignments_bulk_ready",
      metadata: {
        updatedAssignmentsCount: updated,
        requestedAssignmentIdsCount: ids.length,
        field: "assignments_status",
        to: "READY_TO_SEND",
      },
    });

    res.json({ updated });
  } catch (err) {
    console.error("POST /api/events/:id/assignments-ready error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// PATCH /api/events/:id/assignments-status
router.patch("/:id/assignments-status", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageEdit(req, res, "eventi"))) return;
    const id = parseEventId(req, res);
    if (id === null) return;

    const { assignmentsStatus } = req.body;

    if (typeof assignmentsStatus !== "string") {
      res.status(400).json({ error: "assignmentsStatus is required" });
      return;
    }

    if (!EVENT_ASSIGNMENTS_STATUSES.includes(assignmentsStatus as EventAssignmentsStatus)) {
      res.status(400).json({
        error: `assignmentsStatus must be one of: ${EVENT_ASSIGNMENTS_STATUSES.join(", ")}`,
      });
      return;
    }

    const existing = await getEventById(id);
    if (!existing) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    const previousAssignmentsStatus = existing.assignmentsStatus;

    const result = await patchEventAssignmentsStatus(
      id,
      assignmentsStatus as EventAssignmentsStatus
    );

    if (!result) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    if (previousAssignmentsStatus !== result.assignmentsStatus) {
      const session = getCurrentSession(req);
      void logAuditFromRequest(req, {
        actorType: session ? "staff" : "system",
        ...(session ? { actorId: session.staffId } : {}),
        entityType: "event",
        entityId: String(id),
        action: "assignments_status_change",
        metadata: {
          from: previousAssignmentsStatus,
          to: result.assignmentsStatus,
          field: "assignments_status",
        },
      });
    }

    res.json({
      id: result.id,
      assignmentsStatus: result.assignmentsStatus,
    });
  } catch (err) {
    console.error("PATCH /api/events/:id/assignments-status error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
