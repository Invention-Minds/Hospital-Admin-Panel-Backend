import { openai } from '../config/openai';

// Draft a reply to a patient's WhatsApp report query for the doctor to edit.
// Never sent automatically — the doctor reviews, edits and sends it.

const MODEL = process.env.QUERY_REPLY_AI_MODEL || process.env.DISCHARGE_AI_MODEL || 'gpt-4o-mini';

export type QueryMessageIn = { id: number; direction: 'IN' | 'OUT' | string; body: string; sender: string | null; at: Date };
export type QueryResultIn = { testName: string; result: string | null; unit: string | null; referenceRange: string | null; flag: string | null; at: Date };

export type QueryReplyDraft = {
  patientLanguage: string;
  translations: { messageId: number; english: string }[];
  draftEnglish: string;
  draftPatientLanguage: string | null;
  model: string;
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['patientLanguage', 'translations', 'draftEnglish', 'draftPatientLanguage'],
  properties: {
    patientLanguage: { type: 'string', description: 'Language the patient writes in, e.g. English, Kannada, Hindi, Tamil, Telugu.' },
    translations: {
      type: 'array',
      description: 'English translation of each patient (IN) message NOT written in English. Empty if all are English.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['messageId', 'english'],
        properties: { messageId: { type: 'integer' }, english: { type: 'string' } },
      },
    },
    draftEnglish: { type: 'string', description: 'The suggested reply in plain English.' },
    draftPatientLanguage: {
      type: ['string', 'null'],
      description: "The same reply in the patient's language, or null when the patient writes in English.",
    },
  },
} as const;

export async function draftQueryReply(input: {
  doctorName: string;
  patient: { name: string | null; age: string | null; gender: string | null };
  messages: QueryMessageIn[];
  results: QueryResultIn[];
}): Promise<QueryReplyDraft> {
  const convo = input.messages
    .map((m) => `[#${m.id}] ${m.direction === 'IN' ? 'PATIENT' : 'DOCTOR'} (${m.at.toISOString().slice(0, 16)}): ${m.body || '(attachment)'}`)
    .join('\n');
  const results = input.results.length
    ? input.results
        .map((r) => `- ${r.testName}: ${r.result ?? '—'} ${r.unit ?? ''}${r.referenceRange ? ` (ref ${r.referenceRange})` : ''}${r.flag ? ` [${r.flag}]` : ''} on ${r.at.toISOString().slice(0, 10)}`)
        .join('\n')
    : '(no lab or radiology results on record in the last 30 days)';

  const prompt = `You are helping ${input.doctorName}, a consultant in an Indian hospital, answer a patient's question about their reports, sent over WhatsApp.

Patient: ${input.patient.name ?? 'unknown'}, ${[input.patient.age, input.patient.gender].filter(Boolean).join(' ') || 'age/sex not recorded'}

Recent results (C = critical, H = high, L = low):
${results}

Conversation so far:
${convo}

Write the reply the doctor would send, answering the patient's latest question:
- Warm, plain words a patient understands; no jargon; at most 90 words.
- Only state what the results above support. Do not invent results, diagnoses or doses; do not change medicines.
- If something is critical or needs examination, ask them to visit the hospital (or the emergency department if urgent).
- Do not sign the message (the doctor's name is added automatically).
- If the patient writes in a language other than English, also give the reply in that language.`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    messages: [
      { role: 'system', content: 'You draft patient replies for a doctor to review. Output strict JSON only.' },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'query_reply', strict: true, schema: SCHEMA } },
  });
  const raw = response.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(raw) as Omit<QueryReplyDraft, 'model'>;
  return {
    patientLanguage: parsed.patientLanguage || 'English',
    translations: Array.isArray(parsed.translations) ? parsed.translations : [],
    draftEnglish: parsed.draftEnglish ?? '',
    draftPatientLanguage: parsed.draftPatientLanguage ?? null,
    model: MODEL,
  };
}
