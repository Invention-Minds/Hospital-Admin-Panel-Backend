import { openai } from '../config/openai';

// Phase 9.21 — OPD assessment AI auto-fill.
//
// Structures a doctor's free-text/voice dictation into the field keys of the
// doctor's chosen OPD note template. Same model + JSON-object response as the
// existing OPD voice flow (voiceOPD.controller). Strictly extractive: it only
// uses what the doctor actually said and never invents clinical findings.

export interface OpdFieldDef {
  key: string;
  label: string;
  type: string;
  options?: string[];
  required?: boolean;
  helpText?: string;
}

export interface OpdAiDraft {
  templatedValueMap: Record<string, unknown>;
  modelVersion: string;
  generatedAt: string;
}

// The same model the OPD voice transcription/structuring uses.
const MODEL = 'gpt-4o-mini';

export async function generateTemplatedOpdDraft(
  dictation: string,
  template: { name: string; fields: OpdFieldDef[] },
  header?: { name?: string | null; age?: string | null; gender?: string | null; vitals?: string | null },
): Promise<OpdAiDraft> {
  // Hand-written canvas fields can't be filled by the model — skip them.
  const fields = (template.fields ?? []).filter((f) => f.type !== 'handwritten');

  const fieldGuide = fields
    .map((f) => {
      const opts = f.options?.length ? ` (options: ${f.options.join(' | ')})` : '';
      const help = f.helpText ? ` — ${f.helpText}` : '';
      return `  • ${f.key} (${f.type})${opts}: ${f.label}${help}`;
    })
    .join('\n');

  const system = [
    "You are a medical scribe structuring an Indian OPD doctor's dictation into a department template.",
    'Return ONLY a JSON object keyed by EXACTLY these template field keys — no extra keys, no nesting.',
    'Use ONLY information explicitly stated in the dictation. If a field is not mentioned, return an empty string "".',
    'Never invent clinical findings, diagnoses, vitals, or medications.',
    'For select/radio fields, choose only from the listed options (or "" if none fit).',
    'For multiselect fields, return a comma-separated string of the chosen options.',
    'Plain text values only — do not nest objects or arrays.',
    '',
    `Template "${template.name}" fields:`,
    fieldGuide,
  ].join('\n');

  const userContent = [
    header
      ? `Patient: ${[header.name, header.age ? header.age + 'y' : '', header.gender].filter(Boolean).join(', ')}`
      : '',
    header?.vitals ? `Vitals: ${header.vitals}` : '',
    '',
    'Doctor dictation:',
    dictation,
  ].filter(Boolean).join('\n');

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0]?.message?.content ?? '{}';
  let parsed: Record<string, unknown> = {};
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') parsed = obj as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  // Drop any keys the model invented that aren't in the template.
  const allowed = new Set(fields.map((f) => f.key));
  const templatedValueMap: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (allowed.has(k)) templatedValueMap[k] = v;
  }

  return { templatedValueMap, modelVersion: MODEL, generatedAt: new Date().toISOString() };
}
