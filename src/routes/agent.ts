import { Router, Request, Response } from "express";
import { pool } from "../db";

const router = Router();

const TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE", "ON_HOLD"] as const;

export type AgentMessageRole = "user" | "assistant";

export type AgentMessage = {
  role: AgentMessageRole;
  content: string;
};

export type AgentRequestBody = {
  messages: AgentMessage[];
  context?: {
    page?: string;
    date?: string | null;
    teamFilter?: string | null;
    statusFilter?: string | null;
  };
};

export type AgentResponse = {
  reply: string;
  tasks?: unknown[];
  documents?: unknown[];
};

function isTaskStatus(s: string): boolean {
  return (TASK_STATUSES as readonly string[]).includes(s);
}

async function handleAgentTasksQuery(
  _question: string,
  body: AgentRequestBody
): Promise<AgentResponse> {
  const ctx = body.context ?? {};
  const date = ctx.date?.trim() || null;
  const team = ctx.teamFilter?.trim() || null;
  const statusRaw = ctx.statusFilter?.trim().toUpperCase() || null;
  const status =
    statusRaw && isTaskStatus(statusRaw) ? statusRaw : null;

  const where: string[] = [];
  const values: unknown[] = [];
  let p = 1;

  if (date) {
    where.push(`start_date = $${p}::date`);
    values.push(date);
    p++;
  }
  if (team) {
    where.push(`UPPER(TRIM(team)) = $${p}`);
    values.push(team.toUpperCase());
    p++;
  }
  if (status) {
    where.push(`status = $${p}`);
    values.push(status);
    p++;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `
    SELECT id, title, assignee_id, team, project, start_date, status, completed_at, created_at, updated_at
    FROM cookies_jar_tasks
    ${whereSql}
    ORDER BY start_date ASC, id ASC
    LIMIT 50
  `;

  const result = await pool.query(sql, values);
  const tasks = result.rows;

  let reply: string;
  if (tasks.length === 0) {
    reply = "Non ho trovato attività con i filtri attuali.";
  } else {
    const summaryLines = tasks.slice(0, 5).map((t: Record<string, unknown>) => {
      const statusLabel = String(t.status ?? "");
      const dateLabel =
        t.start_date != null ? String(t.start_date).slice(0, 10) : "—";
      const teamLabel = t.team ? String(t.team) : "—";
      return `• [${statusLabel}] ${t.title} (team: ${teamLabel}, data: ${dateLabel})`;
    });
    reply =
      "Ecco alcune attività trovate con i filtri correnti:\n" +
      summaryLines.join("\n") +
      (tasks.length > 5 ? `\n…e altre ${tasks.length - 5} attività.` : "");
  }

  return {
    reply,
    tasks,
  };
}

async function handleAgentDocumentsQuery(
  question: string,
  _body: AgentRequestBody
): Promise<AgentResponse> {
  const lower = question.toLowerCase();

  let competitionFilter: string | undefined;
  if (lower.includes("serie a")) competitionFilter = "SERIE_A";
  else if (lower.includes("serie b")) competitionFilter = "SERIE_B";

  let categoryFilter: string | undefined;
  if (lower.includes("regolament")) categoryFilter = "REGULATION";
  else if (lower.includes("capitolat")) categoryFilter = "TECH_SPEC";

  const where: string[] = [];
  const values: unknown[] = [];
  let p = 1;

  if (competitionFilter) {
    where.push(`competition = $${p++}`);
    values.push(competitionFilter);
  }
  if (categoryFilter) {
    where.push(`category = $${p++}`);
    values.push(categoryFilter);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `
    SELECT id, title, category, competition, valid_from, valid_to, tags, file_path, uploaded_by_id, created_at
    FROM documents
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT 50
  `;

  const result = await pool.query(sql, values);
  const docs = result.rows;

  let reply: string;
  if (docs.length === 0) {
    reply =
      "Non ho trovato documenti con questi criteri (competizione/categoria).";
  } else {
    const summaryLines = docs.slice(0, 5).map((d: Record<string, unknown>) => {
      const comp = d.competition ? String(d.competition) : "GENERIC";
      const cat = String(d.category ?? "");
      return `• [${cat}] ${d.title} (${comp})`;
    });
    reply =
      "Ho trovato questi documenti rilevanti:\n" +
      summaryLines.join("\n") +
      (docs.length > 5 ? `\n…e altri ${docs.length - 5} documenti.` : "");
  }

  return {
    reply,
    documents: docs,
  };
}

async function handleAgentRequest(
  question: string,
  body: AgentRequestBody
): Promise<AgentResponse> {
  const lower = question.toLowerCase();

  if (lower.includes("task") || lower.includes("attività")) {
    return handleAgentTasksQuery(question, body);
  }

  if (
    lower.includes("document") ||
    lower.includes("documenti") ||
    lower.includes("regolamento") ||
    lower.includes("capitolato")
  ) {
    return handleAgentDocumentsQuery(question, body);
  }

  return {
    reply:
      'Per ora posso solo aiutarti a leggere "attività/tasks" e "documenti". Prova ad esempio: "Mostrami le attività aperte del team MEDIA di oggi" oppure "Che documenti di regolamento Serie A abbiamo?".',
  };
}

router.post("/", async (req: Request, res: Response) => {
  const body = req.body as AgentRequestBody | undefined;
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  const last = body.messages[body.messages.length - 1];
  const question = (last?.content ?? "").trim();
  if (!question) {
    res.status(400).json({ error: "Last message content is empty" });
    return;
  }

  console.log("[AGENT] Incoming:", JSON.stringify(body, null, 2));

  try {
    const result = await handleAgentRequest(question, body);
    res.json(result);
  } catch (err) {
    console.error("POST /api/agent error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
