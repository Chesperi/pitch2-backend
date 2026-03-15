import "dotenv/config";
import { Pool } from "pg";
import * as XLSX from "xlsx";
import * as path from "path";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://prova:@localhost:5432/pitch2";

const pool = new Pool({ connectionString: DATABASE_URL });

const EXCEL_PATH =
  process.env.EXCEL_FILE ||
  path.join(__dirname, "../../data/DB_PITCH_2.xlsx");

type RowRecord = Record<string, unknown>;

function getStr(row: RowRecord, key: string): string | null {
  const k = Object.keys(row).find(
    (x) => x.toLowerCase().trim() === key.toLowerCase()
  );
  if (!k) return null;
  const v = row[k];
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && !Number.isNaN(v)) return String(v);
  return String(v).trim() || null;
}

function getNum(row: RowRecord, key: string): number | null {
  const s = getStr(row, key);
  if (s == null || s === "") return null;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

function getDate(row: RowRecord, key: string): string | null {
  const k = Object.keys(row).find(
    (x) => x.toLowerCase().trim() === key.toLowerCase()
  );
  if (!k) return null;
  const v = row[k];
  if (v == null) return null;
  if (v instanceof Date) {
    return v.toISOString().replace("T", " ").slice(0, 19);
  }
  if (typeof v === "number") {
    // Excel serial date: days since 1899-12-30 (25569 = 1970-01-01)
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().replace("T", " ").slice(0, 19);
  }
  if (typeof v === "string") {
    const t = v.trim();
    return t || null;
  }
  return null;
}

/**
 * Parse ko_italy: accepts "YYYY-MM-DD HH:MM:SS", "HH:MM:SS", Excel Date, or JS Date.
 * If only time is provided, assumes date 2025-01-01 (temporary; adjust when needed).
 */
function parseKoItaly(val: string | null): string | null {
  if (!val || val.trim() === "") return null;
  const trimmed = val.trim();
  // Full datetime: YYYY-MM-DD HH:MM:SS or similar
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed;
  }
  // Time only: HH:MM:SS or HH:MM
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    return `2025-01-01 ${trimmed}`;
  }
  return trimmed;
}

function getBool(row: RowRecord, key: string, defaultVal: boolean): boolean {
  const s = getStr(row, key);
  if (s == null || s === "") return defaultVal;
  return s.toLowerCase() !== "false" && s !== "0";
}

async function importRoles(client: import("pg").PoolClient, sheet: XLSX.WorkSheet) {
  const rows = XLSX.utils.sheet_to_json<RowRecord>(sheet);
  await client.query("TRUNCATE TABLE roles RESTART IDENTITY CASCADE");

  for (const row of rows) {
    const code = getStr(row, "code") ?? "";
    const name = getStr(row, "name") ?? "";
    const location = getStr(row, "location") ?? "";
    const description = getStr(row, "description");
    const active = getBool(row, "active", true);

    await client.query(
      `INSERT INTO roles (code, name, location, description, active)
       VALUES ($1, $2, $3, $4, $5)`,
      [code, name, location, description, active]
    );
  }
  console.log(`[ok] roles: ${rows.length} rows`);
}

async function importStaff(client: import("pg").PoolClient, sheet: XLSX.WorkSheet) {
  const rows = XLSX.utils.sheet_to_json<RowRecord>(sheet);
  await client.query("TRUNCATE TABLE staff RESTART IDENTITY CASCADE");

  for (const row of rows) {
    const surname = getStr(row, "surname") ?? "";
    const name = getStr(row, "name") ?? "";
    const email = getStr(row, "email");
    const phone = getStr(row, "phone");
    const place_of_birth = getStr(row, "place_of_birth");
    const rawDob = getStr(row, "date_of_birth");
    let date_of_birth: string | null = null;
    if (rawDob) {
      // accetta "YYYY-MM-DD" oppure "DD/MM/YYYY"
      const t = rawDob.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
        date_of_birth = t;
      } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) {
        const [dd, mm, yyyy] = t.split("/");
        date_of_birth = `${yyyy}-${mm}-${dd}`;
      } else {
        // fallback: prova a passarlo così com'è, oppure lascialo null
        date_of_birth = null;
      }
    }
    const residential_address = getStr(row, "residential_address");
    const id_number = getStr(row, "id_number") ?? getStr(row, "ID_number");
    const company = getStr(row, "company");
    const default_role_code = getStr(row, "default_role_code");
    const default_location = getStr(row, "default_location");
    const fee = getNum(row, "fee");
    const plates = getStr(row, "plates");
    const user_level = getStr(row, "user_level") ?? "FREELANCE";
    const active = getBool(row, "active", true);
    const notes = getStr(row, "notes");

    await client.query(
      `INSERT INTO staff (
        surname, name, email, phone, place_of_birth, date_of_birth,
        residential_address, id_number, company, default_role_code,
        default_location, fee, plates, user_level, active, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        surname,
        name,
        email,
        phone,
        place_of_birth,
        date_of_birth,
        residential_address,
        id_number,
        company,
        default_role_code,
        default_location,
        fee,
        plates,
        user_level,
        active,
        notes,
      ]
    );
  }
  console.log(`[ok] staff: ${rows.length} rows`);
}

async function importEvents(client: import("pg").PoolClient, sheet: XLSX.WorkSheet) {
  const rows = XLSX.utils.sheet_to_json<RowRecord>(sheet);
  await client.query("TRUNCATE TABLE events RESTART IDENTITY CASCADE");

  for (const row of rows) {
    const category = getStr(row, "category") ?? "";
    const competition_name = getStr(row, "competition_name") ?? "";
    const external_match_id = getNum(row, "external_match_id");
    const competition_code = getStr(row, "competition_code");
    const matchday = getNum(row, "matchday");
    const home_team_name_short = getStr(row, "home_team_name_short");
    const away_team_name_short = getStr(row, "away_team_name_short");
    const venue_name = getStr(row, "venue_name");
    const venue_city = getStr(row, "venue_city");
    const venue_address = getStr(row, "venue_address");
    const koRaw = getDate(row, "ko_italy") ?? getStr(row, "ko_italy");
    const ko_italy = koRaw ? parseKoItaly(koRaw) : null;
    const pre_duration_minutes = getNum(row, "pre_duration_minutes") ?? 0;
    const standard_onsite = getStr(row, "standard_onsite");
    const standard_cologno = getStr(row, "standard_cologno");
    const location = getStr(row, "location");
    const show_name = getStr(row, "show_name");
    const status = getStr(row, "status") ?? "TBD";
    const notes = getStr(row, "notes");

    await client.query(
      `INSERT INTO events (
        external_match_id, category, competition_name, competition_code,
        matchday, home_team_name_short, away_team_name_short,
        venue_name, venue_city, venue_address, ko_italy, pre_duration_minutes,
        standard_onsite, standard_cologno, location, show_name, status, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        external_match_id,
        category,
        competition_name,
        competition_code,
        matchday,
        home_team_name_short,
        away_team_name_short,
        venue_name,
        venue_city,
        venue_address,
        ko_italy,
        pre_duration_minutes,
        standard_onsite,
        standard_cologno,
        location,
        show_name,
        status,
        notes,
      ]
    );
  }
  console.log(`[ok] events: ${rows.length} rows`);
}

async function main() {
  const workbook = XLSX.readFile(EXCEL_PATH, { cellDates: true });
  const client = await pool.connect();

  try {
    // ROLES
    const rolesSheet = workbook.Sheets["ROLES"];
    if (!rolesSheet) throw new Error("Sheet ROLES not found");
    await client.query("BEGIN");
    await importRoles(client, rolesSheet);
    await client.query("COMMIT");

    // STAFF
    const staffSheet = workbook.Sheets["STAFF"];
    if (!staffSheet) throw new Error("Sheet STAFF not found");
    await client.query("BEGIN");
    await importStaff(client, staffSheet);
    await client.query("COMMIT");

    // EVENTS
    const eventsSheet = workbook.Sheets["EVENTS"];
    if (!eventsSheet) throw new Error("Sheet EVENTS not found");
    await client.query("BEGIN");
    await importEvents(client, eventsSheet);
    await client.query("COMMIT");

    console.log("Import complete.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
