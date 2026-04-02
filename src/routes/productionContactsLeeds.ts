import { Router, Request, Response } from "express";
import { supabaseAdmin } from "../supabaseClient";
import { requireSupabaseJwt } from "../middleware/requireSupabaseJwt";

const TABLE = "production_contacts_leeds";

/** Chiavi colonne DB (come su Supabase). */
const DB_KEYS = [
  "competitionname",
  "matchday",
  "date",
  "day",
  "predurationminutes",
  "koitalytime",
  "kogmttime",
  "mcrlineupgmttime",
  "podlineupgmttime",
  "hometeamnameshort",
  "awayteamnameshort",
  "standardcologno",
  "facilities",
  "liveproductioncoordinator",
  "liveproductioncoordinatorcontact",
  "partyline",
  "mcrleedsphonenumber",
  "podleeds",
  "podoperator",
  "podleedscontact",
] as const;

type DbKey = (typeof DB_KEYS)[number];

const CAMEL_TO_DB: Record<string, DbKey> = {
  competitionName: "competitionname",
  matchday: "matchday",
  date: "date",
  day: "day",
  preDurationMinutes: "predurationminutes",
  koItalyTime: "koitalytime",
  koGmtTime: "kogmttime",
  mcrLineupGmtTime: "mcrlineupgmttime",
  podLineupGmtTime: "podlineupgmttime",
  homeTeamNameShort: "hometeamnameshort",
  awayTeamNameShort: "awayteamnameshort",
  standardCologno: "standardcologno",
  facilities: "facilities",
  liveProductionCoordinator: "liveproductioncoordinator",
  liveProductionCoordinatorContact: "liveproductioncoordinatorcontact",
  partyline: "partyline",
  partyLine: "partyline",
  mcrLeedsPhoneNumber: "mcrleedsphonenumber",
  podLeeds: "podleeds",
  podOperator: "podoperator",
  podLeedsContact: "podleedscontact",
};

function isDbKey(k: string): k is DbKey {
  return (DB_KEYS as readonly string[]).includes(k);
}

function mapBodyToRow(body: unknown): Record<string, unknown> {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }
  const src = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(src)) {
    if (val === undefined) continue;
    const dbKey = isDbKey(key) ? key : CAMEL_TO_DB[key];
    if (dbKey) {
      out[dbKey] = val;
    }
  }
  return out;
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
      .order("date", { ascending: true, nullsFirst: true })
      .order("matchday", { ascending: true, nullsFirst: true });

    if (error) {
      console.error("GET production_contacts_leeds list:", error);
      res.status(500).json({ error: "Errore nel recupero dei dati" });
      return;
    }

    res.status(200).json(data ?? []);
  } catch (err) {
    console.error("GET /api/production-contacts-leeds error:", err);
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
      console.error("GET production_contacts_leeds by id:", error);
      res.status(500).json({ error: "Errore nel recupero del record" });
      return;
    }

    if (!data) {
      res.status(404).json({ error: "Record non trovato" });
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    console.error("GET /api/production-contacts-leeds/:id error:", err);
    res.status(500).json({ error: "Errore interno" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Supabase non configurato" });
    return;
  }

  const row = mapBodyToRow(req.body);
  if (Object.keys(row).length === 0) {
    res.status(400).json({ error: "Corpo richiesta vuoto o non valido" });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .insert(row)
      .select("*")
      .single();

    if (error) {
      console.error("POST production_contacts_leeds:", error);
      res.status(400).json({ error: error.message || "Creazione non riuscita" });
      return;
    }

    res.status(201).json(data);
  } catch (err) {
    console.error("POST /api/production-contacts-leeds error:", err);
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

  const row = mapBodyToRow(req.body);
  delete row.id;
  delete row.created_at;
  if (Object.keys(row).length === 0) {
    res.status(400).json({ error: "Nessun campo da aggiornare" });
    return;
  }

  row.updated_at = new Date().toISOString();

  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .update(row)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("PUT production_contacts_leeds:", error);
      res.status(400).json({ error: error.message || "Aggiornamento non riuscito" });
      return;
    }

    if (!data) {
      res.status(404).json({ error: "Record non trovato" });
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    console.error("PUT /api/production-contacts-leeds/:id error:", err);
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
      console.error("DELETE production_contacts_leeds:", error);
      res.status(500).json({ error: "Eliminazione non riuscita" });
      return;
    }

    if (!data) {
      res.status(404).json({ error: "Record non trovato" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/production-contacts-leeds/:id error:", err);
    res.status(500).json({ error: "Errore interno" });
  }
});

export default router;
