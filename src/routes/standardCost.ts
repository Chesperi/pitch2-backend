import { Router, Request, Response } from "express";
import { supabaseAdmin } from "../supabaseClient";
import { requireSupabaseJwt } from "../middleware/requireSupabaseJwt";
import type { StandardCost } from "../types";

const TABLE = "standard_cost";

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToStandardCost(row: Record<string, unknown>): StandardCost {
  return {
    id: Number(row.id),
    service: String(row.service ?? ""),
    provider: String(row.provider ?? ""),
    costExclusive: toNum(row.costexclusive),
    costCoExclusive: toNum(row.costcoexclusive),
    extra: toNum(row.extra),
    notes: row.notes != null ? String(row.notes) : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function mapBodyToRow(
  body: unknown,
  mode: "create" | "update"
): Record<string, unknown> | null {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return mode === "create" ? null : {};
  }
  const b = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const service =
    typeof b.service === "string"
      ? b.service.trim()
      : typeof b.service === "number"
        ? String(b.service)
        : undefined;
  const provider =
    typeof b.provider === "string"
      ? b.provider.trim()
      : typeof b.provider === "number"
        ? String(b.provider)
        : undefined;

  if (mode === "create") {
    if (!service || !provider) return null;
    out.service = service;
    out.provider = provider;
  } else {
    if (service !== undefined) out.service = String(service).trim();
    if (provider !== undefined) out.provider = String(provider).trim();
  }

  const pickNum = (camel: string, snake: string) => {
    if (b[camel] !== undefined) out[snake] = parseNumInput(b[camel]);
    else if (b[snake] !== undefined) out[snake] = parseNumInput(b[snake]);
  };

  pickNum("costExclusive", "costexclusive");
  pickNum("costCoExclusive", "costcoexclusive");
  pickNum("extra", "extra");

  if (b.notes !== undefined) {
    const n = b.notes;
    out.notes =
      n == null || String(n).trim() === "" ? null : String(n).trim();
  }

  return out;
}

function parseNumInput(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (s === "" || s === "-") return null;
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const router = Router();
router.use(requireSupabaseJwt);

router.get("/", async (_req: Request, res: Response) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Supabase non configurato" });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select("*")
      .order("provider", { ascending: true, nullsFirst: true })
      .order("service", { ascending: true, nullsFirst: true });

    if (error) {
      console.error("GET standard_cost list:", error);
      res.status(500).json({ error: "Errore nel recupero dei dati" });
      return;
    }

    const items = (data ?? []).map((r) =>
      rowToStandardCost(r as Record<string, unknown>)
    );
    res.status(200).json({ items });
  } catch (err) {
    console.error("GET /api/standard-cost error:", err);
    res.status(500).json({ error: "Errore interno" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Supabase non configurato" });
    return;
  }

  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "id non valido" });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("GET standard_cost by id:", error);
      res.status(500).json({ error: "Errore nel recupero del record" });
      return;
    }

    if (!data) {
      res.status(404).json({ error: "Record non trovato" });
      return;
    }

    res.status(200).json(rowToStandardCost(data as Record<string, unknown>));
  } catch (err) {
    console.error("GET /api/standard-cost/:id error:", err);
    res.status(500).json({ error: "Errore interno" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Supabase non configurato" });
    return;
  }

  const row = mapBodyToRow(req.body, "create");
  if (row == null) {
    res.status(400).json({ error: "service e provider sono obbligatori" });
    return;
  }

  row.updated_at = new Date().toISOString();

  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .insert(row)
      .select("*")
      .single();

    if (error) {
      console.error("POST standard_cost:", error);
      res.status(400).json({ error: error.message || "Creazione non riuscita" });
      return;
    }

    res.status(201).json(rowToStandardCost(data as Record<string, unknown>));
  } catch (err) {
    console.error("POST /api/standard-cost error:", err);
    res.status(500).json({ error: "Errore interno" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Supabase non configurato" });
    return;
  }

  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "id non valido" });
    return;
  }

  const row = mapBodyToRow(req.body, "update");
  if (row == null || Object.keys(row).length === 0) {
    res.status(400).json({ error: "Nessun campo da aggiornare" });
    return;
  }

  if (row.service === "" || row.provider === "") {
    res.status(400).json({ error: "service e provider non possono essere vuoti" });
    return;
  }

  delete row.id;
  delete row.created_at;
  row.updated_at = new Date().toISOString();

  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .update(row)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("PUT standard_cost:", error);
      res.status(400).json({ error: error.message || "Aggiornamento non riuscito" });
      return;
    }

    if (!data) {
      res.status(404).json({ error: "Record non trovato" });
      return;
    }

    res.status(200).json(rowToStandardCost(data as Record<string, unknown>));
  } catch (err) {
    console.error("PUT /api/standard-cost/:id error:", err);
    res.status(500).json({ error: "Errore interno" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Supabase non configurato" });
    return;
  }

  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "id non valido" });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("DELETE standard_cost:", error);
      res.status(500).json({ error: "Eliminazione non riuscita" });
      return;
    }

    if (!data) {
      res.status(404).json({ error: "Record non trovato" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/standard-cost/:id error:", err);
    res.status(500).json({ error: "Errore interno" });
  }
});

export default router;
