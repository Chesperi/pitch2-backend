import express, { Router, Request, Response } from "express";
import { requirePageEdit } from "../middleware/requirePageAccess";
import type { ImportPreviewItem } from "../types";
import {
  fetchMatchesByCompetition,
  buildImportPreview,
  SUPPORTED_COMPETITIONS,
} from "../services/footballDataService";
import {
  listExternalMatchIdsForCompetition,
  insertEventFromImportItem,
  eventExistsByExternalMatch,
  composeKoItalyFromParts,
  generateZonaEvents,
} from "../services/eventsImportService";
import { parsePdfSerieA, type ParsedMatch } from "../services/pdfSerieAParser";
import { applyRulesToEvent } from "../services/eventRulesService";

const router = Router();

type SupportedCompetitionCode = "SA" | "SB" | "PD";

function isSupportedCompetitionCode(v: string): v is SupportedCompetitionCode {
  return v === "SA" || v === "SB" || v === "PD";
}

function parsePreviewBody(body: unknown): {
  competition_code: string;
  date_from: string;
  date_to: string;
} | null {
  if (body == null || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const competition_code = String(o.competition_code ?? o.competitionCode ?? "").trim();
  const date_from = String(o.date_from ?? o.dateFrom ?? "").trim();
  const date_to = String(o.date_to ?? o.dateTo ?? "").trim();
  if (!competition_code || !date_from || !date_to) return null;
  return { competition_code, date_from, date_to };
}

function normalizeImportItem(raw: unknown): ImportPreviewItem | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sf = (o.suggested_fields ?? o.suggestedFields) as
    | Record<string, unknown>
    | undefined;
  const suggested_fields = {
    ...(typeof sf === "object" && sf != null ? sf : {}),
  } as ImportPreviewItem["suggested_fields"];
  if (typeof o.is_top_match === "boolean") {
    suggested_fields.is_top_match = o.is_top_match;
  }

  const external_match_id = String(
    o.external_match_id ?? o.externalMatchId ?? ""
  ).trim();
  if (!external_match_id) return null;

  const rh = o.rights_holder ?? o.rightsHolder;
  const rights_holder =
    rh === undefined || rh === null ? undefined : String(rh);

  return {
    external_match_id,
    competition_name: String(o.competition_name ?? o.competitionName ?? ""),
    competition_code: String(o.competition_code ?? o.competitionCode ?? ""),
    matchday: Number(o.matchday ?? 0) || 0,
    home_team: String(o.home_team ?? o.homeTeam ?? ""),
    away_team: String(o.away_team ?? o.awayTeam ?? ""),
    ko_utc: String(o.ko_utc ?? o.koUtc ?? ""),
    ko_italy: String(o.ko_italy ?? o.koItaly ?? ""),
    venue:
      o.venue === null || o.venue === undefined
        ? null
        : String(o.venue),
    already_exists: Boolean(o.already_exists ?? o.alreadyExists),
    suggested_fields,
    ...(rights_holder !== undefined ? { rights_holder } : {}),
  };
}

function buildPdfSerieAExternalId(row: ParsedMatch): string {
  const d = row.data.replace(/\//g, "-");
  const h = row.home_team.toLowerCase().replace(/\s+/g, "-");
  const a = row.away_team.toLowerCase().replace(/\s+/g, "-");
  return `pdf-sa-${d}-${h}-${a}`;
}

router.post(
  "/pdf-preview",
  express.raw({
    type: ["application/pdf", "application/octet-stream"],
    limit: "30mb",
  }),
  async (req: Request, res: Response) => {
    try {
      if (!(await requirePageEdit(req, res, "eventi"))) return;

      const buf = req.body;
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        res.status(400).json({
          error: "Invia il PDF come body raw (Content-Type: application/pdf)",
        });
        return;
      }

      const competition_name = "Serie A";
      const competition_code = "SA";

      const parsed = await parsePdfSerieA(buf);
      const items: ImportPreviewItem[] = [];

      for (const row of parsed) {
        const ko_italy = composeKoItalyFromParts(row.data, row.orario);
        if (!ko_italy) continue;
        const koUtc = new Date(ko_italy).toISOString();
        const external_match_id = buildPdfSerieAExternalId(row);
        const already_exists = await eventExistsByExternalMatch(external_match_id);
        const baseSuggested = await applyRulesToEvent({
          competition_name,
          ko_italy,
        });
        const suggested_fields: ImportPreviewItem["suggested_fields"] = {
          ...baseSuggested,
          is_top_match: row.is_top_match,
        };
        items.push({
          external_match_id,
          competition_name,
          competition_code,
          matchday: row.matchday,
          home_team: row.home_team,
          away_team: row.away_team,
          ko_utc: koUtc,
          ko_italy,
          venue: null,
          already_exists,
          suggested_fields,
          rights_holder: row.licenziatario,
        });
      }

      res.json(items);
    } catch (e) {
      console.error("POST /api/events/import/pdf-preview", e);
      res.status(500).json({
        error: e instanceof Error ? e.message : "Internal server error",
      });
    }
  }
);

router.post(
  "/preview",
  async (req: Request, res: Response) => {
    try {
      if (!(await requirePageEdit(req, res, "eventi"))) return;

      const parsed = parsePreviewBody(req.body);
      if (!parsed) {
        res.status(400).json({
          error:
            "Body richiede competition_code, date_from, date_to (YYYY-MM-DD)",
        });
        return;
      }

      const codeUpper = parsed.competition_code.toUpperCase();
      if (!isSupportedCompetitionCode(codeUpper)) {
        res.status(400).json({
          error: `competition_code non supportato: ${parsed.competition_code}`,
        });
        return;
      }

      const matches = await fetchMatchesByCompetition({
        competitionCode: codeUpper,
        dateFrom: parsed.date_from,
        dateTo: parsed.date_to,
      });

      const existingExternalIds = await listExternalMatchIdsForCompetition(
        SUPPORTED_COMPETITIONS[codeUpper]
      );

      const preview = await buildImportPreview({
        matches,
        existingExternalIds,
      });

      res.json(preview);
    } catch (e) {
      console.error("POST /api/events/import/preview", e);
      const msg = e instanceof Error ? e.message : "Internal server error";
      if (msg.includes("FOOTBALL_DATA_API_KEY")) {
        res.status(503).json({ error: msg });
        return;
      }
      res.status(500).json({ error: msg });
    }
  }
);

router.post(
  "/confirm",
  async (req: Request, res: Response) => {
    try {
      if (!(await requirePageEdit(req, res, "eventi"))) return;

      const body = req.body as Record<string, unknown>;
      const rawItems = body.items;
      if (!Array.isArray(rawItems)) {
        res.status(400).json({ error: "Body richiede items: array" });
        return;
      }

      let imported = 0;
      let skipped = 0;
      const importedItems: ImportPreviewItem[] = [];

      for (const raw of rawItems) {
        const item = normalizeImportItem(raw);
        if (!item) {
          skipped++;
          continue;
        }

        if (item.already_exists) {
          skipped++;
          continue;
        }

        const exists = await eventExistsByExternalMatch(item.external_match_id);
        if (exists) {
          skipped++;
          continue;
        }

        try {
          await insertEventFromImportItem(item);
          imported++;
          importedItems.push(item);
        } catch (err) {
          console.error("import confirm row", err);
          skipped++;
        }
      }

      const confirmedKos = [...new Set(importedItems.map((i) => i.ko_italy))];
      const zona_created = await generateZonaEvents(importedItems, confirmedKos);

      res.json({ imported, skipped, zona_created });
    } catch (e) {
      console.error("POST /api/events/import/confirm", e);
      res.status(500).json({
        error: e instanceof Error ? e.message : "Internal server error",
      });
    }
  }
);

export default router;
