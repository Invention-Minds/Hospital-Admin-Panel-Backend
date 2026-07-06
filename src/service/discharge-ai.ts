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
}

const MODEL = process.env.DISCHARGE_AI_MODEL || 'gpt-4o-mini';

/**
 * Pull all the clinical context the model needs. Kept narrow on purpose —
 * we do NOT send PII like phone, address, or full DOB. Names and PRN are
 * needed so the model can address the summary correctly.
 */
async function aggregateContext(admissionId: string) {
  const admission = await prisma.ipdAdmission.findUnique({
    where: { id: admissionId },
    include: {
      ward: true,
      bed: true,
      progressNotes: { orderBy: { createdAt: 'asc' }, take: 50 },
      prescriptions: { orderBy: { prescribedDate: 'asc' } },
      dailyClosures: { orderBy: { closureDate: 'asc' } },
    },
  });
  if (!admission) throw new Error('Admission not found');

  const marLogs = await prisma.ipdMedicationLog.findMany({
    where: { admissionId },
    orderBy: { administeredAt: 'asc' },
    take: 200,
  });

  return { admission, marLogs };
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

  return [
    `You are a senior physician drafting an NABH-compliant IPD discharge summary.`,
    `Use only the data below. Where data is missing, say "Not documented" — do NOT invent findings.`,
    `Keep medical language formal but readable for the patient and family.`,
    ``,
    `## Admission`,
    JSON.stringify({
      admissionNo: a.admissionNo,
      prn: a.prn,
      department: a.department,
      admittingDoctor: a.admittingDoctor,
      admissionDate: a.admissionDate,
      diagnosis: a.diagnosis,
      ward: a.ward?.wardName,
    }, null, 2),
    ``,
    `## Progress notes`,
    JSON.stringify(progressBullets, null, 2),
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
    `Return a discharge summary in the strict JSON schema you've been given. The`,
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
  };
}
