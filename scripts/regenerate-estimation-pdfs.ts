/**
 * Rebuilds estimation PDFs that were lost from PDF_STORAGE_DIR/estimations/.
 *
 * Every field the PDF needs is stored in EstimationDetails (patient details,
 * costs, implants/procedures, the three base64 signatures) plus the related
 * inclusions/exclusions rows, so each PDF can be drawn again from the database
 * and written back to the exact path its `pdfLink` already points at. Existing
 * links in the app then resolve again — no database changes are needed.
 *
 * It calls the SAME generator the live endpoint uses
 * (generateEstimationPDF in src/api/estimation/estimation.controller.ts)
 * so the output is identical to what the app produces today.
 *
 * WHATSAPP IS DISABLED. The endpoint normally sends the PDF to the patient via
 * GoBuzz; this script blanks the GoBuzz credentials and points the API at a
 * dead address before calling it, so no patient is ever messaged. The send
 * fails inside the controller's try/catch and the PDF is still written.
 *
 * Run with:
 *   npx ts-node scripts/regenerate-estimation-pdfs.ts --dry-run
 *   npx ts-node scripts/regenerate-estimation-pdfs.ts --limit 1
 *   npx ts-node scripts/regenerate-estimation-pdfs.ts --id "JMRH_FY2025_26_-_3562"
 *   npx ts-node scripts/regenerate-estimation-pdfs.ts            # all missing
 *
 * Flags:
 *   --dry-run   list what would be rebuilt, write nothing
 *   --limit N   stop after N estimations
 *   --id X      rebuild one estimationId only
 *   --force     rebuild even if the file already exists
 *   --delay MS  pause between PDFs (default 150ms) to keep load down
 *
 * Existing files are skipped unless --force, so the script is safe to re-run.
 */

// global.d.ts augments Express's Request with `user`. ts-node only compiles
// files reachable from this entry point, so pull it in explicitly — without it
// the imported controller fails to compile ("Property 'user' does not exist").
/// <reference path="../global.d.ts" />

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Hard-disable the WhatsApp send BEFORE the controller is imported.
// sendEstimationViaGoBuzz reads these at call time; with no key and an
// unroutable base URL the send throws immediately and is swallowed by the
// controller's catch, leaving the PDF on disk.
// ---------------------------------------------------------------------------
process.env.GOBUZZ_API_KEY = '';
process.env.GOBUZZ_API_BASE = 'http://127.0.0.1:1';
process.env.GOBUZZ_ESTIMATION_TEMPLATE_NAME = '';

import { generateEstimationPDF } from '../src/api/estimation/estimation.controller';

const prisma = new PrismaClient();

const argv = process.argv.slice(2);
const hasFlag = (name: string) => argv.includes(name);
const flagValue = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const DRY_RUN = hasFlag('--dry-run');
const FORCE = hasFlag('--force');
const ONLY_ID = flagValue('--id');
const LIMIT = flagValue('--limit') ? Number(flagValue('--limit')) : undefined;
const DELAY_MS = flagValue('--delay') ? Number(flagValue('--delay')) : 150;

const STORAGE_DIR = process.env.PDF_STORAGE_DIR || '/var/www/docminds/pdfs';
const ESTIMATION_DIR = path.join(STORAGE_DIR, 'estimations');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The generator calls .toUpperCase() directly on several name fields, which are
 * nullable in the database on older rows (gender, attender, approver…). The
 * live app always posts strings, so this only bites when replaying old records.
 * Empty string reproduces what the app renders for a blank field ("N/A"),
 * whereas null throws.
 */
const text = (v: string | null | undefined) => v ?? '';

/** The controller's own naming rule — keep in step with estimation.controller.ts. */
const fileNameFor = (estimationId: string) =>
  `Estimation_${estimationId
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')}.pdf`;

/**
 * Calls the real handler with stand-in req/res objects and resolves once it
 * answers. Rejects on timeout so one bad row can't stall the whole run.
 *
 * The controller answers a bare {"error":"Internal Server Error"} and logs the
 * real cause with console.error, so capture that while it runs — otherwise a
 * failed row tells you nothing about why it failed.
 */
const runGenerator = async (body: any, timeoutMs = 120_000) => {
  const logged: string[] = [];
  const realError = console.error;
  console.error = (...args: any[]) => {
    logged.push(args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))).join(' '));
  };

  try {
    const result = await runGeneratorInner(body, timeoutMs);
    return { ...result, logged };
  } finally {
    console.error = realError;
  }
};

const runGeneratorInner = (body: any, timeoutMs: number) =>
  new Promise<{ status: number; body: any }>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`generator timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const res: any = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        if (settled) return this;
        settled = true;
        clearTimeout(timer);
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload: any) {
        return this.json(payload);
      },
    };

    Promise.resolve(generateEstimationPDF({ body } as any, res as any)).catch((err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });

async function main() {
  console.log('Estimation PDF rebuild');
  console.log(`  storage : ${ESTIMATION_DIR}`);
  console.log(`  mode    : ${DRY_RUN ? 'DRY RUN (nothing written)' : 'WRITING FILES'}`);
  console.log(`  whatsapp: disabled\n`);

  if (!DRY_RUN) fs.mkdirSync(ESTIMATION_DIR, { recursive: true });

  const rows = await prisma.estimationDetails.findMany({
    where: ONLY_ID ? { estimationId: ONLY_ID } : {},
    include: { inclusions: true, exclusions: true },
    orderBy: { id: 'asc' },
  });

  console.log(`${rows.length} estimation(s) found in the database\n`);

  let rebuilt = 0;
  let skipped = 0;
  let failed = 0;
  let legacy = 0;
  const failures: string[] = [];
  const legacyLinks: string[] = [];

  for (const row of rows) {
    if (LIMIT !== undefined && rebuilt >= LIMIT) break;

    // The generator rewrites pdfLink to `/files/estimations/<file>`. Leave rows
    // that point somewhere else (old external/FTP URLs) alone rather than
    // silently repointing a link that may still resolve.
    if (row.pdfLink && !row.pdfLink.startsWith('/files/estimations/')) {
      legacy++;
      legacyLinks.push(`${row.estimationId} -> ${row.pdfLink}`);
      continue;
    }

    // Prefer the filename the database already links to, so existing links work.
    const fileName = row.pdfLink ? path.basename(row.pdfLink) : fileNameFor(row.estimationId);
    const filePath = path.join(ESTIMATION_DIR, fileName);

    if (!FORCE && fs.existsSync(filePath)) {
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`would rebuild  ${fileName}  (${row.patientName})`);
      rebuilt++;
      continue;
    }

    const body = {
      estimationId: row.estimationId,
      inclusions: row.inclusions.map((i) => i.description),
      exclusions: row.exclusions.map((e) => e.description),
      updateFields: {
        patientUHID: row.patientUHID,
        patientName: text(row.patientName),
        ageOfPatient: row.ageOfPatient,
        genderOfPatient: text(row.genderOfPatient),
        consultantName: text(row.consultantName),
        estimationPreferredDate: row.estimationPreferredDate,
        estimationName: row.estimationName,
        icuStay: row.icuStay,
        wardStay: row.wardStay,
        totalDaysStay: row.totalDaysStay,
        estimatedDate: row.estimatedDate,
        discountPercentage: row.discountPercentage,
        estimationCost: row.estimationCost,
        totalEstimationAmount: row.totalEstimationAmount,
        patientSign: row.patientSign,
        employeeSign: row.employeeSign,
        approverSign: row.approverSign,
        approverName: text(row.approverName),
        employeeName: text(row.employeeName),
        patientPhoneNumber: row.patientPhoneNumber,
        signatureOf: text(row.signatureOf),
        implants: row.implants,
        procedures: row.procedures,
        instrumentals: row.instrumentals,
        surgeryPackage: row.surgeryPackage,
        attenderName: text(row.attenderName),
        patientRemarks: row.patientRemarks,
        multipleEstimationCost: row.multipleEstimationCost,
        costForGeneral: row.costForGeneral,
        costForPrivate: row.costForPrivate,
        costForSemiPrivate: row.costForSemiPrivate,
        costForVip: row.costForVip,
        costForDeluxe: row.costForDeluxe,
        costForPresidential: row.costForPresidential,
        selectedRoomCost: row.selectedRoomCost,
        estimationCreatedTime: row.estimationCreatedTime,
        submittedDateAndTime: row.submittedDateAndTime,
      },
    };

    try {
      const result = await runGenerator(body);
      if (result.status >= 400) {
        // Prefer the cause the controller logged over its generic response body.
        const cause = result.logged.find((l) => l.includes('Error generating PDF')) ?? result.logged[0];
        throw new Error(cause ? cause.split('\n').slice(0, 2).join(' ') : JSON.stringify(result.body));
      }
      if (!fs.existsSync(filePath)) {
        throw new Error(`generator reported success but ${fileName} is not on disk`);
      }
      const kb = Math.round(fs.statSync(filePath).size / 1024);
      console.log(`rebuilt  ${fileName}  (${kb} KB, ${row.patientName})`);
      rebuilt++;
    } catch (err: any) {
      failed++;
      failures.push(`${row.estimationId}: ${err?.message ?? err}`);
      console.error(`FAILED   ${row.estimationId}: ${err?.message ?? err}`);
    }

    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  console.log('\n--- summary ---');
  console.log(`rebuilt : ${rebuilt}`);
  console.log(`skipped : ${skipped} (file already present)`);
  console.log(`legacy  : ${legacy} (pdfLink points outside /files/estimations — left untouched)`);
  console.log(`failed  : ${failed}`);
  if (legacyLinks.length) {
    console.log('\nlegacy links (not rebuilt):');
    legacyLinks.forEach((l) => console.log(`  ${l}`));
  }
  if (failures.length) {
    console.log('\nfailures:');
    failures.forEach((f) => console.log(`  ${f}`));
  }
}

main()
  .catch((err) => {
    console.error('Fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
