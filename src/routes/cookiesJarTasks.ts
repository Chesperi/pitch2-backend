import { Router, Request, Response } from "express";
import { pool } from "../db";
import { getCurrentSession } from "../auth/session";
import {
  requirePageEdit,
  requirePageRead,
} from "../middleware/requirePageAccess";
import { logAuditFromRequest } from "../services/auditLog";

const router = Router();

export type CookiesJarTask = {
  id: number;
  title: string;
  assignee_id: number | null;
  team: string;
  project: string;
  start_date: string;
  status: "TODO" | "IN_PROGRESS" | "DONE" | "ON_HOLD";
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

const TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE", "ON_HOLD"] as const;
type TaskStatus = (typeof TASK_STATUSES)[number];

function isTaskStatus(s: string): s is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(s);
}

function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function toIsoDateString(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

function toIsoTimestampString(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function rowToTask(row: Record<string, unknown>): CookiesJarTask {
  return {
    id: row.id as number,
    title: row.title as string,
    assignee_id: (row.assignee_id as number | null) ?? null,
    team: row.team as string,
    project: row.project as string,
    start_date: toIsoDateString(row.start_date),
    status: row.status as CookiesJarTask["status"],
    completed_at: toIsoTimestampString(row.completed_at),
    created_at: toIsoTimestampString(row.created_at) ?? "",
    updated_at: toIsoTimestampString(row.updated_at) ?? "",
  };
}

router.get("/", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageRead(req, res, "cookies_jar"))) return;
    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    const date = (req.query.date as string | undefined)?.trim();
    if (date) {
      if (!isValidIsoDate(date)) {
        res.status(400).json({ error: "Invalid date filter (expected yyyy-mm-dd)" });
        return;
      }
      conditions.push(`start_date = $${p}::date`);
      params.push(date);
      p++;
    }

    const team = (req.query.team as string | undefined)?.trim();
    if (team) {
      conditions.push(`UPPER(TRIM(team)) = $${p}`);
      params.push(team.toUpperCase());
      p++;
    }

    const status = (req.query.status as string | undefined)?.trim().toUpperCase();
    if (status) {
      if (!isTaskStatus(status)) {
        res.status(400).json({
          error: `status must be one of: ${TASK_STATUSES.join(", ")}`,
        });
        return;
      }
      conditions.push(`status = $${p}`);
      params.push(status);
      p++;
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT id, title, assignee_id, team, project, start_date, status,
              completed_at, created_at, updated_at
       FROM cookies_jar_tasks
       ${where}
       ORDER BY start_date ASC, id ASC`,
      params
    );
    const items: CookiesJarTask[] = result.rows.map((r) =>
      rowToTask(r as Record<string, unknown>)
    );
    res.json(items);
  } catch (err) {
    console.error("GET /api/cookies-jar/tasks error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

type TaskBody = {
  title?: string;
  assigneeId?: number | null;
  team?: string;
  project?: string;
  startDate?: string;
  status?: string;
};

router.post("/", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageEdit(req, res, "cookies_jar"))) return;
    const body = req.body as TaskBody;
    const title = String(body.title ?? "").trim();
    if (!title) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    const startDate = String(body.startDate ?? "").trim();
    if (!startDate || !isValidIsoDate(startDate)) {
      res.status(400).json({ error: "startDate is required (yyyy-mm-dd)" });
      return;
    }

    let status: TaskStatus = "TODO";
    if (body.status !== undefined && body.status !== null) {
      const s = String(body.status).trim().toUpperCase();
      if (!isTaskStatus(s)) {
        res.status(400).json({
          error: `status must be one of: ${TASK_STATUSES.join(", ")}`,
        });
        return;
      }
      status = s;
    }

    let assignee_id: number | null = null;
    if (body.assigneeId !== undefined && body.assigneeId !== null) {
      const aid = Number(body.assigneeId);
      if (!Number.isInteger(aid) || aid <= 0) {
        res.status(400).json({ error: "assigneeId must be a positive integer" });
        return;
      }
      assignee_id = aid;
    }

    const team =
      body.team === undefined || body.team === null
        ? ""
        : String(body.team).trim().toUpperCase();
    const project =
      body.project === undefined || body.project === null
        ? ""
        : String(body.project).trim();

    const completedFragment =
      status === "DONE" ? "NOW()" : "NULL";

    const insertResult = await pool.query(
      `INSERT INTO cookies_jar_tasks
        (title, assignee_id, team, project, start_date, status, completed_at)
       VALUES ($1, $2, $3, $4, $5::date, $6, ${completedFragment})
       RETURNING id, title, assignee_id, team, project, start_date, status,
                 completed_at, created_at, updated_at`,
      [title, assignee_id, team, project, startDate, status]
    );

    const row = insertResult.rows[0] as Record<string, unknown>;
    const task = rowToTask(row);
    const session = getCurrentSession(req);
    void logAuditFromRequest(req, {
      actorType: session ? "staff" : "system",
      ...(session ? { actorId: session.staffId } : {}),
      entityType: "cookies_task",
      entityId: String(task.id),
      action: "create",
      metadata: {
        title: task.title,
        status: task.status,
        team: task.team,
        project: task.project,
        startDate: task.start_date,
        assigneeId: task.assignee_id,
      },
    });
    res.status(201).json(task);
  } catch (err) {
    console.error("POST /api/cookies-jar/tasks error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    if (!(await requirePageEdit(req, res, "cookies_jar"))) return;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid task id" });
      return;
    }

    const cur = await pool.query(
      `SELECT id, title, assignee_id, team, project, start_date, status,
              completed_at, created_at, updated_at
       FROM cookies_jar_tasks WHERE id = $1`,
      [id]
    );
    if (cur.rows.length === 0) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const row = cur.rows[0] as Record<string, unknown>;

    const body = req.body as TaskBody;
    const fields: string[] = [];
    const values: unknown[] = [];
    let p = 1;

    if (body.title !== undefined) {
      const t = String(body.title).trim();
      if (!t) {
        res.status(400).json({ error: "title cannot be empty" });
        return;
      }
      fields.push(`title = $${p++}`);
      values.push(t);
    }

    if (body.assigneeId !== undefined) {
      if (body.assigneeId === null) {
        fields.push(`assignee_id = NULL`);
      } else {
        const aid = Number(body.assigneeId);
        if (!Number.isInteger(aid) || aid <= 0) {
          res.status(400).json({ error: "assigneeId must be a positive integer or null" });
          return;
        }
        fields.push(`assignee_id = $${p++}`);
        values.push(aid);
      }
    }

    if (body.team !== undefined) {
      fields.push(`team = $${p++}`);
      values.push(String(body.team).trim().toUpperCase());
    }

    if (body.project !== undefined) {
      fields.push(`project = $${p++}`);
      values.push(String(body.project).trim());
    }

    if (body.startDate !== undefined) {
      const sd = String(body.startDate).trim();
      if (!isValidIsoDate(sd)) {
        res.status(400).json({ error: "startDate must be yyyy-mm-dd" });
        return;
      }
      fields.push(`start_date = $${p++}::date`);
      values.push(sd);
    }

    if (body.status !== undefined) {
      const s = String(body.status).trim().toUpperCase();
      if (!isTaskStatus(s)) {
        res.status(400).json({
          error: `status must be one of: ${TASK_STATUSES.join(", ")}`,
        });
        return;
      }
      fields.push(`status = $${p++}`);
      values.push(s);
      if (s === "DONE" && row.completed_at == null) {
        fields.push(`completed_at = NOW()`);
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const upd = await pool.query(
      `UPDATE cookies_jar_tasks
       SET ${fields.join(", ")}
       WHERE id = $${p}
       RETURNING id, title, assignee_id, team, project, start_date, status,
                 completed_at, created_at, updated_at`,
      values
    );

    const out = upd.rows[0] as Record<string, unknown>;
    const updated = rowToTask(out);

    const prevStatus = String(row.status);
    const nextStatus = String(out.status);
    const statusChanged = prevStatus !== nextStatus;

    const prevAssignee = row.assignee_id as number | null | undefined;
    const nextAssignee = out.assignee_id as number | null | undefined;
    const titleChanged = String(row.title) !== String(out.title);
    const teamChanged = String(row.team ?? "") !== String(out.team ?? "");
    const projectChanged = String(row.project ?? "") !== String(out.project ?? "");
    const startChanged =
      toIsoDateString(row.start_date) !== toIsoDateString(out.start_date);

    const changedFields: string[] = [];
    if (titleChanged) changedFields.push("title");
    if (teamChanged) changedFields.push("team");
    if (projectChanged) changedFields.push("project");
    if (startChanged) changedFields.push("startDate");
    if (
      (prevAssignee ?? null) !== (nextAssignee ?? null)
    ) {
      changedFields.push("assigneeId");
    }
    if (statusChanged) changedFields.push("status");

    const session = getCurrentSession(req);
    const auditBase = {
      actorType: session ? ("staff" as const) : ("system" as const),
      ...(session ? { actorId: session.staffId } : {}),
      entityType: "cookies_task" as const,
      entityId: String(id),
    };

    if (statusChanged) {
      void logAuditFromRequest(req, {
        ...auditBase,
        action: "status_change",
        metadata: {
          from: prevStatus,
          to: nextStatus,
          title: updated.title,
          team: updated.team,
          project: updated.project,
          startDate: updated.start_date,
          assigneeId: updated.assignee_id,
          ...(changedFields.length > 1 ? { changedFields } : {}),
        },
      });
    } else if (changedFields.length > 0) {
      void logAuditFromRequest(req, {
        ...auditBase,
        action: "update",
        metadata: {
          title: updated.title,
          status: updated.status,
          team: updated.team,
          project: updated.project,
          startDate: updated.start_date,
          assigneeId: updated.assignee_id,
          changedFields,
        },
      });
    }

    res.json(updated);
  } catch (err) {
    console.error("PATCH /api/cookies-jar/tasks/:id error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
