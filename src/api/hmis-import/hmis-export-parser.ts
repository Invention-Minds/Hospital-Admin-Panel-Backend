/**
 * Parser for HMIS (IPM) grid exports.
 *
 * The HMIS "Export to Excel" button saves the on-screen grid as an HTML
 * document with an .xls name (Telerik RadGrid). Excel opens it, but it is not
 * a binary workbook — so we read the <table> directly, no spreadsheet library.
 *
 * Supported exports (detected from the header row, not the file name):
 *   ADMISSIONS  — IPM_Admissions          (new admissions in a period)
 *   OCCUPANCY   — IPM_Current_Occupancy   (who is in which bed right now)
 *   DISCHARGES  — IPM_Qry_Discharge_Summary
 *   MOVEMENT    — IPM_Patient_Movement    (ward history; no bed numbers)
 */

export type HmisExportKind = 'ADMISSIONS' | 'OCCUPANCY' | 'DISCHARGES' | 'MOVEMENT';

export interface ParsedExport {
  kind: HmisExportKind;
  headers: string[];
  rows: Array<Record<string, string>>;
}

export class HmisExportError extends Error {}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z#0-9]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? m);
}

function cellText(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Header names made unique: blanks become col<i>, repeats get " 2", " 3". */
function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = h || `col${i}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} ${n}`;
  });
}

function detectKind(headers: string[]): HmisExportKind | null {
  const has = (h: string) => headers.includes(h);
  if (has('Discharge Date') && has('Admission No')) return 'DISCHARGES';
  if (has('Bed Category') && has('Ward') && has('Admission No.')) return 'OCCUPANCY';
  if (has('Admit in Ward') && has('Admission No')) return 'ADMISSIONS';
  if (has('Transferred Date Time')) return 'MOVEMENT';
  return null;
}

export function parseHmisExport(buffer: Buffer, fileName: string): ParsedExport {
  // A real workbook (xlsx = zip "PK", legacy xls = OLE "D0 CF") is not this format.
  if (buffer.length >= 2 && ((buffer[0] === 0x50 && buffer[1] === 0x4b) || (buffer[0] === 0xd0 && buffer[1] === 0xcf))) {
    throw new HmisExportError(
      `${fileName}: this is a re-saved Excel workbook. Upload the file exactly as HMIS exported it (do not open and save it in Excel).`,
    );
  }
  const html = buffer.toString('utf8');
  if (!/<table/i.test(html)) {
    throw new HmisExportError(`${fileName}: not an HMIS grid export (no table found).`);
  }

  const headers = uniqueHeaders([...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => cellText(m[1])));
  const kind = detectKind(headers);
  if (!kind) {
    throw new HmisExportError(`${fileName}: unrecognised HMIS export — expected Admissions, Current Occupancy, Discharge Summary or Patient Movement.`);
  }

  const rows: Array<Record<string, string>> = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => cellText(c[1]));
    // Skip the grid's filter / pager rows: wrong width or entirely blank.
    if (cells.length !== headers.length || cells.every((c) => !c)) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    rows.push(row);
  }
  return { kind, headers, rows };
}

/** "10/10/2026 01:11" or "25/09/2026" (dd/MM/yyyy, hospital local time). */
export function parseHmisDate(value: string | undefined): Date | null {
  const m = (value ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, d, mo, y, h, mi] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0));
  return Number.isNaN(date.getTime()) ? null : date;
}
