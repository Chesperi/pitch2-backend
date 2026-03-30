import { Router, Request, Response } from "express";
import { pool } from "../db";
import { getCurrentSession } from "../auth/session";
import { getPageAccessLevel } from "../services/pagePermissions";

const router = Router();

export type AuditLogItem = {
  id: number;
  createdAt: string;
  actorType: "staff" | "system";
  actorId: number | null;
  entityType: string;
  entityId: string;
  action: string;
  actionLabel: string;
  entityLabel: string;
  metadata: unknown;
};

function parseLimit(raw: string | undefined): number {
  const n = parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.min(n, 200);
}

function parseOffset(raw: string | undefined): number {
  const n = parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function parseActorId(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  const n = parseInt(t, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** `from`: inizio giornata UTC se solo `yyyy-mm-dd`, altrimenti `Date` da ISO. */
function parseFromInstant(raw: string | undefined): Date | null {
  if (raw === undefined || raw === null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const [y, mo, d] = t.split("-").map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(t);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** `to`: fine giornata UTC se solo `yyyy-mm-dd`, altrimenti `Date` da ISO. */
function parseToInstant(raw: string | undefined): Date | null {
  if (raw === undefined || raw === null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const [y, mo, d] = t.split("-").map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(t);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function normalizeActorType(raw: unknown): "staff" | "system" {
  const s = String(raw ?? "").toLowerCase();
  if (s === "staff") return "staff";
  return "system";
}

function mapActionLabel(entityType: string, action: string): string {
  if (entityType === "assignment" && action === "status_change") {
    return "Cambio stato assegnazione";
  }
  if (entityType === "event" && action === "assignments_status_change") {
    return "Cambio stato assignments evento";
  }
  if (entityType === "event" && action === "assignments_bulk_ready") {
    return "Assegna READY agli slot evento";
  }
  if (entityType === "cookies_task" && action === "status_change") {
    return "Cambio stato task Cookies jar";
  }
  if (entityType === "cookies_task" && action === "create") {
    return "Nuovo task Cookies jar";
  }
  if (entityType === "cookies_task" && action === "update") {
    return "Modifica task Cookies jar";
  }
  if (entityType === "staff" && action === "create") {
    return "Nuovo membro staff";
  }
  if (entityType === "staff" && action === "update") {
    return "Modifica staff";
  }
  if (entityType === "staff" && action === "delete") {
    return "Eliminazione staff";
  }
  if (entityType === "role" && action === "create") {
    return "Nuovo ruolo";
  }
  if (entityType === "role" && action === "update") {
    return "Modifica ruolo";
  }
  if (entityType === "role" && action === "delete") {
    return "Eliminazione ruolo";
  }
  if (entityType === "standard" && action === "create") {
    return "Nuovo standard";
  }
  if (entityType === "standard" && action === "update") {
    return "Modifica standard";
  }
  if (entityType === "standard" && action === "delete") {
    return "Eliminazione standard";
  }
  if (action === "create") return "Creazione";
  if (action === "update") return "Modifica";
  if (action === "delete") return "Eliminazione";
  return action;
}

function mapEntityLabel(entityType: string, entityId: string): string {
  if (entityType === "assignment") return `Assignment #${entityId}`;
  if (entityType === "event") return `Evento #${entityId}`;
  if (entityType === "cookies_task") return `Task Cookies jar #${entityId}`;
  if (entityType === "staff") return `Staff #${entityId}`;
  if (entityType === "role") return `Ruolo #${entityId}`;
  if (entityType === "standard") return `Standard #${entityId}`;
  return `${entityType} #${entityId}`;
}

function rowToItem(row: Record<string, unknown>): AuditLogItem {
  const created = row.created_at;
  let createdAt: string;
  if (created instanceof Date) {
    createdAt = created.toISOString();
  } else {
    createdAt = String(created ?? "");
  }

  let actorId: number | null = null;
  const aid = row.actor_id;
  if (aid !== null && aid !== undefined) {
    const n = typeof aid === "number" ? aid : parseInt(String(aid), 10);
    if (Number.isFinite(n)) actorId = n;
  }

  const entityType = String(row.entity_type ?? "");
  const entityId = String(row.entity_id ?? "");
  const action = String(row.action ?? "");

  return {
    id: Number(row.id),
    createdAt,
    actorType: normalizeActorType(row.actor_type),
    actorId,
    entityType,
    entityId,
    action,
    actionLabel: mapActionLabel(entityType, action),
    entityLabel: mapEntityLabel(entityType, entityId),
    metadata: row.metadata ?? {},
  };
}

function buildFilterClause(req: Request): {
  whereSql: string;
  params: unknown[];
} {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let p = 1;

  const entityType = (req.query.entityType as string | undefined)?.trim();
  if (entityType) {
    conditions.push(`entity_type = $${p++}`);
    params.push(entityType);
  }

  const entityId = (req.query.entityId as string | undefined)?.trim();
  if (entityId) {
    conditions.push(`entity_id = $${p++}`);
    params.push(entityId);
  }

  const actorId = parseActorId(req.query.actorId as string | undefined);
  if (actorId !== null) {
    conditions.push(`actor_id = $${p++}`);
    params.push(actorId);
  }

  const fromInst = parseFromInstant(req.query.from as string | undefined);
  if (fromInst) {
    conditions.push(`created_at >= $${p++}`);
    params.push(fromInst);
  }

  const toInst = parseToInstant(req.query.to as string | undefined);
  if (toInst) {
    conditions.push(`created_at <= $${p++}`);
    params.push(toInst);
  }

  const whereSql =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { whereSql, params };
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const session = getCurrentSession(req);
    if (!session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const access = await getPageAccessLevel(session.staffId, "cronologia");
    if (access === "none") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const limit = parseLimit(req.query.limit as string | undefined);
    const offset = parseOffset(req.query.offset as string | undefined);
    const { whereSql, params } = buildFilterClause(req);

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit_log ${whereSql}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

    const listParams = [...params, limit, offset];
    const limitPh = params.length + 1;
    const offsetPh = params.length + 2;

    const listResult = await pool.query(
      `SELECT id, created_at, actor_type, actor_id, entity_type, entity_id, action, metadata
       FROM audit_log
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT $${limitPh} OFFSET $${offsetPh}`,
      listParams
    );

    const items: AuditLogItem[] = listResult.rows.map((r) =>
      rowToItem(r as Record<string, unknown>)
    );

    res.json({
      items,
      total,
      limit,
      offset,
    });
  } catch (err) {
    console.error("GET /api/audit-log error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
