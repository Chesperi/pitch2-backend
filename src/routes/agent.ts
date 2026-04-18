import Anthropic from "@anthropic-ai/sdk";
import { Router, Request, Response } from "express";
import { pool } from "../db";
import { requirePitch2Session } from "../middleware/requirePitch2Session";
import { getEventAssignmentsStatus } from "../services/eventsService";

const router = Router();

const TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE", "ON_HOLD"] as const;
type TaskStatus = (typeof TASK_STATUSES)[number];

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001" as const;

const SYSTEM_PROMPT = `Sei PITCH Assistant, l'assistente operativo di DAZN
per la gestione delle produzioni sportive.
Rispondi sempre in italiano, in modo conciso e diretto.
Hai accesso ai dati operativi in tempo reale:
task attivi, documenti, eventi e designazioni.
Quando l'utente chiede di verificare stati o esportare
dati, descrivi cosa hai trovato e suggerisci le azioni
da intraprendere nell'app.
Non inventare dati. Se non hai informazioni sufficienti
dillo chiaramente.`;

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

function isTaskStatus(s: string): s is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(s);
}

function fetchTasksRows(body: AgentRequestBody): Promise<unknown[]> {
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
    SELECT id, title, assignee_id, team, project, start_date, status,
           completed_at, created_at, updated_at
    FROM cookies_jar_tasks
    ${whereSql}
    ORDER BY start_date ASC, id ASC
    LIMIT 50
  `;

  return pool.query(sql, values).then((result) => result.rows);
}

function fetchDocumentsRowsRecent(): Promise<unknown[]> {
  const sql = `
    SELECT id, title, category, competition, valid_from, valid_to, tags,
           file_path, uploaded_by_id, created_at
    FROM documents
    ORDER BY created_at DESC
    LIMIT 20
  `;
  return pool.query(sql).then((result) => result.rows);
}

function shouldIncludeEventsQuestion(question: string): boolean {
  const lower = question.toLowerCase();
  return (
    lower.includes("accrediti") ||
    /\bmd\b/.test(lower) ||
    lower.includes("matchday") ||
    lower.includes("serie a") ||
    lower.includes("serie b")
  );
}

async function fetchEventsWithAssignmentsStatus(): Promise<
  Record<string, unknown>[]
> {
  const sql = `
    SELECT id::text AS id,
           date,
           competition_name,
           matchday,
           home_team_name_short,
           away_team_name_short,
           category,
           ko_italy_time
    FROM events
    WHERE date >= (CURRENT_DATE - INTERVAL '30 days')
      AND date <= CURRENT_DATE
    ORDER BY date DESC
    LIMIT 20
  `;
  const result = await pool.query<
    Record<string, unknown> & {
      id: string;
      date?: unknown;
      competition_name?: unknown;
      matchday?: unknown;
      home_team_name_short?: unknown;
      away_team_name_short?: unknown;
      category?: unknown;
    }
  >(sql);

  const out: Record<string, unknown>[] = [];
  for (const row of result.rows) {
    const eventId = String(row.id ?? "");
    const assignments_status = await getEventAssignmentsStatus(eventId);
    out.push({
      ...row,
      assignments_status,
    });
  }
  return out;
}

function extractAnthropicReplyText(
  content: Anthropic.Messages.ContentBlock[]
): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text") {
      parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}

async function handleAgentRequestLegacy(
  question: string,
  body: AgentRequestBody
): Promise<AgentResponse> {
  const lower = question.toLowerCase();

  if (lower.includes("task") || lower.includes("attività")) {
    const tasks = await fetchTasksRows(body);
    let reply: string;
    if (tasks.length === 0) {
      reply = "Non ho trovato attività con i filtri attuali.";
    } else {
      const summaryLines = tasks.slice(0, 5).map((t) => {
        const row = t as Record<string, unknown>;
        const statusLabel = String(row.status ?? "");
        const dateLabel =
          row.start_date != null ? String(row.start_date).slice(0, 10) : "—";
        const teamLabel = row.team ? String(row.team) : "—";
        return `• [${statusLabel}] ${row.title} (team: ${teamLabel}, data: ${dateLabel})`;
      });
      reply =
        "Ecco alcune attività trovate con i filtri correnti:\n" +
        summaryLines.join("\n") +
        (tasks.length > 5 ? `\n…e altre ${tasks.length - 5} attività.` : "");
    }
    return { reply, tasks };
  }

  if (
    lower.includes("document") ||
    lower.includes("documenti") ||
    lower.includes("regolamento") ||
    lower.includes("capitolato")
  ) {
    const competitionFilter =
      lower.includes("serie a")
        ? "SERIE_A"
        : lower.includes("serie b")
          ? "SERIE_B"
          : undefined;

    const categoryFilter =
      lower.includes("regolament") || lower.includes("regolamento")
        ? "REGULATION"
        : lower.includes("capitolat") || lower.includes("capitolato")
          ? "TECH_SPEC"
          : undefined;

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
      SELECT id, title, category, competition, valid_from, valid_to, tags,
             file_path, uploaded_by_id, created_at
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

  return {
    reply:
      'Per ora posso solo aiutarti a leggere "attività/tasks" e "documenti". Prova ad esempio: "Mostrami le attività aperte del team MEDIA di oggi" oppure "Che documenti di regolamento Serie A abbiamo?".',
  };
}

router.post("/", requirePitch2Session, async (req: Request, res: Response) => {
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
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

    const tasksRows = await fetchTasksRows(body);
    const documentsRows = await fetchDocumentsRowsRecent();

    let eventsRows: Record<string, unknown>[] | undefined;
    if (shouldIncludeEventsQuestion(question)) {
      eventsRows = await fetchEventsWithAssignmentsStatus();
    }

    if (!apiKey) {
      const legacy = await handleAgentRequestLegacy(question, body);
      const reply =
        legacy.reply.trim().length === 0
          ? "Agent LLM non configurato"
          : `Agent LLM non configurato\n\n${legacy.reply}`;
      res.json({
        reply,
        tasks: legacy.tasks ?? tasksRows,
        documents: legacy.documents ?? documentsRows,
      });
      return;
    }

    const payloadUser = [
      "Contesto dati correnti:",
      "TASK ATTIVI:",
      JSON.stringify(tasksRows),
      "DOCUMENTI:",
      JSON.stringify(documentsRows),
      ...(eventsRows && eventsRows.length > 0
        ? ["EVENTI/ACCREDITI:", JSON.stringify(eventsRows)]
        : []),
      "",
      `Domanda dell'utente: ${question}`,
    ].join("\n");

    const client = new Anthropic({ apiKey });

    const msg = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: payloadUser }],
    });

    const replyText = extractAnthropicReplyText(msg.content);

    res.json({
      reply: replyText || "Nessuna risposta dal modello.",
      tasks: tasksRows,
      documents: documentsRows,
    });
  } catch (err) {
    console.error("POST /api/agent error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
