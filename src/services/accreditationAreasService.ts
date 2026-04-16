import { pool } from "../db";

/** Riga logica ruolo → aree (allineata a `accreditation_areas` nel DB). */
export type AccreditationAreasRow = {
  roleCode: string;
  areas: string | null;
};

export type AccreditationAreaMapping = {
  roleCode: string;
  areas: string;
};

export type AccreditationAreaLegend = {
  areaCode: string;
  description: string;
};

/**
 * Deriva `owner_code` per mappa aree accredito dalla squadra di casa (`events.home_team_name_short` o equivalente).
 * Ordine: milan → inter → napoli (substring case-insensitive); altrimenti `lega`.
 */
type OwnerAreasMap = {
  [roleCode: string]: string | null;
};

const ownerAreasCache: Map<string, OwnerAreasMap> = new Map();

/**
 * Nome colonna nel foglio Excel ACCREDITATION_AREAS (modello wide) equivalente a questo `owner_code`.
 * Il DB normalizzato usa invece `owner_code` + `role_code` + `areas` per riga — non si usa SQL dinamico su questi nomi.
 */
export type OwnerAreasColumn = {
  columnName: string;
};

export function mapOwnerCodeToAreasColumn(ownerCode: string): OwnerAreasColumn {
  const o = ownerCode.trim().toLowerCase();
  switch (o) {
    case "lega":
      return { columnName: "areas_lega" };
    case "inter":
      return { columnName: "areas_inter" };
    case "napoli":
      return { columnName: "areas_napoli" };
    case "milan":
      return { columnName: "areas_milan" };
    default:
      return { columnName: "areas_lega" };
  }
}

function normalizeOwnerCacheKey(ownerCode: string): string {
  return ownerCode.trim().toLowerCase();
}

/**
 * Carica tutte le coppie role_code → areas per un owner (una query per owner, poi cache in RAM).
 */
export async function loadAreasForOwner(ownerCode: string): Promise<OwnerAreasMap> {
  const key = normalizeOwnerCacheKey(ownerCode);
  if (ownerAreasCache.has(key)) {
    return ownerAreasCache.get(key)!;
  }

  const result = await pool.query<{ role_code: string; areas: string }>(
    `SELECT role_code, areas
     FROM accreditation_areas
     WHERE lower(owner_code) = $1`,
    [key]
  );

  const map: OwnerAreasMap = {};
  for (const row of result.rows) {
    const rc = row.role_code.trim();
    const areasVal = row.areas?.trim() ? row.areas : null;
    map[rc] = areasVal;
    map[rc.toUpperCase()] = areasVal;
    map[rc.toLowerCase()] = areasVal;
  }

  ownerAreasCache.set(key, map);
  return map;
}

export async function getAreasForOwnerAndRole(
  ownerCode: string | null,
  roleCode: string | null
): Promise<string | null> {
  if (!ownerCode?.trim() || !roleCode?.trim()) {
    return null;
  }
  const map = await loadAreasForOwner(ownerCode);
  const r = roleCode.trim();
  return map[r] ?? map[r.toUpperCase()] ?? map[r.toLowerCase()] ?? null;
}

function normalizeTeamKey(name: string | null | undefined): string | null {
  if (name == null) return null;
  const s = String(name).trim().toLowerCase();
  if (!s) return null;
  return s.replace(/[^a-z0-9]/g, "");
}

export function deriveAccreditationOwnerCodeFromHomeTeam(
  homeTeam: string | null | undefined
): string {
  const key = normalizeTeamKey(homeTeam);
  if (!key) return "lega";

  switch (key) {
    case "atalanta":
      return "atalanta";
    case "bologna":
      return "bologna";
    case "cagliari":
      return "cagliari";
    case "como":
    case "como1907":
      return "como";
    case "cremonese":
      return "cremonese";
    case "empoli":
      return "empoli";
    case "fiorentina":
      return "fiorentina";
    case "frosinone":
      return "frosinone";
    case "genoa":
      return "genoa";
    case "hellasverona":
    case "verona":
      return "hellas_verona";
    case "inter":
    case "fcinter":
      return "inter";
    case "juventus":
      return "juventus";
    case "lazio":
      return "lazio";
    case "lecce":
      return "lecce";
    case "milan":
    case "acmilan":
      return "milan";
    case "monza":
      return "monza";
    case "napoli":
    case "sscnapoli":
      return "napoli";
    case "parma":
      return "parma";
    case "pisa":
      return "pisa";
    case "roma":
    case "asroma":
      return "roma";
    case "salernitana":
      return "salernitana";
    case "sassuolo":
      return "sassuolo";
    case "torino":
      return "torino";
    case "udinese":
      return "udinese";
    case "venezia":
      return "venezia";
    default:
      return "lega";
  }
}

export async function getAccreditationAreasByOwner(ownerCode: string): Promise<{
  mappings: AccreditationAreaMapping[];
  legends: AccreditationAreaLegend[];
}> {
  const normalized = ownerCode.trim().toLowerCase();

  const [mapResult, legendResult] = await Promise.all([
    pool.query<{ role_code: string; areas: string }>(
      `SELECT role_code, areas
       FROM accreditation_areas
       WHERE lower(owner_code) = $1
       ORDER BY role_code ASC`,
      [normalized]
    ),
    pool.query<{ area_code: string; description: string }>(
      `SELECT area_code, description
       FROM accreditation_area_legends
       WHERE lower(owner_code) = $1
       ORDER BY area_code ASC`,
      [normalized]
    ),
  ]);

  return {
    mappings: mapResult.rows.map((r) => ({
      roleCode: r.role_code,
      areas: r.areas,
    })),
    legends: legendResult.rows.map((r) => ({
      areaCode: r.area_code,
      description: r.description,
    })),
  };
}
