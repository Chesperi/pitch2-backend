import { Router, Request, Response } from "express";
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
} from "../services/eventsImportService";

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

  const external_match_id = String(
    o.external_match_id ?? o.externalMatchId ?? ""
  ).trim();
  if (!external_match_id) return null;

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
  };
}

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

        const extId = parseInt(item.external_match_id, 10);
        if (!Number.isFinite(extId)) {
          skipped++;
          continue;
        }

        const exists = await eventExistsByExternalMatch(extId);
        if (exists) {
          skipped++;
          continue;
        }

        try {
          await insertEventFromImportItem(item);
          imported++;
        } catch (err) {
          console.error("import confirm row", err);
          skipped++;
        }
      }

      res.json({ imported, skipped });
    } catch (e) {
      console.error("POST /api/events/import/confirm", e);
      res.status(500).json({
        error: e instanceof Error ? e.message : "Internal server error",
      });
    }
  }
);

export default router;
