import { Router, Request, Response } from "express";
import PDFDocument from "pdfkit";
import { pool } from "../db";
import { listAccreditationsByEventId } from "../services/accreditationsService";
import {
  deriveAccreditationOwnerCodeFromHomeTeam,
  getAccreditationAreasByOwner,
  getAreasForOwnerAndRole,
  loadAreasForOwner,
  type AccreditationAreaLegend,
} from "../services/accreditationAreasService";
import { getClubLogoUrl } from "../services/clubsService";

const router = Router();

const MARGIN = 32;
const PAGE_W = 841.89;
const USABLE_W = PAGE_W - MARGIN * 2;
const RIGHT_EDGE = MARGIN + USABLE_W;
const HEADER_Y = 40;
const LOGO_W = 56;
const PAGE_BREAK_Y = 560;
const LEGEND_PAGE_THRESHOLD = 520;
const SUPABASE_ASSETS_BASE_URL =
  "https://rpjwildueyckkpektfgn.supabase.co/storage/v1/object/public/pitch-assets";
const DAZN_WHITE_LOGO_URL = `${SUPABASE_ASSETS_BASE_URL}/fixed/logo-dazn-white.jpeg`;
const SERIE_A_LOGO_URL = `${SUPABASE_ASSETS_BASE_URL}/fixed/logo-Serie-A.jpeg`;
const OSCINE_RG_URL = `${SUPABASE_ASSETS_BASE_URL}/fixed/DAZN_Oscine_Rg.ttf`;
const OSCINE_BD_URL = `${SUPABASE_ASSETS_BASE_URL}/fixed/DAZN_Oscine_Bd.ttf`;

const COL_X = {
  company: MARGIN,
  surname: MARGIN + 70,
  name: MARGIN + 145,
  placeOfBirth: MARGIN + 220,
  dateOfBirth: MARGIN + 325,
  areas: MARGIN + 410,
  role: MARGIN + 470,
  plates: MARGIN + 550,
  notes: MARGIN + 620,
} as const;

const COL_W = {
  company: 70,
  surname: 75,
  name: 75,
  placeOfBirth: 105,
  dateOfBirth: 85,
  areas: 60,
  role: 80,
  plates: 70,
  notes: RIGHT_EDGE - (MARGIN + 620),
} as const;

const HEADER_ROW_H = 18;
const DATA_ROW_H = 18;

type PdfEventRow = {
  id: string;
  date: unknown;
  ko_italy_time: unknown;
  matchday: number | null;
  home_team_name_short: string | null;
  away_team_name_short: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_address: string | null;
  facilities: string | null;
  competition_name: string | null;
};

function formatPdfDateShort(date: unknown): string {
  const d = date != null ? String(date).slice(0, 10) : "";
  const parsed = d ? new Date(`${d}T12:00:00`) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return d;
  const yy = String(parsed.getFullYear()).slice(-2);
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  return `${dd}/${mm}/${yy}`;
}

function formatPdfDateLong(date: unknown): string {
  const d = date != null ? String(date).slice(0, 10) : "";
  const parsed = d ? new Date(`${d}T12:00:00`) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return d;
  const yyyy = String(parsed.getFullYear());
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  return `${dd}-${mm}-${yyyy}`;
}

function formatPdfTime(koTime: unknown): string {
  const t = koTime != null ? String(koTime).trim().slice(0, 5) : "";
  return t || "--:--";
}

function formatPdfHeaderDateTime(date: unknown, koTime: unknown): string {
  return `${formatPdfDateShort(date)} - ${formatPdfTime(koTime)} h`;
}

function toSafeFileToken(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "NA";
  return (
    raw
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase() || "NA"
  );
}

function clubLogoUrl(ownerCode: string): string {
  return `${SUPABASE_ASSETS_BASE_URL}/club/${ownerCode}_loghi.png`;
}

async function fetchFontBuffer(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const arr = await response.arrayBuffer();
    return Buffer.from(arr);
  } catch {
    return null;
  }
}

async function fetchImageBufferFromUrl(url: string | null): Promise<Buffer | null> {
  const safeUrl = String(url ?? "").trim();
  if (!safeUrl) return null;
  try {
    const response = await fetch(safeUrl);
    if (!response.ok) return null;
    const arr = await response.arrayBuffer();
    return Buffer.from(arr);
  } catch {
    return null;
  }
}

async function resolveHeaderLogos(row: PdfEventRow): Promise<{
  daznLogo: Buffer | null;
  homeLogo: Buffer | null;
  awayLogo: Buffer | null;
  competitionLogo: Buffer | null;
}> {
  const homeOwnerCode = deriveAccreditationOwnerCodeFromHomeTeam(
    row.home_team_name_short
  );
  const awayOwnerCode = deriveAccreditationOwnerCodeFromHomeTeam(
    row.away_team_name_short
  );
  const [homeLogoUrlRaw, awayLogoUrlRaw] = await Promise.all([
    getClubLogoUrl(homeOwnerCode),
    getClubLogoUrl(awayOwnerCode),
  ]);
  const homeLogoUrl = homeLogoUrlRaw || clubLogoUrl(homeOwnerCode);
  const awayLogoUrl = awayLogoUrlRaw || clubLogoUrl(awayOwnerCode || "lega");

  const [daznLogo, homeLogo, awayLogo, competitionLogo] = await Promise.all([
    fetchImageBufferFromUrl(DAZN_WHITE_LOGO_URL),
    fetchImageBufferFromUrl(homeLogoUrl),
    fetchImageBufferFromUrl(awayLogoUrl),
    fetchImageBufferFromUrl(SERIE_A_LOGO_URL),
  ]);

  return { daznLogo, homeLogo, awayLogo, competitionLogo };
}

function drawHeader(
  doc: PDFKit.PDFDocument,
  row: PdfEventRow,
  ownerCode: string,
  logos: {
    daznLogo: Buffer | null;
    homeLogo: Buffer | null;
    awayLogo: Buffer | null;
    competitionLogo: Buffer | null;
  }
): void {
  let y = HEADER_Y;
  doc.font("OscineBd").fontSize(13).fillColor("#000000");
  doc.text(row.competition_name?.trim() || "DAZN & SERIE A 2025/26", MARGIN, y, {
    width: USABLE_W,
    align: "center",
  });
  y += 22;

  const logoY = y;
  const leftX = MARGIN + 10;
  const homeX = MARGIN + USABLE_W * 0.35 - LOGO_W / 2;
  const awayX = MARGIN + USABLE_W * 0.65 - LOGO_W / 2;
  const rightX = RIGHT_EDGE - LOGO_W - 10;
  for (const entry of [
    { buf: logos.daznLogo, x: leftX },
    { buf: logos.homeLogo, x: homeX },
    { buf: logos.awayLogo, x: awayX },
    { buf: logos.competitionLogo, x: rightX },
  ]) {
    if (!entry.buf) continue;
    try {
      doc.image(entry.buf, entry.x, logoY, { width: LOGO_W });
    } catch {
      // ignore invalid image
    }
  }
  y += LOGO_W + 10;

  doc.font("OscineBd").fontSize(14);
  doc.text(
    `${row.home_team_name_short ?? ""} - ${row.away_team_name_short ?? ""}`,
    MARGIN,
    y,
    { width: USABLE_W, align: "center" }
  );
  y += 16;

  doc.font("OscineRg").fontSize(10);
  doc.text(
    [row.venue_name, row.venue_city].filter(Boolean).join(", ") ||
      (row.facilities ?? ""),
    MARGIN,
    y,
    { width: USABLE_W, align: "center" }
  );
  y += 13;
  doc.text(row.venue_address ?? "", MARGIN, y, { width: USABLE_W, align: "center" });
  y += 13;
  doc.text(formatPdfHeaderDateTime(row.date, row.ko_italy_time), MARGIN, y, {
    width: USABLE_W,
    align: "center",
  });
  y += 13;
  doc.text(`MD ${row.matchday ?? "-"}`, MARGIN, y, { width: USABLE_W, align: "center" });
  y += 14;
  doc.font("OscineBd").fontSize(13).text("LISTA PERSONALE DA ACCREDITARE", MARGIN, y, {
    width: USABLE_W,
    align: "center",
  });

  const lineY = y + 12;
  doc
    .moveTo(MARGIN, lineY)
    .lineTo(RIGHT_EDGE, lineY)
    .strokeColor("#000000")
    .lineWidth(0.5)
    .stroke();

  doc.y = lineY + 8;
}

function drawTableHeader(doc: PDFKit.PDFDocument, atY: number): number {
  doc.font("OscineBd").fontSize(8).fillColor("#000000");
  const labels = [
    { k: "company", t: "AZIENDA" },
    { k: "surname", t: "COGNOME" },
    { k: "name", t: "NOME" },
    { k: "placeOfBirth", t: "LUOGO DI NASC." },
    { k: "dateOfBirth", t: "DATA NASCITA" },
    { k: "areas", t: "AREA" },
    { k: "role", t: "RUOLO" },
    { k: "plates", t: "VETTURA" },
    { k: "notes", t: "NOTE" },
  ] as const;
  for (const col of labels) {
    const x = COL_X[col.k];
    const w = COL_W[col.k];
    doc.rect(x, atY, w, HEADER_ROW_H).lineWidth(0.4).stroke("#000000");
    doc.text(col.t, x + 2, atY + 5, { width: w - 4, align: "left" });
  }
  doc.font("OscineRg");
  return atY + HEADER_ROW_H;
}

function drawAreaLegend(
  doc: PDFKit.PDFDocument,
  legends: AccreditationAreaLegend[],
  row: PdfEventRow,
  ownerCode: string,
  tableEndY: number,
  logos: {
    daznLogo: Buffer | null;
    homeLogo: Buffer | null;
    awayLogo: Buffer | null;
  }
): void {
  if (legends.length === 0) return;

  const titleH = 16;
  const rowH = 12;
  const blockH = titleH + legends.length * rowH + 24;
  let ly = tableEndY + 16;

  if (ly + blockH > LEGEND_PAGE_THRESHOLD) {
    doc.addPage();
    drawHeader(doc, row, ownerCode, logos);
    ly = doc.y + 8;
  }

  doc.font("OscineBd").fontSize(9).fillColor("#000000");
  doc.text("AREE ACCREDITO:", MARGIN, ly, { width: USABLE_W });
  ly += titleH;

  doc.font("OscineRg").fontSize(8);

  for (const leg of legends) {
    if (ly + rowH > PAGE_BREAK_Y) {
      doc.addPage();
      drawHeader(doc, row, ownerCode, logos);
      ly = doc.y + 8;
      doc.font("OscineBd").fontSize(9);
      doc.text("AREE ACCREDITO: (segue)", MARGIN, ly, { width: USABLE_W });
      ly += titleH - 4;
      doc.font("OscineRg").fontSize(8);
    }

    doc.text(`ZONA ${String(leg.areaCode)}: ${String(leg.description)}`, MARGIN, ly, {
      width: USABLE_W,
    });
    ly += rowH;
  }

  doc.y = ly;
}

router.get("/:eventId/pdf", async (req: Request, res: Response) => {
  const eventId = String(req.params.eventId ?? "").trim();
  if (!eventId) {
    res.status(400).json({ error: "Invalid eventId" });
    return;
  }

  let pdfStarted = false;

  try {
    const ev = await pool.query<{
      id: string;
      date: unknown;
      ko_italy_time: unknown;
      matchday: number | null;
      home_team_name_short: string | null;
      away_team_name_short: string | null;
      venue_name: string | null;
      venue_city: string | null;
      venue_address: string | null;
      facilities: string | null;
      competition_name: string | null;
    }>(
      `SELECT id, date, ko_italy_time, matchday, home_team_name_short, away_team_name_short, venue_name, venue_city, venue_address, facilities, competition_name
       FROM events
       WHERE id = $1`,
      [eventId]
    );

    if (ev.rows.length === 0) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const row = ev.rows[0];
    const ownerCode = deriveAccreditationOwnerCodeFromHomeTeam(
      row.home_team_name_short
    );

    const accreditations = await listAccreditationsByEventId(eventId);
    await loadAreasForOwner(ownerCode);
    const { legends: areaLegends } =
      await getAccreditationAreasByOwner(ownerCode);

    const staffRows = await Promise.all(
      accreditations.map(async (a) => {
        const effectiveRoleCode = a.roleCode ?? a.staffDefaultRoleCode ?? null;

        const hasManualAreas =
          a.areas != null && String(a.areas).trim() !== "";
        let finalAreas: string | null = hasManualAreas ? a.areas : null;
        if (!finalAreas) {
          const derived = await getAreasForOwnerAndRole(
            ownerCode,
            effectiveRoleCode
          );
          finalAreas =
            derived != null && derived.trim() !== "" ? derived.trim() : null;
        }

        return {
          company: a.staffCompany,
          surname: a.staffSurname,
          name: a.staffName,
          placeOfBirth: a.staffPlaceOfBirth,
          dateOfBirth: a.staffDateOfBirth,
          areas: finalAreas ?? "",
          roleCode: effectiveRoleCode,
          plates: a.plates ?? a.staffPlates ?? null,
          notes: a.notes ?? a.staffNotes ?? null,
        };
      })
    );

    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: MARGIN });
    const [oscineRg, oscineBd] = await Promise.all([
      fetchFontBuffer(OSCINE_RG_URL),
      fetchFontBuffer(OSCINE_BD_URL),
    ]);
    if (oscineRg) doc.registerFont("OscineRg", oscineRg);
    if (oscineBd) doc.registerFont("OscineBd", oscineBd);
    if (!oscineRg) doc.registerFont("OscineRg", "Helvetica");
    if (!oscineBd) doc.registerFont("OscineBd", "Helvetica-Bold");
    res.setHeader("Content-Type", "application/pdf");
    const fileName = `MD${row.matchday ?? "-"}_ACCREDITI_${toSafeFileToken(
      row.home_team_name_short
    )}_v_${toSafeFileToken(row.away_team_name_short)}_${formatPdfDateLong(row.date)}.pdf`;
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );
    doc.pipe(res);
    pdfStarted = true;

    const logos = await resolveHeaderLogos(row);
    drawHeader(doc, row, ownerCode, logos);

    let y = drawTableHeader(doc, doc.y);

    staffRows.forEach((s) => {
      if (y > PAGE_BREAK_Y) {
        doc.addPage();
        drawHeader(doc, row, ownerCode, logos);
        y = drawTableHeader(doc, doc.y);
      }

      const rowHeight = DATA_ROW_H;
      doc.font("OscineRg").fontSize(8).fillColor("#000000");

      const dob = s.dateOfBirth ?? "";
      doc.text(s.company ?? "", COL_X.company, y, { width: COL_W.company });
      doc.text(s.surname ?? "", COL_X.surname, y, { width: COL_W.surname });
      doc.text(s.name ?? "", COL_X.name, y, { width: COL_W.name });
      doc.text(s.placeOfBirth ?? "", COL_X.placeOfBirth, y, {
        width: COL_W.placeOfBirth,
      });
      doc.text(dob, COL_X.dateOfBirth, y, { width: COL_W.dateOfBirth });

      const values: Record<keyof typeof COL_X, string> = {
        company: s.company ?? "",
        surname: s.surname ?? "",
        name: s.name ?? "",
        placeOfBirth: s.placeOfBirth ?? "",
        dateOfBirth: dob,
        areas: s.areas ?? "",
        role: s.roleCode ?? "",
        plates: s.plates ?? "",
        notes: s.notes ?? "",
      };
      (Object.keys(COL_X) as Array<keyof typeof COL_X>).forEach((k) => {
        const x = COL_X[k];
        const w = COL_W[k];
        doc.rect(x, y, w, rowHeight).lineWidth(0.35).stroke("#000000");
        doc.text(values[k], x + 2, y + 5, { width: w - 4, align: "left" });
      });

      y += rowHeight;
    });

    drawAreaLegend(doc, areaLegends, row, ownerCode, y, logos);

    doc.end();
  } catch (err) {
    console.error("GET /api/accrediti/:eventId/pdf error:", err);
    if (!pdfStarted && !res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    } else if (pdfStarted) {
      console.error(
        "GET /api/accrediti/:eventId/pdf error (dopo avvio PDF/stream):",
        err
      );
    }
  }
});

export default router;
