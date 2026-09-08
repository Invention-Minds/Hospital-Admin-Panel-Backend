import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../service/prisma-client';
import { generatePRN } from './patient-helper';
import { auditLog } from '../../service/app-audit';

/**
 * Bulk patient import from CSV.
 *
 * The uploaded file's header row carries `PatientDetails` column names
 * verbatim. Existing patients (matched on the unique `prn`) are left
 * untouched — only genuinely new rows are inserted.
 *
 * There is no CSV dependency in this project (only CSV *export* existed
 * before this), so the parser below is hand-rolled to RFC 4180: quoted
 * fields, doubled quotes, embedded commas and newlines, BOM and CRLF.
 */

// ─── CSV parsing ─────────────────────────────────────────────────────────

const parseCsv = (raw: string): string[][] => {
  // Excel writes a UTF-8 BOM; it would otherwise poison the first header.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // escaped quote
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++; // CRLF — the \n does the row break
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  // Trailing row with no closing newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully blank lines — trailing newlines and Excel's empty rows.
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
};

// ─── Column whitelist ────────────────────────────────────────────────────
// Anything not listed here is reported back as an ignored column rather than
// blindly spread into Prisma.

// DB-managed or server-identity columns. Never taken from the file, even if
// the export the file came from included them (mirrors stripAuditFields).
const IGNORED_COLUMNS = new Set([
  'id',
  'created_at',
  'updated_at',
  'createdBy',
  'createdById',
  'updatedBy',
  'updatedById',
]);

const INT_COLUMNS = new Set(['prn']);
const BOOLEAN_COLUMNS = new Set(['foreignNational', 'verified']);
const DATE_COLUMNS = new Set(['consentAcceptedAt']);

const STRING_COLUMNS = new Set([
  'name',
  'contactNo',
  'mobileNo',
  'email',
  'age',
  'gender',
  'address',
  'country',
  'state',
  'district',
  'city',
  'area',
  'pin',
  'BPd',
  'BPs',
  'RR',
  'bloodGroup',
  'diagnosis',
  'dob',
  'hb',
  'height',
  'patientType',
  'pulse',
  'rh',
  'sFerritin',
  'spo2',
  'temp',
  'weight',
  'hmisUhid',
  'chronicConditions',
  'currentMedications',
  'nextOfKinName',
  'nextOfKinRelation',
  'nextOfKinPhone',
  'preferredLanguage',
  'preferredCommChannel',
  'knownAllergies',
  'abhaIdHash',
  'abhaIdLast4',
  'source',
  'consentVersionAccepted',
  'consentSignatureId',
]);

const isImportable = (column: string): boolean =>
  STRING_COLUMNS.has(column) ||
  INT_COLUMNS.has(column) ||
  BOOLEAN_COLUMNS.has(column) ||
  DATE_COLUMNS.has(column);

const TRUE_VALUES = new Set(['true', '1', 'yes', 'y']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'n']);

type CoerceResult = { value: unknown } | { error: string };

const coerceCell = (column: string, raw: string): CoerceResult => {
  const value = raw.trim();
  // Empty cell = "not supplied". Leaves the column unset so the schema
  // default (or NULL) applies instead of writing an empty string.
  if (value.length === 0) return { value: undefined };

  if (INT_COLUMNS.has(column)) {
    if (!/^\d+$/.test(value)) return { error: `${column} must be a positive whole number (got "${value}")` };
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return { error: `${column} is out of range (got "${value}")` };
    return { value: parsed };
  }

  if (BOOLEAN_COLUMNS.has(column)) {
    const lower = value.toLowerCase();
    if (TRUE_VALUES.has(lower)) return { value: true };
    if (FALSE_VALUES.has(lower)) return { value: false };
    return { error: `${column} must be true/false (got "${value}")` };
  }

  if (DATE_COLUMNS.has(column)) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return { error: `${column} is not a valid date (got "${value}")` };
    return { value: parsed };
  }

  return { value };
};

// ─── Handler ─────────────────────────────────────────────────────────────

interface RowError {
  row: number;
  prn: number | null;
  reason: string;
}

interface PendingRow {
  rowNumber: number;
  prn: number | null;
  data: Record<string, unknown>;
}

const MAX_REPORTED = 200;
const INSERT_CHUNK = 500;

export const importPatientsCsv = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ message: 'CSV file is required (multipart/form-data, field name "file")' });
      return;
    }
    if (/\.(xlsx|xls)$/i.test(file.originalname)) {
      res.status(400).json({ message: 'Excel files are not supported — save the sheet as CSV and upload that' });
      return;
    }

    const rows = parseCsv(file.buffer.toString('utf8'));
    if (rows.length === 0) {
      res.status(400).json({ message: 'The uploaded file is empty' });
      return;
    }

    const headers = rows[0].map((h) => h.trim());
    const dataRows = rows.slice(1);
    if (dataRows.length === 0) {
      res.status(400).json({ message: 'The uploaded file has a header row but no data rows' });
      return;
    }

    const ignoredColumns: string[] = [];
    const usableHeaders: { index: number; column: string }[] = [];
    headers.forEach((header, index) => {
      if (header.length === 0) return;
      if (IGNORED_COLUMNS.has(header) || !isImportable(header)) {
        ignoredColumns.push(header);
        return;
      }
      usableHeaders.push({ index, column: header });
    });

    if (!usableHeaders.some((h) => h.column === 'name')) {
      res.status(400).json({
        message: 'CSV must contain a "name" column — headers are matched against PatientDetails column names',
        ignoredColumns,
      });
      return;
    }

    // ── Pass 1: parse + coerce every row ──────────────────────────────────
    const errors: RowError[] = [];
    const parsedRows: PendingRow[] = [];

    dataRows.forEach((cells, index) => {
      const rowNumber = index + 2; // header is row 1
      if (cells.length > headers.length) {
        errors.push({
          row: rowNumber,
          prn: null,
          reason: `row has ${cells.length} columns but the header has ${headers.length}`,
        });
        return;
      }

      const data: Record<string, unknown> = {};
      let rowError: string | null = null;

      for (const { index: columnIndex, column } of usableHeaders) {
        const coerced = coerceCell(column, cells[columnIndex] ?? '');
        if ('error' in coerced) {
          rowError = coerced.error;
          break;
        }
        if (coerced.value !== undefined) data[column] = coerced.value;
      }

      if (rowError) {
        errors.push({ row: rowNumber, prn: null, reason: rowError });
        return;
      }
      if (typeof data.name !== 'string' || data.name.length === 0) {
        errors.push({ row: rowNumber, prn: null, reason: 'name is required' });
        return;
      }

      parsedRows.push({
        rowNumber,
        prn: typeof data.prn === 'number' ? data.prn : null,
        data,
      });
    });

    // ── Pass 2: work out which PRNs already exist ─────────────────────────
    const csvPrns = parsedRows.map((r) => r.prn).filter((p): p is number => p !== null);

    const existingRows = csvPrns.length
      ? await prisma.patientDetails.findMany({
          where: { prn: { in: Array.from(new Set(csvPrns)) } },
          select: { prn: true },
        })
      : [];
    const existingPrns = new Set(existingRows.map((r) => r.prn));

    const skippedPrns: number[] = [];
    const seenInFile = new Set<number>();
    const toInsert: PendingRow[] = [];

    for (const row of parsedRows) {
      if (row.prn === null) {
        toInsert.push(row);
        continue;
      }
      if (existingPrns.has(row.prn)) {
        skippedPrns.push(row.prn);
        continue;
      }
      if (seenInFile.has(row.prn)) {
        // The same PRN twice in one file — first occurrence wins.
        skippedPrns.push(row.prn);
        continue;
      }
      seenInFile.add(row.prn);
      toInsert.push(row);
    }

    // ── Pass 3: allocate PRNs for rows that arrived without one ───────────
    // generatePRN() is max(prn)+1, so it can't clash with the DB — only with
    // PRNs this same file is about to insert. Sequential by necessity.
    const rowsNeedingPrn = toInsert.filter((r) => r.prn === null);
    if (rowsNeedingPrn.length > 0) {
      let nextPrn = await generatePRN();
      for (const row of rowsNeedingPrn) {
        while (seenInFile.has(nextPrn)) nextPrn++;
        seenInFile.add(nextPrn);
        row.prn = nextPrn;
        row.data.prn = nextPrn;
        nextPrn++;
      }
    }

    // ── Pass 4: insert ────────────────────────────────────────────────────
    const createdBy = req.user?.username ?? undefined;
    const createdById = typeof req.user?.id === 'number' ? req.user.id : undefined;
    const now = new Date();

    const buildPayload = (row: PendingRow): Prisma.PatientDetailsCreateManyInput =>
      ({
        ...row.data,
        source: typeof row.data.source === 'string' ? row.data.source : 'import',
        created_at: now,
        createdBy,
        createdById,
      } as Prisma.PatientDetailsCreateManyInput);

    let created = 0;

    for (let offset = 0; offset < toInsert.length; offset += INSERT_CHUNK) {
      const chunk = toInsert.slice(offset, offset + INSERT_CHUNK);
      try {
        const result = await prisma.patientDetails.createMany({
          data: chunk.map(buildPayload),
          skipDuplicates: true,
        });
        created += result.count;
      } catch {
        // A bad chunk tells us nothing about which row broke — retry it one
        // at a time so the caller gets a row number to fix.
        for (const row of chunk) {
          try {
            await prisma.patientDetails.create({ data: buildPayload(row) });
            created += 1;
          } catch (rowError) {
            errors.push({
              row: row.rowNumber,
              prn: row.prn,
              reason: rowError instanceof Error ? rowError.message : 'insert failed',
            });
          }
        }
      }
    }

    const summary = {
      totalRows: dataRows.length,
      created,
      skipped: skippedPrns.length,
      failed: errors.length,
    };

    await auditLog(req, {
      module: 'patient',
      action: 'CREATE',
      entityType: 'PatientDetails',
      payload: { ...summary, fileName: file.originalname },
      notes: `Bulk CSV import: ${created} created, ${skippedPrns.length} skipped (existing PRN), ${errors.length} failed`,
    });

    res.status(200).json({
      message: 'Import complete',
      ...summary,
      ignoredColumns,
      skippedPrns: skippedPrns.slice(0, MAX_REPORTED),
      skippedTruncated: skippedPrns.length > MAX_REPORTED,
      errors: errors.slice(0, MAX_REPORTED),
      errorsTruncated: errors.length > MAX_REPORTED,
    });
  } catch (error) {
    console.error('importPatientsCsv failed:', error);
    res.status(500).json({ message: 'Error importing patients', error });
  }
};
