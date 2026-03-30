import { pool } from "../db";

export type AccessLevel = "none" | "view" | "edit";

const VALID_LEVELS: readonly AccessLevel[] = ["none", "view", "edit"];

function normalizeAccessLevel(raw: string | null | undefined): AccessLevel {
  if (raw == null) return "none";
  const s = String(raw).trim().toLowerCase();
  if ((VALID_LEVELS as readonly string[]).includes(s)) {
    return s as AccessLevel;
  }
  return "none";
}

/**
 * Livello di accesso effettivo per una pagina del gestionale.
 * Senza riga in `staff_page_permissions` → `"none"` (nessun default permissivo).
 */
export async function getPageAccessLevel(
  staffId: number,
  pageKey: string
): Promise<AccessLevel> {
  if (!Number.isInteger(staffId) || staffId < 1) {
    return "none";
  }
  const key = String(pageKey ?? "").trim();
  if (!key) {
    return "none";
  }

  const result = await pool.query<{ access_level: string }>(
    `SELECT access_level
     FROM staff_page_permissions
     WHERE staff_id = $1 AND page_key = $2
     LIMIT 1`,
    [staffId, key]
  );

  const row = result.rows[0];
  if (!row) {
    return "none";
  }

  return normalizeAccessLevel(row.access_level);
}
