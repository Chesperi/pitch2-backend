import { Router, Request, Response } from "express";
import { pool } from "../db";

const router = Router();

export type Document = {
  id: number;
  title: string;
  category: "REGULATION" | "TECH_SPEC" | "INTERNAL_PROCEDURE" | "OTHER";
  competition: string;
  valid_from: string | null;
  valid_to: string | null;
  tags: string[];
  file_path: string;
  uploaded_by_id: number | null;
  created_at: string;
};

const DOCUMENT_CATEGORIES = [
  "REGULATION",
  "TECH_SPEC",
  "INTERNAL_PROCEDURE",
  "OTHER",
] as const;

type DocCategory = (typeof DOCUMENT_CATEGORIES)[number];

function isDocCategory(s: string): s is DocCategory {
  return (DOCUMENT_CATEGORIES as readonly string[]).includes(s);
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

function toIsoDateString(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

function toIsoTimestampString(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function rowToDocument(row: Record<string, unknown>): Document {
  const tagsRaw = row.tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map((t) => String(t))
    : [];

  return {
    id: row.id as number,
    title: row.title as string,
    category: row.category as Document["category"],
    competition: row.competition as string,
    valid_from: toIsoDateString(row.valid_from),
    valid_to: toIsoDateString(row.valid_to),
    tags,
    file_path: row.file_path as string,
    uploaded_by_id: (row.uploaded_by_id as number | null) ?? null,
    created_at: toIsoTimestampString(row.created_at),
  };
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    const competition = (req.query.competition as string | undefined)?.trim();
    if (competition) {
      conditions.push(`competition = $${p}`);
      params.push(competition);
      p++;
    }

    const category = (req.query.category as string | undefined)?.trim().toUpperCase();
    if (category) {
      if (!isDocCategory(category)) {
        res.status(400).json({
          error: `category must be one of: ${DOCUMENT_CATEGORIES.join(", ")}`,
        });
        return;
      }
      conditions.push(`category = $${p}`);
      params.push(category);
      p++;
    }

    const tag = (req.query.tag as string | undefined)?.trim();
    if (tag) {
      conditions.push(`$${p} = ANY(tags)`);
      params.push(tag);
      p++;
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT id, title, category, competition, valid_from, valid_to, tags,
              file_path, uploaded_by_id, created_at
       FROM documents
       ${where}
       ORDER BY created_at DESC`,
      params
    );
    const items: Document[] = result.rows.map((r) =>
      rowToDocument(r as Record<string, unknown>)
    );
    res.json(items);
  } catch (err) {
    console.error("GET /api/documents error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

type DocumentBody = {
  title?: string;
  category?: string;
  competition?: string;
  validFrom?: string | null;
  validTo?: string | null;
  tags?: unknown;
  filePath?: string;
  uploadedById?: number | null;
};

router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body as DocumentBody;
    const title = String(body.title ?? "").trim();
    if (!title) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    const catRaw = String(body.category ?? "").trim().toUpperCase();
    if (!catRaw || !isDocCategory(catRaw)) {
      res.status(400).json({
        error: `category is required; must be one of: ${DOCUMENT_CATEGORIES.join(", ")}`,
      });
      return;
    }

    const filePath = String(body.filePath ?? "").trim();
    if (!filePath) {
      res.status(400).json({ error: "filePath is required" });
      return;
    }

    const competition =
      body.competition !== undefined ? String(body.competition).trim() : "";

    let valid_from: string | null = null;
    if (body.validFrom !== undefined && body.validFrom !== null) {
      const vf = String(body.validFrom).trim();
      if (!isValidIsoDate(vf)) {
        res.status(400).json({ error: "validFrom must be yyyy-mm-dd" });
        return;
      }
      valid_from = vf;
    }

    let valid_to: string | null = null;
    if (body.validTo !== undefined && body.validTo !== null) {
      const vt = String(body.validTo).trim();
      if (!isValidIsoDate(vt)) {
        res.status(400).json({ error: "validTo must be yyyy-mm-dd" });
        return;
      }
      valid_to = vt;
    }

    let tags: string[] = [];
    if (body.tags !== undefined && body.tags !== null) {
      if (!Array.isArray(body.tags)) {
        res.status(400).json({ error: "tags must be an array of strings" });
        return;
      }
      tags = body.tags.map((t) => String(t).trim()).filter((t) => t.length > 0);
    }

    let uploaded_by_id: number | null = null;
    if (body.uploadedById !== undefined && body.uploadedById !== null) {
      const uid = Number(body.uploadedById);
      if (!Number.isInteger(uid) || uid <= 0) {
        res.status(400).json({ error: "uploadedById must be a positive integer" });
        return;
      }
      uploaded_by_id = uid;
    }

    const insertResult = await pool.query(
      `INSERT INTO documents
        (title, category, competition, valid_from, valid_to, tags, file_path, uploaded_by_id)
       VALUES ($1, $2, $3, $4::date, $5::date, $6::text[], $7, $8)
       RETURNING id, title, category, competition, valid_from, valid_to, tags,
                 file_path, uploaded_by_id, created_at`,
      [
        title,
        catRaw,
        competition,
        valid_from,
        valid_to,
        tags,
        filePath,
        uploaded_by_id,
      ]
    );

    const row = insertResult.rows[0] as Record<string, unknown>;
    res.status(201).json(rowToDocument(row));
  } catch (err) {
    console.error("POST /api/documents error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid document id" });
      return;
    }

    const exists = await pool.query(
      "SELECT id FROM documents WHERE id = $1",
      [id]
    );
    if (exists.rows.length === 0) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const body = req.body as DocumentBody;
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

    if (body.category !== undefined) {
      const catRaw = String(body.category).trim().toUpperCase();
      if (!isDocCategory(catRaw)) {
        res.status(400).json({
          error: `category must be one of: ${DOCUMENT_CATEGORIES.join(", ")}`,
        });
        return;
      }
      fields.push(`category = $${p++}`);
      values.push(catRaw);
    }

    if (body.competition !== undefined) {
      fields.push(`competition = $${p++}`);
      values.push(String(body.competition).trim());
    }

    if (body.validFrom !== undefined) {
      if (body.validFrom === null) {
        fields.push(`valid_from = NULL`);
      } else {
        const vf = String(body.validFrom).trim();
        if (!isValidIsoDate(vf)) {
          res.status(400).json({ error: "validFrom must be yyyy-mm-dd" });
          return;
        }
        fields.push(`valid_from = $${p++}::date`);
        values.push(vf);
      }
    }

    if (body.validTo !== undefined) {
      if (body.validTo === null) {
        fields.push(`valid_to = NULL`);
      } else {
        const vt = String(body.validTo).trim();
        if (!isValidIsoDate(vt)) {
          res.status(400).json({ error: "validTo must be yyyy-mm-dd" });
          return;
        }
        fields.push(`valid_to = $${p++}::date`);
        values.push(vt);
      }
    }

    if (body.tags !== undefined) {
      if (body.tags !== null && !Array.isArray(body.tags)) {
        res.status(400).json({ error: "tags must be an array of strings" });
        return;
      }
      const tags =
        body.tags === null
          ? []
          : (body.tags as unknown[]).map((t) => String(t).trim()).filter((t) => t.length > 0);
      fields.push(`tags = $${p++}::text[]`);
      values.push(tags);
    }

    if (body.filePath !== undefined) {
      const fp = String(body.filePath).trim();
      if (!fp) {
        res.status(400).json({ error: "filePath cannot be empty" });
        return;
      }
      fields.push(`file_path = $${p++}`);
      values.push(fp);
    }

    if (body.uploadedById !== undefined) {
      if (body.uploadedById === null) {
        fields.push(`uploaded_by_id = NULL`);
      } else {
        const uid = Number(body.uploadedById);
        if (!Number.isInteger(uid) || uid <= 0) {
          res.status(400).json({
            error: "uploadedById must be a positive integer or null",
          });
          return;
        }
        fields.push(`uploaded_by_id = $${p++}`);
        values.push(uid);
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    values.push(id);
    const upd = await pool.query(
      `UPDATE documents SET ${fields.join(", ")}
       WHERE id = $${p}
       RETURNING id, title, category, competition, valid_from, valid_to, tags,
                 file_path, uploaded_by_id, created_at`,
      values
    );
    const out = upd.rows[0] as Record<string, unknown>;
    res.json(rowToDocument(out));
  } catch (err) {
    console.error("PATCH /api/documents/:id error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

export default router;
