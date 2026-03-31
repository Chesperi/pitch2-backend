import { Router, Request, Response } from "express";
import ExcelJS from "exceljs";
import { pool } from "../db";
import { listAccreditationsByEventId } from "../services/accreditationsService";
import {
  deriveAccreditationOwnerCodeFromHomeTeam,
  getAreasForOwnerAndRole,
  loadAreasForOwner,
} from "../services/accreditationAreasService";

const router = Router();

/** Excel non ammette \ / ? * : [ ] nel nome foglio. */
function sanitizeSheetName(raw: string): string {
  const t = raw.replace(/[:\\/?*[\]]/g, "-").trim();
  return (t.length > 0 ? t : "ACCREDITI").substring(0, 31);
}

function formatXlsxKo(date: unknown, koTime: unknown): string {
  const d = date != null ? String(date).slice(0, 10) : "";
  const t = koTime != null ? String(koTime).trim() : "";
  const iso = d && t ? `${d}T${t}` : d || t;
  if (!iso) return "";
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? iso : dt.toLocaleString("it-IT");
}

router.get("/:eventId/export-xlsx", async (req: Request, res: Response) => {
  const eventId = String(req.params.eventId ?? "").trim();
  if (!eventId) {
    res.status(400).json({ error: "Invalid eventId" });
    return;
  }

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

    const workbook = new ExcelJS.Workbook();
    const rawSheetName =
      `${row.home_team_name_short ?? "ACCORDI"}-${row.away_team_name_short ?? "MATCH"}`;
    const worksheet = workbook.addWorksheet(sanitizeSheetName(rawSheetName));

    const matchTitle = `${row.home_team_name_short ?? ""} - ${
      row.away_team_name_short ?? ""
    }`;
    const venueLine = `${row.facilities ?? ""} - ${row.competition_name ?? ""}`;
    const ko = formatXlsxKo(row.date, row.ko_italy_time);

    worksheet.mergeCells("A1:I1");
    worksheet.getCell("A1").value = "LISTA PERSONALE DA ACCREDITARE";
    worksheet.getCell("A1").font = { bold: true, size: 14 };
    worksheet.getCell("A1").alignment = { horizontal: "center" };

    worksheet.mergeCells("A2:I2");
    worksheet.getCell("A2").value = matchTitle;
    worksheet.getCell("A2").alignment = { horizontal: "center" };

    worksheet.mergeCells("A3:I3");
    worksheet.getCell("A3").value = venueLine;
    worksheet.getCell("A3").alignment = { horizontal: "center" };

    worksheet.mergeCells("A4:I4");
    worksheet.getCell("A4").value = ko;
    worksheet.getCell("A4").alignment = { horizontal: "center" };

    worksheet.mergeCells("A5:I5");
    worksheet.getCell("A5").value = `(owner aree: ${ownerCode})`;
    worksheet.getCell("A5").font = { size: 9, italic: true };
    worksheet.getCell("A5").alignment = { horizontal: "center" };

    const headerRowIndex = 7;
    const headerRow = worksheet.getRow(headerRowIndex);
    headerRow.values = [
      undefined,
      "AZIENDA",
      "COGNOME",
      "NOME",
      "LUOGO DI NASC.",
      "DATA NASCITA",
      "AREE",
      "RUOLO",
      "VETTURA",
      "NOTE",
    ];
    headerRow.font = { bold: true, size: 10 };

    let currentRow = headerRowIndex + 1;
    for (const s of staffRows) {
      const r = worksheet.getRow(currentRow);
      r.values = [
        undefined,
        s.company ?? "",
        s.surname ?? "",
        s.name ?? "",
        s.placeOfBirth ?? "",
        s.dateOfBirth ?? "",
        s.areas ?? "",
        s.roleCode ?? "",
        s.plates ?? "",
        s.notes ?? "",
      ];
      currentRow++;
    }

    for (let c = 1; c <= 9; c++) {
      const col = worksheet.getColumn(c);
      let maxLength = 10;
      col.eachCell({ includeEmpty: true }, (cell) => {
        const v =
          cell.value != null ? String(cell.value as string | number | Date) : "";
        if (v.length > maxLength) {
          maxLength = v.length;
        }
      });
      col.width = Math.min(maxLength + 2, 60);
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="accrediti-event-${eventId}.xlsx"`
    );

    const buffer = await workbook.xlsx.writeBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("GET /api/accrediti/:eventId/export-xlsx error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

export default router;
