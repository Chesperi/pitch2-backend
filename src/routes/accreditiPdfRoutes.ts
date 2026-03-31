import path from "path";
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

const router = Router();

const MARGIN = 40;
const USABLE_W = 515;
const RIGHT_EDGE = MARGIN + USABLE_W;
const HEADER_Y = 40;
const LOGO_W = 60;
const PAGE_BREAK_Y = 750;
const LEGEND_PAGE_THRESHOLD = 700;

/** A4 con margin 40 → ~515 pt utili; colonne compatte per 9 campi. */
const COL_X = {
  company: 40,
  surname: 84,
  name: 126,
  placeOfBirth: 168,
  dateOfBirth: 210,
  areas: 247,
  role: 279,
  plates: 317,
  notes: 349,
} as const;

const COL_W = {
  company: 44,
  surname: 42,
  name: 42,
  placeOfBirth: 42,
  dateOfBirth: 37,
  areas: 32,
  role: 38,
  plates: 32,
  notes: 206,
} as const;

const HEADER_ROW_H = 12;
const DATA_ROW_H = 14;

type PdfEventRow = {
  date: unknown;
  ko_italy_time: unknown;
  home_team_name_short: string | null;
  away_team_name_short: string | null;
  facilities: string | null;
  competition_name: string | null;
};

function formatPdfKoItaly(date: unknown, koTime: unknown): string {
  const d = date != null ? String(date).slice(0, 10) : "";
  const t = koTime != null ? String(koTime).trim() : "";
  const iso = d && t ? `${d}T${t}` : d || t;
  if (!iso) return "";
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? iso : dt.toLocaleString("it-IT");
}

function getOwnerLogoPath(ownerCode: string): string | null {
  const base = path.join(process.cwd(), "assets");
  switch (ownerCode.trim().toLowerCase()) {
    case "milan":
      return path.join(base, "logo-milan.png");
    case "inter":
      return path.join(base, "logo-inter.png");
    case "napoli":
      return path.join(base, "logo-napoli.png");
    case "lega":
    default:
      return path.join(base, "logo-lega.png");
  }
}

function drawHeader(
  doc: PDFKit.PDFDocument,
  row: PdfEventRow,
  ownerCode: string
): void {
  const daznPath = path.join(process.cwd(), "assets", "logo-dazn.png");
  try {
    doc.image(daznPath, MARGIN, HEADER_Y, { width: LOGO_W });
  } catch {
    // asset assente in dev: ignora
  }

  try {
    const ownerLogoPath = getOwnerLogoPath(ownerCode);
    if (ownerLogoPath) {
      const rightX = RIGHT_EDGE - LOGO_W;
      doc.image(ownerLogoPath, rightX, HEADER_Y, { width: LOGO_W });
    }
  } catch {
    // logo club/Lega assente: ignora
  }

  let y = HEADER_Y;
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#000000");
  doc.text("LISTA PERSONALE DA ACCREDITARE", MARGIN, y, {
    width: USABLE_W,
    align: "center",
  });
  y += 18;

  doc.font("Helvetica").fontSize(10);
  doc.text(
    `${row.home_team_name_short ?? ""} - ${row.away_team_name_short ?? ""}`,
    MARGIN,
    y,
    { width: USABLE_W, align: "center" }
  );
  y += 12;

  doc.text(
    `${row.facilities ?? ""} - ${row.competition_name ?? ""}`,
    MARGIN,
    y,
    { width: USABLE_W, align: "center" }
  );
  y += 12;

  const ko = formatPdfKoItaly(row.date, row.ko_italy_time);
  doc.text(ko, MARGIN, y, { width: USABLE_W, align: "center" });
  y += 10;

  doc.fontSize(7).text(`(owner aree: ${ownerCode})`, MARGIN, y, {
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

  doc.y = lineY + 6;
}

function drawTableHeader(doc: PDFKit.PDFDocument, atY: number): number {
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000");
  doc.text("AZIENDA", COL_X.company, atY, { width: COL_W.company });
  doc.text("COGNOME", COL_X.surname, atY, { width: COL_W.surname });
  doc.text("NOME", COL_X.name, atY, { width: COL_W.name });
  doc.text("LUOGO DI NASC.", COL_X.placeOfBirth, atY, {
    width: COL_W.placeOfBirth,
  });
  doc.text("DATA NASCITA", COL_X.dateOfBirth, atY, {
    width: COL_W.dateOfBirth,
  });
  doc.text("AREA", COL_X.areas, atY, { width: COL_W.areas });
  doc.text("RUOLO", COL_X.role, atY, { width: COL_W.role });
  doc.text("VETTURA", COL_X.plates, atY, { width: COL_W.plates });
  doc.text("NOTE", COL_X.notes, atY, { width: COL_W.notes });
  doc.font("Helvetica");
  return atY + HEADER_ROW_H;
}

function drawAreaLegend(
  doc: PDFKit.PDFDocument,
  legends: AccreditationAreaLegend[],
  row: PdfEventRow,
  ownerCode: string,
  tableEndY: number
): void {
  if (legends.length === 0) return;

  const titleH = 16;
  const rowH = 12;
  const blockH = titleH + legends.length * rowH + 24;
  let ly = tableEndY + 16;

  if (ly + blockH > LEGEND_PAGE_THRESHOLD) {
    doc.addPage();
    drawHeader(doc, row, ownerCode);
    ly = doc.y + 8;
  }

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#000000");
  doc.text("Legenda aree", MARGIN, ly, { width: USABLE_W });
  ly += titleH - 4;

  doc.font("Helvetica").fontSize(8);
  const codeW = 70;
  const descX = MARGIN + codeW + 5;
  const descW = USABLE_W - codeW - 5;

  for (const leg of legends) {
    if (ly + rowH > PAGE_BREAK_Y) {
      doc.addPage();
      drawHeader(doc, row, ownerCode);
      ly = doc.y + 8;
      doc.font("Helvetica-Bold").fontSize(9);
      doc.text("Legenda aree (segue)", MARGIN, ly, { width: USABLE_W });
      ly += titleH - 4;
      doc.font("Helvetica").fontSize(8);
    }

    doc.text(String(leg.areaCode), MARGIN, ly, { width: codeW });
    doc.text(String(leg.description), descX, ly, { width: descW });
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
      home_team_name_short: string | null;
      away_team_name_short: string | null;
      facilities: string | null;
      competition_name: string | null;
    }>(
      `SELECT id, date, ko_italy_time, home_team_name_short, away_team_name_short, facilities, competition_name
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
          areasManual: hasManualAreas,
          roleCode: effectiveRoleCode,
          plates: a.plates ?? a.staffPlates ?? null,
          notes: a.notes ?? a.staffNotes ?? null,
        };
      })
    );

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="accrediti-event-${eventId}.pdf"`
    );
    doc.pipe(res);
    pdfStarted = true;

    drawHeader(doc, row, ownerCode);

    let y = drawTableHeader(doc, doc.y) + 2;
    let rowIndex = 0;

    staffRows.forEach((s) => {
      if (y > PAGE_BREAK_Y) {
        doc.addPage();
        drawHeader(doc, row, ownerCode);
        y = drawTableHeader(doc, doc.y) + 2;
        rowIndex = 0;
      }

      rowIndex += 1;
      const isStriped = rowIndex % 2 === 0;
      const rowHeight = DATA_ROW_H;

      if (isStriped) {
        doc.save();
        doc.rect(MARGIN, y - 2, USABLE_W, rowHeight).fill("#f2f2f2");
        doc.restore();
      }

      doc.font("Helvetica").fontSize(8).fillColor("#000000");

      const dob = s.dateOfBirth ?? "";
      doc.text(s.company ?? "", COL_X.company, y, { width: COL_W.company });
      doc.text(s.surname ?? "", COL_X.surname, y, { width: COL_W.surname });
      doc.text(s.name ?? "", COL_X.name, y, { width: COL_W.name });
      doc.text(s.placeOfBirth ?? "", COL_X.placeOfBirth, y, {
        width: COL_W.placeOfBirth,
      });
      doc.text(dob, COL_X.dateOfBirth, y, { width: COL_W.dateOfBirth });

      if (s.areas && s.areas.trim() !== "") {
        const areaBoxX = COL_X.areas - 2;
        const areaBoxY = y - 2;
        const areaBoxW = COL_W.areas + 4;
        const areaBoxH = rowHeight - 2;

        const fillColor = s.areasManual ? "#FFEBE6" : "#FFF7CC";
        const strokeColor = s.areasManual ? "#E07C63" : "#E0C96B";

        doc.save();
        doc.lineWidth(0.5);
        doc.fillColor(fillColor).strokeColor(strokeColor);
        doc.rect(areaBoxX, areaBoxY, areaBoxW, areaBoxH).fillAndStroke();
        doc.restore();
      }

      doc.font("Helvetica").fontSize(8).fillColor("#000000");
      doc.text(s.areas ?? "", COL_X.areas, y, { width: COL_W.areas });
      doc.text(s.roleCode ?? "", COL_X.role, y, { width: COL_W.role });
      doc.text(s.plates ?? "", COL_X.plates, y, { width: COL_W.plates });
      doc.text(s.notes ?? "", COL_X.notes, y, { width: COL_W.notes });

      doc
        .moveTo(MARGIN, y + rowHeight - 4)
        .lineTo(RIGHT_EDGE, y + rowHeight - 4)
        .strokeColor("#dddddd")
        .lineWidth(0.3)
        .stroke();

      y += rowHeight;
    });

    drawAreaLegend(doc, areaLegends, row, ownerCode, y);

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
