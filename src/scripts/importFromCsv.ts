import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://prova:@localhost:5432/pitch2";

const pool = new Pool({ connectionString: DATABASE_URL });
const DATA_DIR = path.join(__dirname, "../../data");

/**
 * Simple CSV line parser - handles quoted fields containing commas.
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parse ko_italy: accepts "YYYY-MM-DD HH:MM:SS" or "HH:MM:SS".
 * If only time is provided, assumes date 2025-01-01 (temporary; adjust when needed).
 */
function parseKoItaly(val: string): string | null {
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

function getColumnIndex(headers: string[], name: string): number {
  const idx = headers.findIndex(
    (h) => h.toLowerCase().trim() === name.toLowerCase()
  );
  if (idx === -1) throw new Error(`Column not found: ${name}`);
  return idx;
}

function getVal(row: string[], idx: number): string | null {
  if (idx < 0 || idx >= row.length) return null;
  const v = row[idx]?.trim();
  return v === "" ? null : v;
}

async function importRoles(client: import("pg").PoolClient) {
  const filePath = path.join(DATA_DIR, "roles.csv");
  if (!fs.existsSync(filePath)) {
    console.log("[skip] roles.csv not found");
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    console.log("[skip] roles.csv empty or no data rows");
    return;
  }

  const headers = parseCSVLine(lines[0]);
  const codeIdx = getColumnIndex(headers, "code");
  const nameIdx = getColumnIndex(headers, "name");
  const locationIdx = getColumnIndex(headers, "location");
  const descIdx = headers.findIndex((h) => h.toLowerCase().trim() === "description");
  const activeIdx = headers.findIndex((h) => h.toLowerCase().trim() === "active");

  await client.query("TRUNCATE TABLE roles RESTART IDENTITY CASCADE");

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    const code = getVal(row, codeIdx) ?? "";
    const name = getVal(row, nameIdx) ?? "";
    const location = getVal(row, locationIdx) ?? "";
    const description = descIdx >= 0 ? getVal(row, descIdx) : null;
    const active =
      activeIdx >= 0 && getVal(row, activeIdx) !== null
        ? String(getVal(row, activeIdx)).toLowerCase() !== "false"
        : true;

    await client.query(
      `INSERT INTO roles (code, name, location, description, active)
       VALUES ($1, $2, $3, $4, $5)`,
      [code, name, location, description, active]
    );
  }
  console.log(`[ok] roles: ${lines.length - 1} rows`);
}

async function importStaff(client: import("pg").PoolClient) {
  const filePath = path.join(DATA_DIR, "staff.csv");
  if (!fs.existsSync(filePath)) {
    console.log("[skip] staff.csv not found");
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    console.log("[skip] staff.csv empty or no data rows");
    return;
  }

  const headers = parseCSVLine(lines[0]);

  await client.query("TRUNCATE TABLE staff RESTART IDENTITY CASCADE");

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    const col = (name: string) => getVal(row, getColumnIndex(headers, name)) ?? "";
    const colOpt = (name: string) => {
      const idx = headers.findIndex((h) => h.toLowerCase().trim() === name.toLowerCase());
      return idx >= 0 ? getVal(row, idx) : null;
    };
    const surname = col("surname");
    const name = col("name");
    const email = colOpt("email");
    const phone = colOpt("phone");
    const place_of_birth = colOpt("place_of_birth");
    const date_of_birth = colOpt("date_of_birth");
    const residential_address = colOpt("residential_address");
    const id_number = colOpt("id_number") ?? colOpt("ID_number");
    const company = colOpt("company");
    const default_role_code = colOpt("default_role_code");
    const default_location = colOpt("default_location");
    const feeStr = colOpt("fee");
    const fee = feeStr ? parseInt(feeStr, 10) : null;
    const plates = colOpt("plates");
    const user_level = colOpt("user_level") ?? "FREELANCE";
    const active =
      colOpt("active") === null
        ? true
        : String(colOpt("active")).toLowerCase() !== "false";
    const notes = colOpt("notes");

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
        fee != null && !Number.isNaN(fee) ? fee : null,
        plates,
        user_level,
        active,
        notes,
      ]
    );
  }
  console.log(`[ok] staff: ${lines.length - 1} rows`);
}

async function importEvents(client: import("pg").PoolClient) {
  const filePath = path.join(DATA_DIR, "events.csv");
  if (!fs.existsSync(filePath)) {
    console.log("[skip] events.csv not found");
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    console.log("[skip] events.csv empty or no data rows");
    return;
  }

  const headers = parseCSVLine(lines[0]);

  await client.query("TRUNCATE TABLE events RESTART IDENTITY CASCADE");

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    const colOpt = (name: string) => {
      const idx = headers.findIndex((h) => h.toLowerCase().trim() === name.toLowerCase());
      return idx >= 0 ? getVal(row, idx) : null;
    };
    const category = colOpt("category") ?? "";
    const competition_name = colOpt("competition_name") ?? "";
    const external_match_id = colOpt("external_match_id");
    const extId = external_match_id ? parseInt(external_match_id, 10) : null;
    const competition_code = colOpt("competition_code");
    const matchdayStr = colOpt("matchday");
    const matchday = matchdayStr ? parseInt(matchdayStr, 10) : null;
    const home_team_name_short = colOpt("home_team_name_short");
    const away_team_name_short = colOpt("away_team_name_short");
    const venue_name = colOpt("venue_name");
    const venue_city = colOpt("venue_city");
    const venue_address = colOpt("venue_address");
    const koRaw = colOpt("ko_italy");
    const ko_italy = koRaw ? parseKoItaly(koRaw) : null;
    const preStr = colOpt("pre_duration_minutes");
    const pre_duration_minutes = preStr ? parseInt(preStr, 10) : 0;
    const standard_onsite = colOpt("standard_onsite");
    const standard_cologno = colOpt("standard_cologno");
    const location = colOpt("location");
    const show_name = colOpt("show_name");
    const status = colOpt("status") ?? "TBD";
    const notes = colOpt("notes");

    await client.query(
      `INSERT INTO events (
        external_match_id, category, competition_name, competition_code,
        matchday, home_team_name_short, away_team_name_short,
        venue_name, venue_city, venue_address, ko_italy, pre_duration_minutes,
        standard_onsite, standard_cologno, location, show_name, status, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        extId != null && !Number.isNaN(extId) ? extId : null,
        category,
        competition_name,
        competition_code,
        matchday != null && !Number.isNaN(matchday) ? matchday : null,
        home_team_name_short,
        away_team_name_short,
        venue_name,
        venue_city,
        venue_address,
        ko_italy,
        Number.isNaN(pre_duration_minutes) ? 0 : pre_duration_minutes,
        standard_onsite,
        standard_cologno,
        location,
        show_name,
        status,
        notes,
      ]
    );
  }
  console.log(`[ok] events: ${lines.length - 1} rows`);
}

async function main() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await importRoles(client);
    await importStaff(client);
    await importEvents(client);
    await client.query("COMMIT");
    console.log("Import complete.");
  } catch (err) {
    await client.query("ROLLBACK");
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
