// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PDFParse } = require("pdf-parse");

export interface ParsedMatch {
  data: string; // DD/MM/YYYY
  giorno: string; // Sabato, Domenica, ecc.
  orario: string; // HH:MM
  home_team: string;
  away_team: string;
  licenziatario: string; // DAZN oppure SKY/DAZN
  matchday: number; // giornata estratta dall'intestazione
  is_top_match: boolean;
}

const WORD_MATCHDAY: Record<string, number> = {
  PRIMA: 1,
  SECONDA: 2,
  TERZA: 3,
  QUARTA: 4,
  QUINTA: 5,
  SESTA: 6,
  SETTIMA: 7,
  OTTAVA: 8,
  NONA: 9,
  DECIMA: 10,
  UNDICESIMA: 11,
  DODICESIMA: 12,
};

/** `\b` evita che la parte giorno della data (es. /01/…) venga letta come giornata. */
const RE_HEADER_WORD =
  /\b(PRIMA|SECONDA|TERZA|QUARTA|QUINTA|SESTA|SETTIMA|OTTAVA|NONA|DECIMA|UNDICESIMA|DODICESIMA)\s+GIORNATA\b/gi;
const RE_HEADER_DIGIT_ORD =
  /\b(\d+)[\s\u00a0]*(?:[ªa°\u00aa])?\s*GIORNATA\b/gi;
const RE_HEADER_GIORNATA_NUM = /\bGIORNATA[\s\u00a0]*(\d+)\b/gi;

const ROW_RE =
  /(\d{2}\/\d{2}\/\d{4})\s+(Sabato|Domenica|Lunedì|Martedì|Mercoledì|Giovedì|Venerdì)\s+(\d{2}[.,]\d{2})\s+([A-ZÀ-ÖØ-Ý'.\s]+)-([A-ZÀ-ÖØ-Ý'.\s]+)(\s*\*)?\s+(DAZN(?:\/SKY)?|SKY\/DAZN)/i;

function normalizeLicense(value: string): string {
  const v = value.trim().toUpperCase();
  return v === "DAZN/SKY" ? "SKY/DAZN" : v;
}

function normalizeTime(value: string): string {
  return value.trim().replace(".", ",").replace(",", ":");
}

function normalizeTeam(value: string): string {
  return value.replace(/\s+/g, " ").trim().toUpperCase();
}

type HeaderHit = { start: number; end: number; n: number };

function collectMatchdayHeaders(line: string): HeaderHit[] {
  const raw: HeaderHit[] = [];

  let m: RegExpExecArray | null;
  const wr = new RegExp(RE_HEADER_WORD.source, RE_HEADER_WORD.flags);
  while ((m = wr.exec(line)) !== null) {
    const n = WORD_MATCHDAY[m[1].toUpperCase()];
    if (n != null) {
      raw.push({ start: m.index, end: m.index + m[0].length, n });
    }
  }

  const dr = new RegExp(RE_HEADER_DIGIT_ORD.source, RE_HEADER_DIGIT_ORD.flags);
  while ((m = dr.exec(line)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) {
      raw.push({ start: m.index, end: m.index + m[0].length, n });
    }
  }

  const gr = new RegExp(RE_HEADER_GIORNATA_NUM.source, RE_HEADER_GIORNATA_NUM.flags);
  while ((m = gr.exec(line)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) {
      raw.push({ start: m.index, end: m.index + m[0].length, n });
    }
  }

  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: HeaderHit[] = [];
  for (const h of raw) {
    const contained = merged.some((x) => h.start >= x.start && h.end <= x.end);
    if (contained) continue;
    merged.push(h);
  }
  merged.sort((a, b) => a.start - b.start);
  return merged;
}

/** Ultima intestazione giornata che finisce prima dell’indice `beforeIdx` (stessa riga, ordine di lettura). */
function lastMatchdayBeforeIndex(line: string, beforeIdx: number): number | null {
  const headers = collectMatchdayHeaders(line);
  let best: number | null = null;
  let bestEnd = -1;
  for (const h of headers) {
    if (h.end <= beforeIdx && h.end > bestEnd) {
      bestEnd = h.end;
      best = h.n;
    }
  }
  return best;
}

/** Ultima intestazione sulla riga intera (per aggiornare lo stato verso le righe successive). */
function lastMatchdayOnFullLine(line: string): number | null {
  const headers = collectMatchdayHeaders(line);
  if (headers.length === 0) return null;
  let last = headers[0];
  for (const h of headers) {
    if (h.end > last.end) last = h;
  }
  return last.n;
}

export async function parsePdfSerieA(buffer: Buffer): Promise<ParsedMatch[]> {
  const parser = new PDFParse({ data: buffer });
  let text = "";
  try {
    const data = await parser.getText();
    text =
      data.text ??
      data.pages
        ?.map((p: { text?: string; content?: string }) => p.text ?? p.content ?? "")
        .join("\n") ??
      "";
  } finally {
    await parser.destroy().catch(() => undefined);
  }
  const lines = text
    .split(/\r?\n/)
    .map((line: string) => line.trim())
    .filter((line: string) => line.length > 0);

  const out: ParsedMatch[] = [];
  let currentMatchday = 0;

  for (const line of lines) {
    const rowRe = new RegExp(
      ROW_RE.source,
      ROW_RE.flags.includes("g") ? ROW_RE.flags : `${ROW_RE.flags}g`
    );
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(line)) !== null) {
      const rowStart = rowMatch.index;
      const localMd = lastMatchdayBeforeIndex(line, rowStart);
      const effectiveMd = localMd ?? currentMatchday;
      if (effectiveMd <= 0) continue;

      const starGroup = rowMatch[6];
      const isTop = Boolean(starGroup && /\*/.test(starGroup));

      out.push({
        data: rowMatch[1],
        giorno: rowMatch[2],
        orario: normalizeTime(rowMatch[3]),
        home_team: normalizeTeam(rowMatch[4]),
        away_team: normalizeTeam(rowMatch[5]),
        licenziatario: normalizeLicense(rowMatch[7]),
        matchday: effectiveMd,
        is_top_match: isTop,
      });
    }

    const tailMd = lastMatchdayOnFullLine(line);
    if (tailMd != null) {
      currentMatchday = tailMd;
    }
  }

  return out;
}
