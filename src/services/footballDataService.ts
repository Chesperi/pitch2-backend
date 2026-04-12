import type { FootballDataMatch, ImportPreviewItem } from "../types";
import { applyRulesToEvent } from "./eventRulesService";

export const SUPPORTED_COMPETITIONS: Record<string, string> = {
  SA: "Serie A",
  SB: "Serie B",
  PD: "LaLiga",
};

const BASE_URL = "https://api.football-data.org/v4";
const ROME_TZ = "Europe/Rome";

type ApiTeam = { name?: string; shortName?: string };

interface ApiMatch {
  id: number;
  utcDate: string;
  homeTeam?: ApiTeam;
  awayTeam?: ApiTeam;
  matchday?: number;
  venue?: string | { name?: string } | null;
  competition?: { name?: string; code?: string };
}

function getFootballDataApiKey(): string {
  const key = process.env.FOOTBALL_DATA_API_KEY?.trim();
  if (!key) {
    throw new Error("FOOTBALL_DATA_API_KEY is not set");
  }
  return key;
}

/** ISO 8601 con offset Europe/Rome (es. 2024-06-15T14:00:00+02:00). */
export function utcDateToKoItalyIso(utcIso: string): string {
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) {
    return utcIso;
  }
  const wall = new Intl.DateTimeFormat("sv-SE", {
    timeZone: ROME_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
  const offParts = new Intl.DateTimeFormat("en-US", {
    timeZone: ROME_TZ,
    timeZoneName: "longOffset",
  }).formatToParts(d);
  const tzRaw =
    offParts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const suffix = tzRaw.startsWith("GMT") ? tzRaw.slice(3) : "+00:00";
  const [datePart, timePart] = wall.split(" ");
  return `${datePart}T${timePart}${suffix}`;
}

function normalizeTeam(t: ApiTeam | undefined): {
  name: string;
  shortName: string;
} {
  const name = t?.name?.trim() || "";
  const shortName = t?.shortName?.trim() || "";
  const display = shortName || name || "—";
  return { name: name || display, shortName: display };
}

function venueFromApi(venue: ApiMatch["venue"]): string | null {
  if (venue == null) return null;
  if (typeof venue === "string") {
    const v = venue.trim();
    return v === "" ? null : v;
  }
  if (typeof venue === "object" && venue.name != null) {
    const v = String(venue.name).trim();
    return v === "" ? null : v;
  }
  return null;
}

function mapApiMatch(
  m: ApiMatch,
  competitionCode: string,
  competitionLabel: string
): FootballDataMatch {
  const compName =
    m.competition?.name?.trim() || competitionLabel;
  const compCode =
    m.competition?.code?.trim() || competitionCode;
  return {
    id: Number(m.id),
    utcDate: m.utcDate,
    homeTeam: normalizeTeam(m.homeTeam),
    awayTeam: normalizeTeam(m.awayTeam),
    matchday: Number(m.matchday ?? 0),
    venue: venueFromApi(m.venue),
    competition: { name: compName, code: compCode },
  };
}

export async function fetchMatchesByCompetition(params: {
  competitionCode: "SA" | "SB" | "PD";
  dateFrom: string;
  dateTo: string;
}): Promise<FootballDataMatch[]> {
  const { competitionCode, dateFrom, dateTo } = params;
  const competitionLabel = SUPPORTED_COMPETITIONS[competitionCode];
  if (!competitionLabel) {
    throw new Error(`Unsupported competition: ${competitionCode}`);
  }
  const key = getFootballDataApiKey();
  const url = new URL(
    `${BASE_URL}/competitions/${encodeURIComponent(competitionCode)}/matches`
  );
  url.searchParams.set("dateFrom", dateFrom);
  url.searchParams.set("dateTo", dateTo);
  const res = await fetch(url.toString(), {
    headers: { "X-Auth-Token": key },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `football-data.org ${res.status}: ${text.slice(0, 500)}`
    );
  }
  const data = (await res.json()) as { matches?: ApiMatch[] };
  const raw = data.matches ?? [];
  return raw.map((m) =>
    mapApiMatch(m, competitionCode, competitionLabel)
  );
}

export async function buildImportPreview(params: {
  matches: FootballDataMatch[];
  existingExternalIds: string[];
}): Promise<ImportPreviewItem[]> {
  const existing = new Set(
    params.existingExternalIds.map((id) => String(id))
  );
  const items: ImportPreviewItem[] = [];
  for (const m of params.matches) {
    const external_match_id = String(m.id);
    const ko_italy = utcDateToKoItalyIso(m.utcDate);
    const competition_name = m.competition.name;
    const suggested_fields = await applyRulesToEvent({
      competition_name,
      ko_italy,
    });
    items.push({
      external_match_id,
      competition_name,
      competition_code: m.competition.code,
      matchday: m.matchday,
      home_team: m.homeTeam.shortName || m.homeTeam.name,
      away_team: m.awayTeam.shortName || m.awayTeam.name,
      ko_utc: m.utcDate,
      ko_italy,
      venue: m.venue,
      already_exists: existing.has(external_match_id),
      suggested_fields,
    });
  }
  return items;
}
