import "dotenv/config";
import * as path from "path";
import * as XLSX from "xlsx";
import { supabaseAdmin } from "../src/supabaseClient";

const EXCEL_PATH =
  process.env.STANDARD_DATA_EXCEL?.trim() ||
  process.env.EXCEL_FILE?.trim() ||
  path.join(__dirname, "../data/DB_PITCH_2_def.xlsx");

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

function getRaw(row: RowRecord, key: string): unknown {
  const k = Object.keys(row).find(
    (x) => x.toLowerCase().trim() === key.toLowerCase()
  );
  return k != null ? row[k] : undefined;
}

function parseMoney(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (s === "" || s === "-") return null;
  const n = parseFloat(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function findSheet(
  workbook: XLSX.WorkBook,
  canonicalName: string
): XLSX.WorkSheet | null {
  const want = canonicalName.toLowerCase();
  const name = workbook.SheetNames.find((n) => n.toLowerCase() === want);
  if (!name) return null;
  return workbook.Sheets[name] ?? null;
}

function findSheetFirst(
  workbook: XLSX.WorkBook,
  names: string[]
): XLSX.WorkSheet | null {
  for (const n of names) {
    const s = findSheet(workbook, n);
    if (s) return s;
  }
  return null;
}

/** Prova più nomi colonna (Excel con/senza underscore). */
function strFromRow(row: RowRecord, ...keys: string[]): string {
  for (const key of keys) {
    const v = getStr(row, key);
    if (v != null && v !== "") return v;
  }
  return "";
}

async function importStandardRequirements(): Promise<{
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
}> {
  if (!supabaseAdmin) {
    throw new Error("Supabase non configurato (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
  }

  const workbook = XLSX.readFile(EXCEL_PATH, { cellDates: true });
  const sheet = findSheet(workbook, "STANDARD_REQUIREMENTS");
  if (!sheet) {
    console.log("[skip] Foglio STANDARD_REQUIREMENTS non trovato");
    return { processed: 0, inserted: 0, updated: 0, skipped: 0 };
  }

  const rows = XLSX.utils.sheet_to_json<RowRecord>(sheet);
  const toInsert: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const row of rows) {
    const standard_onsite = strFromRow(
      row,
      "standardonsite",
      "standard_onsite"
    );
    const standard_cologno = strFromRow(
      row,
      "standardcologno",
      "standard_cologno"
    );
    const facilities = getStr(row, "facilities");
    const studio = getStr(row, "studio");
    const role_code = strFromRow(row, "rolecode", "role_code");
    const siteRaw = getStr(row, "site") ?? "";
    const site = siteRaw.trim().toUpperCase();
    const role_location = site;
    let area_produzione = strFromRow(row, "areaproduzione", "area_produzione");
    if (!area_produzione.trim()) {
      area_produzione = standard_cologno;
    }
    const quantityStr = getStr(row, "quantity");
    const quantity = Math.max(
      1,
      quantityStr != null && quantityStr !== ""
        ? parseInt(quantityStr, 10) || 1
        : 1
    );
    const notes = getStr(row, "notes");

    if (!standard_onsite || !standard_cologno || !role_code || !site) {
      skipped++;
      continue;
    }

    toInsert.push({
      standard_onsite,
      standard_cologno,
      facilities: facilities ?? null,
      studio: studio ?? null,
      role_code,
      role_location,
      site,
      area_produzione: area_produzione.trim(),
      quantity,
      notes: notes ?? null,
    });
  }

  let inserted = 0;
  const chunkSize = 100;
  for (let i = 0; i < toInsert.length; i += chunkSize) {
    const chunk = toInsert.slice(i, i + chunkSize);
    const { error } = await supabaseAdmin
      .from("standard_requirements")
      .insert(chunk);
    if (error) {
      console.error("[err] insert standard_requirements (chunk):", error.message);
      throw error;
    }
    inserted += chunk.length;
  }

  const processed = inserted;
  return { processed, inserted, updated: 0, skipped };
}

async function importStandardCost(): Promise<{
  processed: number;
  upserted: number;
  skipped: number;
}> {
  if (!supabaseAdmin) {
    throw new Error("Supabase non configurato (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
  }

  const workbook = XLSX.readFile(EXCEL_PATH, { cellDates: true });
  const sheet = findSheetFirst(workbook, ["STANDARDCOST", "STANDARD_COST"]);
  if (!sheet) {
    console.log("[skip] Foglio STANDARDCOST / STANDARD_COST non trovato");
    return { processed: 0, upserted: 0, skipped: 0 };
  }

  const rows = XLSX.utils.sheet_to_json<RowRecord>(sheet);
  const batch: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const row of rows) {
    const service = getStr(row, "service") ?? "";
    const provider = getStr(row, "provider") ?? "";
    if (!service || !provider) {
      skipped++;
      continue;
    }

    batch.push({
      service,
      provider,
      costexclusive: parseMoney(
        getRaw(row, "costexclusive") ?? getRaw(row, "cost_exclusive")
      ),
      costcoexclusive: parseMoney(
        getRaw(row, "costcoexclusive") ?? getRaw(row, "cost_coexclusive")
      ),
      extra: parseMoney(getRaw(row, "extra")),
      notes: getStr(row, "notes"),
      updated_at: new Date().toISOString(),
    });
  }

  const chunkSize = 200;
  let upserted = 0;
  let usedFallback = false;

  for (let i = 0; i < batch.length; i += chunkSize) {
    const chunk = batch.slice(i, i + chunkSize);
    const { error } = await supabaseAdmin.from("standard_cost").upsert(chunk, {
      onConflict: "service,provider",
    });
    if (error) {
      const needFallback =
        error.code === "42P10" ||
        /ON CONFLICT|unique or exclusion constraint/i.test(error.message);
      if (needFallback && !usedFallback) {
        usedFallback = true;
        console.warn(
          "[warn] standard_cost: nessun UNIQUE(service,provider) su DB — uso insert/update per riga"
        );
        for (const rec of batch) {
          const { service, provider, ...rest } = rec as {
            service: string;
            provider: string;
            [k: string]: unknown;
          };
          const { data: existing } = await supabaseAdmin
            .from("standard_cost")
            .select("id")
            .eq("service", service)
            .eq("provider", provider)
            .limit(1);
          const id = existing?.[0]?.id;
          if (id != null) {
            const { error: u } = await supabaseAdmin
              .from("standard_cost")
              .update(rest)
              .eq("id", id);
            if (u) throw u;
          } else {
            const { error: ins } = await supabaseAdmin
              .from("standard_cost")
              .insert(rec);
            if (ins) throw ins;
          }
          upserted++;
        }
        break;
      }
      console.error("[err] upsert standard_cost:", error.message);
      throw error;
    }
    upserted += chunk.length;
  }

  return { processed: batch.length, upserted, skipped };
}

async function main() {
  console.log(`File Excel: ${EXCEL_PATH}`);

  try {
    const reqStats = await importStandardRequirements();
    console.log(
      `[standard_requirements] inseriti: ${reqStats.inserted}, saltati: ${reqStats.skipped} (solo INSERT, nessun controllo su roles)`
    );

    const costStats = await importStandardCost();
    console.log(
      `[standard_cost] righe foglio valide: ${costStats.processed}, upsert: ${costStats.upserted}, saltate (mancano service/provider): ${costStats.skipped}`
    );
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}

void main();
