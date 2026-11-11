import prisma from './prisma-client';
import { openai } from '../config/openai';

/**
 * Phase 6 (WF-5) — AI-drafted discharge summary.
 *
 * Aggregates the admission's clinical record (admission, prescriptions, MAR,
 * progress notes, daily closures) and asks the model for a structured
 * discharge summary. Returns the draft as a typed object that the controller
 * persists into IpdDischarge with summaryStatus='DRAFTED'.
 *
 * The output schema mirrors the IpdDischarge column names so the frontend can
 * spread it directly into the form state with no field renaming.
 */

export interface DischargeAiDraft {
  finalDiagnosis: string;
  proceduresDone: string;
  conditionAtDischarge: string;
  dischargeSummary: string;
  medications: Array<{
    genericName: string;
    brandName?: string;
    dose: string;
    route: string;
    frequency: string;
    duration: string;
    notes?: string;
  }>;
  advice: string;
  followUpInDays?: number;
  followUpDoctor?: string;
  modelVersion: string;
  generatedAt: string;
  /** Which records the draft was built from — shown to the reviewing doctor. */
  sources?: DraftSources;
}

/** Per-source record counts fed to the model, so the reviewer can see what the draft rests on. */
export interface DraftSources {
  initialAssessment: boolean;
  allergies: number;
  diagnosisCodes: number;
  progressNotes: number;
  icuProgressNotes: number;
  vitalsReadings: number;
  labRadiologyResults: number;
  criticalResults: number;
  operativeNotes: number;
  nonDrugOrders: number;
  prescriptions: number;
  marEntries: number;
  dailyClosures: number;
}

const MODEL = process.env.DISCHARGE_AI_MODEL || 'gpt-4o-mini';

/** Trim long free-text so one verbose note can't crowd the rest of the record out of the prompt. */
const clip = (s: string | null | undefined, n = 1200): string | null =>
  s == null ? null : s.length > n ? `${s.slice(0, n)}…` : s;

/**
 * Pull every clinical source the discharge summary draws on. Kept narrow on
 * PII — we do NOT send phone, address, or full DOB. Names and PRN are needed
 * so the model can address the summary correctly.
 *
 * Sources: admission + initial assessment, allergies, ICD codes, ward and ICU
 * progress notes, vitals (admission vs latest), lab/radiology results within
 * the stay, OT operative notes, non-drug orders (consults/procedures),
 * prescriptions, MAR, and nursing daily closures.
 */
async function aggregateContext(admissionId: string) {
  const admission = await prisma.ipdAdmission.findUnique({
    where: { id: admissionId },
    include: {
      ward: true,
      bed: true,
      initialAssessment: true,
      diagnosisCodes: { orderBy: { createdAt: 'asc' } },
      progressNotes: { orderBy: { createdAt: 'asc' }, take: 50 },
      icuProgressNotes: { orderBy: { noteDate: 'asc' }, take: 30 },
      nonDrugOrders: { where: { status: { not: 'CANCELLED' } }, orderBy: { orderedAt: 'asc' }, take: 60 },
      prescriptions: { orderBy: { prescribedDate: 'asc' } },
      dailyClosures: { orderBy: { closureDate: 'asc' } },
    },
  });
  if (!admission) throw new Error('Admission not found');

  // Results drawn during this stay only (one day of slack for pre-admission labs).
  const stayStart = new Date(new Date(admission.admissionDate).getTime() - 24 * 60 * 60 * 1000);

  const [marLogs, firstVitals, latestVitals, vitalsCount, allergies, otSchedules, results] = await Promise.all([
    prisma.ipdMedicationLog.findMany({ where: { admissionId }, orderBy: { administeredAt: 'asc' }, take: 200 }),
    prisma.ipdVitalsReading.findFirst({ where: { admissionId }, orderBy: { recordedAt: 'asc' } }),
    prisma.ipdVitalsReading.findMany({ where: { admissionId }, orderBy: { recordedAt: 'desc' }, take: 3 }),
    prisma.ipdVitalsReading.count({ where: { admissionId } }),
    admission.prn
      ? prisma.allergy.findMany({ where: { prn: admission.prn }, select: { genericName: true } }).catch(() => [])
      : Promise.resolve([] as { genericName: string | null }[]),
    prisma.otSchedule.findMany({
      where: { admissionId },
      select: {
        procedureName: true, surgeonName: true, anaesthesiologistName: true, actualStart: true,
        intraOpNotes: {
          select: { anaesthesiaType: true, findings: true, procedureDone: true, complications: true },
          orderBy: { noteNumber: 'asc' },
        },
      },
      orderBy: { plannedStart: 'asc' },
    }),
    admission.prn
      ? prisma.investigationResult.findMany({
          where: { prn: admission.prn, isDeleted: false, createdAt: { gte: stayStart } },
          orderBy: { createdAt: 'asc' },
          take: 80,
          select: {
            testName: true, department: true, result: true, unit: true,
            referenceRange: true, impression: true, reportedAt: true, criticalFlag: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const operativeNotes = otSchedules.reduce((n, s) => n + s.intraOpNotes.length, 0);
  const sources: DraftSources = {
    initialAssessment: !!admission.initialAssessment,
    allergies: allergies.length,
    diagnosisCodes: admission.diagnosisCodes.length,
    progressNotes: admission.progressNotes.length,
    icuProgressNotes: admission.icuProgressNotes.length,
    vitalsReadings: vitalsCount,
    labRadiologyResults: results.length,
    criticalResults: results.filter((r) => !!r.criticalFlag).length,
    operativeNotes,
    nonDrugOrders: admission.nonDrugOrders.length,
    prescriptions: admission.prescriptions.length,
    marEntries: marLogs.length,
    dailyClosures: admission.dailyClosures.length,
  };

  return { admission, marLogs, firstVitals, latestVitals, allergies, otSchedules, results, sources };
}

/**
 * Build the user prompt. Structure: short clinical brief + JSON dump of
 * relevant rows. The model receives a strict response schema via
 * `response_format: json_schema`, which keeps the keys aligned with the
 * IpdDischarge columns.
 */
function buildPrompt(ctx: Awaited<ReturnType<typeof aggregateContext>>): string {
  const a = ctx.admission;

  const progressBullets = (a.progressNotes ?? []).map((p, i) => ({
    n: i + 1,
    when: p.date,
    by: p.doctorName,
    subjective: p.subjective,
    objective: p.objective,
    assessment: p.assessment,
    plan: p.plan,
  }));

  const rxList = (a.prescriptions ?? []).map((rx) => ({
    drug: rx.genericName,
    brand: rx.brandName,
    dose: rx.dose,
    route: rx.route,
    frequency: rx.frequency,
    duration: rx.duration,
    status: rx.status,
    adminStatus: rx.adminStatus,
  }));

  const marSummary = ctx.marLogs.map((m) => ({
    when: m.administeredAt,
    by: m.administeredBy,
    qty: m.quantity,
    route: m.route,
    remarks: m.remarks,
  }));

  const closures = (a.dailyClosures ?? []).map((c) => ({
    date: c.closureDate,
    score: c.satisfactionScore,
    concerns: c.concerns,
    nursingSummary: c.nursingSummary,
  }));

  const ia = a.initialAssessment;
  const comorbidities = ia
    ? ([
        ia.hasHypertension && `Hypertension${ia.hypertensionSince ? ` since ${ia.hypertensionSince}` : ''}`,
        ia.hasDiabetes && `Diabetes${ia.diabetesSince ? ` since ${ia.diabetesSince}` : ''}`,
        ia.hasCardiacDisease && 'Cardiac disease',
        ia.hasCopd && 'COPD',
        ia.hasThyroidDisorder && 'Thyroid disorder',
        ia.hasCva && 'CVA',
        ia.hasRecurrentInfection && 'Recurrent infection',
      ].filter(Boolean) as string[])
    : [];

  const vitalsOf = (v: NonNullable<typeof ctx.firstVitals>) => ({
    when: v.recordedAt,
    tempF: v.temperatureF ?? (v.temperatureC != null ? +(v.temperatureC * 9 / 5 + 32).toFixed(1) : null),
    pulse: v.pulse,
    rr: v.respiration,
    bp: v.bpSystolic != null ? `${v.bpSystolic}/${v.bpDiastolic ?? '?'}` : null,
    spo2: v.spo2,
  });

  const icuNotes = (a.icuProgressNotes ?? []).map((n) => ({
    when: n.noteDate,
    icuDay: n.icuDayNumber,
    by: n.doctorName,
    assessment: clip(n.assessment),
    plan: clip(n.plan),
    trajectory: n.trajectory,
  }));

  const ot = ctx.otSchedules.map((s) => ({
    procedure: s.procedureName,
    surgeon: s.surgeonName,
    anaesthetist: s.anaesthesiologistName,
    date: s.actualStart,
    notes: s.intraOpNotes.map((n) => ({
      anaesthesia: n.anaesthesiaType,
      procedureDone: clip(n.procedureDone),
      findings: clip(n.findings),
      complications: clip(n.complications, 400),
    })),
  }));

  const results = ctx.results.map((r) => ({
    test: r.testName,
    dept: r.department,
    result: clip(r.result, 300),
    unit: r.unit,
    range: r.referenceRange,
    impression: clip(r.impression, 600),
    reportedAt: r.reportedAt,
    critical: r.criticalFlag || undefined,
  }));

  const orders = (a.nonDrugOrders ?? []).map((o) => ({
    when: o.orderedAt,
    category: o.category,
    order: clip(o.orderText, 300),
    status: o.status,
    outcome: clip(o.completionNotes, 300),
  }));

  return [
    `You are a senior physician drafting an NABH-compliant IPD discharge summary.`,
    `Use only the data below. Where data is missing, say "Not documented" — do NOT invent findings.`,
    `Keep medical language formal but readable for the patient and family.`,
    `Where a statement is inferred rather than directly documented, append "(verify)" so the reviewing doctor checks it.`,
    ``,
    `## Admission`,
    JSON.stringify({
      admissionNo: a.admissionNo,
      prn: a.prn,
      department: a.department,
      admittingDoctor: a.admittingDoctor,
      admissionDate: a.admissionDate,
      admissionType: a.admissionType,
      diagnosis: a.diagnosis,
      ward: a.ward?.wardName,
      icuAdmittedAt: a.icuAdmittedAt,
      icuDischargedAt: a.icuDischargedAt,
    }, null, 2),
    ``,
    `## Allergies`,
    JSON.stringify(ctx.allergies.map((x) => x.genericName).filter(Boolean)),
    ``,
    `## Initial assessment (at admission)`,
    JSON.stringify(ia ? {
      chiefComplaints: clip(ia.chiefComplaints),
      presentingIllness: clip(ia.presentingIllness, 2000),
      comorbidities,
      surgicalHistory: clip(ia.surgicalHistory, 600),
      medicationHistory: clip(ia.medicationHistory, 600),
    } : 'Not documented', null, 2),
    ``,
    `## Coded diagnoses (ICD-10 / CPT)`,
    JSON.stringify(a.diagnosisCodes.map((d) => ({ category: d.category, code: d.code, description: d.description })), null, 2),
    ``,
    `## Vitals — at admission vs latest`,
    JSON.stringify({
      atAdmission: ctx.firstVitals ? vitalsOf(ctx.firstVitals) : null,
      latest: ctx.latestVitals.map(vitalsOf),
    }, null, 2),
    ``,
    `## Investigations during the stay (lab + radiology)`,
    JSON.stringify(results, null, 2),
    ``,
    `## Operations / procedures (OT)`,
    JSON.stringify(ot, null, 2),
    ``,
    `## Progress notes`,
    JSON.stringify(progressBullets, null, 2),
    ``,
    `## ICU progress notes`,
    JSON.stringify(icuNotes, null, 2),
    ``,
    `## Non-drug orders (consults, procedures, diet, mobility)`,
    JSON.stringify(orders, null, 2),
    ``,
    `## Prescriptions`,
    JSON.stringify(rxList, null, 2),
    ``,
    `## MAR (last 200 admin events)`,
    JSON.stringify(marSummary.slice(-200), null, 2),
    ``,
    `## Daily closures`,
    JSON.stringify(closures, null, 2),
    ``,
    `Return a discharge summary in the strict JSON schema you've been given.`,
    `\`dischargeSummary\` is the hospital course: presentation, key and abnormal investigation`,
    `findings (state values with units), treatment given, any ICU stay, and response.`,
    `\`proceduresDone\` lists procedures from the OT notes and completed procedure orders, or "None".`,
    `Mention documented allergies in \`advice\`. The`,
    `\`medications\` array should contain ONLY the prescriptions the patient should`,
    `continue at home (i.e. status='active' and not discontinued). Suggest a`,
    `\`followUpInDays\` based on the diagnosis (commonly 7, 14, or 30). Set`,
    `\`conditionAtDischarge\` to a short phrase like "Stable, ambulatory" or`,
    `"Improving with outpatient care".`,
  ].join('\n');
}

/**
 * JSON schema response_format — keys mirror IpdDischarge columns 1:1.
 * Using OpenAI's structured-output mode ensures the model always returns
 * parseable JSON in this exact shape.
 */
const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  // OpenAI strict structured outputs require every key in `properties` to
  // appear in `required`. Genuinely-optional fields are declared required
  // but nullable (`['string','null']`) so the model can still omit them.
  required: [
    'finalDiagnosis',
    'proceduresDone',
    'conditionAtDischarge',
    'dischargeSummary',
    'medications',
    'advice',
    'followUpInDays',
    'followUpDoctor',
  ],
  properties: {
    finalDiagnosis: { type: 'string' },
    proceduresDone: { type: 'string' },
    conditionAtDischarge: { type: 'string' },
    dischargeSummary: { type: 'string' },
    medications: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['genericName', 'brandName', 'dose', 'route', 'frequency', 'duration', 'notes'],
        properties: {
          genericName: { type: 'string' },
          brandName: { type: ['string', 'null'] },
          dose: { type: 'string' },
          route: { type: 'string' },
          frequency: { type: 'string' },
          duration: { type: 'string' },
          notes: { type: ['string', 'null'] },
        },
      },
    },
    advice: { type: 'string' },
    followUpInDays: { type: ['number', 'null'] },
    followUpDoctor: { type: ['string', 'null'] },
  },
} as const;

export async function generateDischargeDraft(admissionId: string): Promise<DischargeAiDraft> {
  const ctx = await aggregateContext(admissionId);
  const prompt = buildPrompt(ctx);

  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content:
          'You are a senior Indian physician drafting NABH-compliant IPD discharge summaries. Output strict JSON only.',
      },
      { role: 'user', content: prompt },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'discharge_summary',
        strict: true,
        schema: RESPONSE_SCHEMA,
      },
    },
  });

  const raw = response.choices[0]?.message?.content ?? '{}';
  let parsed: Omit<DischargeAiDraft, 'modelVersion' | 'generatedAt'>;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('[discharge-ai] failed to parse model output:', raw);
    throw new Error('AI draft failed: invalid JSON');
  }

  return {
    ...parsed,
    modelVersion: MODEL,
    generatedAt: new Date().toISOString(),
    sources: ctx.sources,
  };
}

// ============================================================================
// Templated draft — when the discharge has a noteTemplateId, the model is
// constrained to return JSON keyed by the template's field keys instead of
// the legacy IpdDischarge columns. Lets cardiology / ortho / etc. get drafts
// in the structured form their template defines.
// ============================================================================

export interface FieldDef {
  key: string;
  label: string;
  type: string;
  options?: string[];
  required?: boolean;
  helpText?: string;
  group?: string;
}

export interface TemplatedDischargeDraft {
  templatedValueMap: Record<string, unknown>;
  modelVersion: string;
  generatedAt: string;
  sources?: DraftSources;
}

/**
 * Build a JSON Schema where each key is a template field key. Field types map
 * to JSON Schema types as best as we can:
 *   text/textarea/select/radio/handwritten → string
 *   number → number
 *   date/datetime → string  (ISO; the caller normalises before save)
 *   multiselect → string[]
 *   checkbox → boolean
 */
function buildTemplatedSchema(fields: FieldDef[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const f of fields) {
    if (f.type === 'handwritten') continue; // model can't draw — skip
    const baseType = (() => {
      switch (f.type) {
        case 'number':       return { type: 'number' };
        case 'multiselect':  return { type: 'array', items: { type: 'string' } };
        case 'checkbox':     return { type: 'boolean' };
        default:             return { type: 'string' };
      }
    })();

    if (f.type === 'select' || f.type === 'radio') {
      // Constrain to template-defined options when present.
      if (Array.isArray(f.options) && f.options.length > 0) {
        properties[f.key] = { ...baseType, enum: f.options };
      } else {
        properties[f.key] = baseType;
      }
    } else if (f.type === 'multiselect' && Array.isArray(f.options) && f.options.length > 0) {
      properties[f.key] = { type: 'array', items: { type: 'string', enum: f.options } };
    } else {
      properties[f.key] = baseType;
    }

    if (f.required) required.push(f.key);
  }

  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  };
}

/** Builds the same clinical-context prompt but appends template-specific guidance. */
function buildTemplatedPrompt(
  ctx: Awaited<ReturnType<typeof aggregateContext>>,
  templateName: string,
  fields: FieldDef[],
): string {
  const base = buildPrompt(ctx);
  const fieldGuide = fields
    .filter((f) => f.type !== 'handwritten')
    .map((f) => {
      const opts = f.options?.length ? ` (options: ${f.options.join(' | ')})` : '';
      const req = f.required ? ' [required]' : '';
      const help = f.helpText ? ` — ${f.helpText}` : '';
      return `  • ${f.key} (${f.type})${opts}${req}: ${f.label}${help}`;
    })
    .join('\n');

  return [
    base,
    '',
    `## Output template — "${templateName}"`,
    'Return JSON keyed by EXACTLY these template field keys. Do not invent extra keys.',
    'Hand-written canvas fields (if any in the template) are skipped — clinician fills them at the bedside.',
    '',
    fieldGuide,
    '',
    'Where data is missing in the source, leave the field empty rather than inventing values.',
  ].join('\n');
}

export async function generateTemplatedDischargeDraft(
  admissionId: string,
  template: { id: string; name: string; fields: FieldDef[] },
): Promise<TemplatedDischargeDraft> {
  const ctx = await aggregateContext(admissionId);
  const prompt = buildTemplatedPrompt(ctx, template.name, template.fields);
  const schema = buildTemplatedSchema(template.fields);

  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content:
          'You are a senior Indian physician drafting an NABH-compliant IPD discharge summary against a department-specific template. Output strict JSON keyed by the template field keys only.',
      },
      { role: 'user', content: prompt },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'templated_discharge',
        strict: true,
        schema,
      },
    },
  });

  const raw = response.choices[0]?.message?.content ?? '{}';
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('[discharge-ai] failed to parse templated model output:', raw);
    throw new Error('AI templated draft failed: invalid JSON');
  }

  return {
    templatedValueMap: parsed,
    modelVersion: MODEL,
    generatedAt: new Date().toISOString(),
    sources: ctx.sources,
  };
}
