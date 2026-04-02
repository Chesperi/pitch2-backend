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
  let processed = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const standard_onsite = getStr(row, "standardonsite") ?? "";
    const standard_cologno = getStr(row, "standardcologno") ?? "";
    const facilities = getStr(row, "facilities");
    const studio = getStr(row, "studio");
    const role_code = getStr(row, "rolecode") ?? "";
    const siteRaw = getStr(row, "site") ?? "";
    const site = siteRaw.trim().toUpperCase();
    const role_location =
      (
        getStr(row, "rolelocation") ??
        getStr(row, "role_location") ??
        site
      )
        .trim()
        .toUpperCase();
    const area_produzione =
      getStr(row, "areaproduzione") ??
      getStr(row, "area_produzione") ??
      "";
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

    const { data: roleOk } = await supabaseAdmin
      .from("roles")
      .select("role_code")
      .eq("role_code", role_code)
      .eq("location", role_location)
      .limit(1)
      .maybeSingle();

    if (!roleOk) {
      console.warn(
        `[warn] Ruolo assente (${role_code} / ${role_location}), riga saltata`
      );
      skipped++;
      continue;
    }

    const payload = {
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
    };

    const { data: existingRows, error: selErr } = await supabaseAdmin
      .from("standard_requirements")
      .select("id")
      .eq("standard_onsite", standard_onsite)
      .eq("standard_cologno", standard_cologno)
      .eq("site", site)
      .eq("role_code", role_code)
      .eq("role_location", role_location)
      .eq("area_produzione", payload.area_produzione)
      .limit(1);

    if (selErr) {
      console.error("[err] select standard_requirements:", selErr.message);
      skipped++;
      continue;
    }

    const existingId = existingRows?.[0]?.id as number | undefined;

    if (existingId != null) {
      const { error: upErr } = await supabaseAdmin
        .from("standard_requirements")
        .update(payload)
        .eq("id", existingId);
      if (upErr) {
        console.error("[err] update standard_requirements:", upErr.message);
        skipped++;
        continue;
      }
      updated++;
    } else {
      const { error: insErr } = await supabaseAdmin
        .from("standard_requirements")
        .insert(payload);
      if (insErr) {
        console.error("[err] insert standard_requirements:", insErr.message);
        skipped++;
        continue;
      }
      inserted++;
    }
    processed++;
  }

  return { processed, inserted, updated, skipped };
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
  const sheet = findSheet(workbook, "STANDARDCOST");
  if (!sheet) {
    console.log("[skip] Foglio STANDARDCOST non trovato");
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
      costexclusive: parseMoney(getRaw(row, "costexclusive")),
      costcoexclusive: parseMoney(getRaw(row, "costcoexclusive")),
      extra: parseMoney(getRaw(row, "extra")),
      notes: getStr(row, "notes"),
      updated_at: new Date().toISOString(),
    });
  }

  const chunkSize = 200;
  let upserted = 0;

  for (let i = 0; i < batch.length; i += chunkSize) {
    const chunk = batch.slice(i, i + chunkSize);
    const { error } = await supabaseAdmin.from("standard_cost").upsert(chunk, {
      onConflict: "service,provider",
    });
    if (error) {
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
      `[standard_requirements] elaborate: ${reqStats.processed} (inseriti: ${reqStats.inserted}, aggiornati: ${reqStats.updated}, saltati: ${reqStats.skipped})`
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
