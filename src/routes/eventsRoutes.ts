import { Router, Request, Response } from "express";
import type {
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
  eventToApiJson,
  getEventAssignmentsStatus,
} from "../services/eventsService";

const router = Router();

function parseEventId(req: Request, res: Response): string | null {
  const id = String(req.params.id ?? "").trim();
  if (!id) {
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
  const matchdayRaw = req.query.matchday ?? req.query.matchDay;
  const matchday =
    matchdayRaw !== undefined && matchdayRaw !== ""
      ? parseInt(String(matchdayRaw), 10)
      : undefined;
  const status = (req.query.status as string)?.trim() || undefined;
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
  const assignmentsStatus =
    (req.query.assignments_status as string)?.trim() ||
    (req.query.assignmentsStatus as string)?.trim() ||
    undefined;

  return {
    q,
    category,
    competitionName,
    matchday: matchday !== undefined && !Number.isNaN(matchday) ? matchday : undefined,
    status,
    dateFrom,
    dateTo,
    onlyDesignable: onlyDesignable || undefined,
    ...(assignmentsStatus ? { assignmentsStatus } : {}),
  };
}

async function serializeEventWithAssignmentsStatus(
  event: Parameters<typeof eventToApiJson>[0]
): Promise<Record<string, unknown>> {
  const base = eventToApiJson(event);
  const assignmentsStatus = await getEventAssignmentsStatus(String(event.id));
  return {
    ...base,
    assignments_status: assignmentsStatus,
    assignmentsStatus,
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

  const idRaw = body.id;
  const id =
    idRaw !== undefined && idRaw !== null && String(idRaw).trim() !== ""
      ? String(idRaw).trim()
      : undefined;

  return {
    id,
    category: category.trim(),
    competitionName: competitionName.trim(),
    date: (body.date as string | null | undefined) ?? undefined,
    status: (body.status as string | null | undefined) ?? undefined,
    matchday:
      body.matchday !== undefined || body.matchDay !== undefined
        ? (() => {
            const n = Number(body.matchday ?? body.matchDay);
            return Number.isFinite(n) ? n : null;
          })()
        : undefined,
    day: (body.day as string | null | undefined) ?? undefined,
    koItalyTime:
      (body.ko_italy_time as string | null | undefined) ??
      (body.koItalyTime as string | null | undefined),
    preDurationMinutes:
      body.pre_duration_minutes !== undefined || body.preDurationMinutes !== undefined
        ? Number(body.pre_duration_minutes ?? body.preDurationMinutes)
        : undefined,
    homeTeamNameShort: (body.home_team_name_short ??
      body.homeTeamNameShort) as string | null | undefined,
    awayTeamNameShort: (body.away_team_name_short ??
      body.awayTeamNameShort) as string | null | undefined,
    rightsHolder: (body.rights_holder ?? body.rightsHolder) as string | null | undefined,
    standardOnsite: (body.standard_onsite ?? body.standardOnsite) as string | null | undefined,
    standardCologno: (body.standard_cologno ?? body.standardCologno) as string | null | undefined,
    facilities: body.facilities as string | null | undefined,
    studio: body.studio as string | null | undefined,
    showName: (body.show_name ?? body.showName) as string | null | undefined,
    client: body.client as string | null | undefined,
    formatName: (body.format_name ?? body.formatName) as string | null | undefined,
    episode:
      body.episode !== undefined
        ? Number(body.episode)
        : undefined,
    nameEpisode: (body.name_episode ?? body.nameEpisode) as string | null | undefined,
    startTime: (body.start_time ?? body.startTime) as string | null | undefined,
    notes: (body.notes as string) ?? undefined,
    isTopMatch:
      body.is_top_match !== undefined || body.isTopMatch !== undefined
        ? Boolean(body.is_top_match ?? body.isTopMatch)
        : undefined,
  };
}

function parseUpdatePayload(body: Record<string, unknown>): EventUpdatePayload {
  const p: EventUpdatePayload = {};
  if (body.category !== undefined) p.category = String(body.category);
  if (body.date !== undefined) p.date = body.date as string | null;
  if (body.status !== undefined) p.status = body.status as string | null;
  if (body.competition_name !== undefined || body.competitionName !== undefined) {
    p.competitionName = String(body.competition_name ?? body.competitionName);
  }
  if (body.matchday !== undefined || body.matchDay !== undefined) {
    const n = Number(body.matchday ?? body.matchDay);
    p.matchday = Number.isFinite(n) ? n : null;
  }
  if (body.day !== undefined) p.day = body.day as string | null;
  if (body.ko_italy_time !== undefined || body.koItalyTime !== undefined) {
    p.koItalyTime = (body.ko_italy_time ?? body.koItalyTime) as string | null;
  }
  if (body.pre_duration_minutes !== undefined || body.preDurationMinutes !== undefined) {
    p.preDurationMinutes = Number(body.pre_duration_minutes ?? body.preDurationMinutes);
  }
  if (body.home_team_name_short !== undefined || body.homeTeamNameShort !== undefined) {
    p.homeTeamNameShort = (body.home_team_name_short ??
      body.homeTeamNameShort) as string | null;
  }
  if (body.away_team_name_short !== undefined || body.awayTeamNameShort !== undefined) {
    p.awayTeamNameShort = (body.away_team_name_short ??
      body.awayTeamNameShort) as string | null;
  }
  if (body.rights_holder !== undefined || body.rightsHolder !== undefined) {
    p.rightsHolder = (body.rights_holder ?? body.rightsHolder) as string | null;
  }
  if (body.standard_onsite !== undefined || body.standardOnsite !== undefined) {
    p.standardOnsite = (body.standard_onsite ?? body.standardOnsite) as string | null;
  }
  if (body.standard_cologno !== undefined || body.standardCologno !== undefined) {
    p.standardCologno = (body.standard_cologno ?? body.standardCologno) as string | null;
  }
  if (body.facilities !== undefined) p.facilities = body.facilities as string | null;
  if (body.studio !== undefined) p.studio = body.studio as string | null;
  if (body.show_name !== undefined || body.showName !== undefined) {
    p.showName = (body.show_name ?? body.showName) as string | null;
  }
  if (body.client !== undefined) p.client = body.client as string | null;
  if (body.format_name !== undefined || body.formatName !== undefined) {
    p.formatName = (body.format_name ?? body.formatName) as string | null;
  }
  if (body.episode !== undefined) {
    const n = Number(body.episode);
    p.episode = Number.isFinite(n) ? n : null;
  }
  if (body.name_episode !== undefined || body.nameEpisode !== undefined) {
    p.nameEpisode = (body.name_episode ?? body.nameEpisode) as string | null;
  }
  if (body.start_time !== undefined || body.startTime !== undefined) {
    p.startTime = (body.start_time ?? body.startTime) as string | null;
  }
  if (body.notes !== undefined) p.notes = body.notes as string | null;
  if (body.is_top_match !== undefined || body.isTopMatch !== undefined) {
    p.isTopMatch = Boolean(body.is_top_match ?? body.isTopMatch);
  }
  return p;
}

// GET /api/events/designable — prima di /:id
router.get("/designable", async (_req: Request, res: Response) => {
  try {
    if (!(await requirePageRead(_req, res, "eventi"))) return;
    const pagination = parsePagination(_req);
    const { items, total } = await listDesignableEvents(pagination);
    const serialized = await Promise.all(
      items.map((event) => serializeEventWithAssignmentsStatus(event))
    );
    res.json({ items: serialized, total });
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
    const serialized = await Promise.all(
      items.map((event) => serializeEventWithAssignmentsStatus(event))
    );
    res.json({ items: serialized, total });
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
    res.json(await serializeEventWithAssignmentsStatus(event));
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
    res.status(201).json(await serializeEventWithAssignmentsStatus(event));
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
  res.json(await serializeEventWithAssignmentsStatus(event));
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

// PATCH /api/events/:id/assignments-status — colonna `assignments_status` rimossa da `events`.
router.patch("/:id/assignments-status", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageEdit(req, res, "eventi"))) return;
    const eventId = parseEventId(req, res);
    if (eventId === null) return;
    const event = await getEventById(eventId);
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    res.status(200).json(await serializeEventWithAssignmentsStatus(event));
  } catch (err) {
    console.error("PATCH /api/events/:id/assignments-status error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
