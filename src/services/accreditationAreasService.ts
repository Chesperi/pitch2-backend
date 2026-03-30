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

export function deriveAccreditationOwnerCodeFromHomeTeam(
  homeTeam: string | null | undefined
): string {
  if (homeTeam == null) return "lega";
  const s = String(homeTeam).trim().toLowerCase();
  if (!s) return "lega";
  if (s.includes("milan")) return "milan";
  if (s.includes("inter")) return "inter";
  if (s.includes("napoli")) return "napoli";
  return "lega";
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
