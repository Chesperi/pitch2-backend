import { pool } from "../db";

export interface Club {
  id: number;
  ownerCode: string;
  displayName: string;
  logoUrl: string | null;
}

export async function getClubLogoUrl(ownerCode: string): Promise<string | null> {
  const normalized = String(ownerCode ?? "").trim().toLowerCase();
  if (!normalized) return null;

  const result = await pool.query<{ logo_url: string | null }>(
    `SELECT logo_url
     FROM clubs
     WHERE lower(owner_code) = $1
     LIMIT 1`,
    [normalized]
  );

  const logoUrl = result.rows[0]?.logo_url ?? null;
  return logoUrl && logoUrl.trim() !== "" ? logoUrl.trim() : null;
}

export async function getAllClubs(): Promise<Club[]> {
  const result = await pool.query<{
    id: number;
    owner_code: string;
    display_name: string;
    logo_url: string | null;
  }>(
    `SELECT id, owner_code, display_name, logo_url
     FROM clubs
     ORDER BY display_name ASC, owner_code ASC`
  );

  return result.rows.map((row) => ({
    id: row.id,
    ownerCode: row.owner_code,
    displayName: row.display_name,
    logoUrl: row.logo_url,
  }));
}
