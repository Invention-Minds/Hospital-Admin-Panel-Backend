// Shared GoBuzz "document template" sender — upload a local file to GoBuzz media,
// then send a WhatsApp template message whose header is a document component
// referencing the uploaded media id. Extracted so both the estimation flow and
// the OPD visit-summary flow use one implementation.
//
// (The estimation controller still has its own inline copy; this module is the
// reusable version new callers should use.)
import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import https from 'https';

// GoBuzz's API host is fronted by Pinbot infra and serves a *.pinbot.ai cert.
// Accept that specific hostname mismatch only; any other cert still fails.
const gobuzzHttpsAgent = new https.Agent({
  checkServerIdentity: (host, cert) => {
    const altNames = (cert.subjectaltname || '')
      .split(',')
      .map((s) => s.trim().toLowerCase());
    if (altNames.includes('dns:pinbot.ai') || altNames.includes('dns:*.pinbot.ai')) {
      return undefined;
    }
    return new Error(`Unexpected certificate for ${host}: ${cert.subjectaltname}`);
  },
});

/** Normalise an Indian mobile number to GoBuzz's expected `91XXXXXXXXXX`. */
export function formatGoBuzzPhone(phoneNumber: string): string {
  const p = (phoneNumber || '').replace(/\D/g, '');
  if (p.length === 10) return `91${p}`;
  if (p.length === 12 && p.startsWith('91')) return p;
  return p;
}

/** Upload a local file to GoBuzz media; returns the media id used in a send. */
export async function uploadMediaToGoBuzz(filePath: string): Promise<string> {
  const baseUrl = process.env.GOBUZZ_API_BASE || 'https://api.app.gobuzzmarketing.com/v3';
  const phoneNumberId = process.env.GOBUZZ_PHONE_NUMBER_ID || '1051938688012992';
  const apiKey = process.env.GOBUZZ_API_KEY;

  const formData = new FormData();
  formData.append('sheet', fs.createReadStream(filePath));

  const response = await axios.post(`${baseUrl}/${phoneNumberId}/media`, formData, {
    headers: { ...formData.getHeaders(), apikey: apiKey },
    httpsAgent: gobuzzHttpsAgent,
  });
  console.log('GoBuzz media upload response:', response.data);

  const data: any = response.data;
  const mediaId =
    data?.response?.id ??
    data?.id ??
    data?.media_id ??
    data?.data?.[0]?.MediaId ??
    data?.data?.[0]?.id ??
    data?.data?.MediaId ??
    data?.data?.id ??
    data?.message?.id ??
    data?.message?.media_id;

  if (!mediaId) {
    throw new Error('GoBuzz media upload returned no media id — see log for response shape');
  }
  return String(mediaId);
}

/** Send a GoBuzz template message with a document header (uploaded media) plus
 *  optional body text params. Returns the raw axios response. */
export async function sendDocumentTemplate(opts: {
  to: string;
  templateName: string;
  templateLang?: string;
  mediaId: string;
  filename: string;
  bodyParams?: (string | number)[];
}): Promise<any> {
  const baseUrl = process.env.GOBUZZ_API_BASE || 'https://api.app.gobuzzmarketing.com/v3';
  const phoneNumberId = process.env.GOBUZZ_PHONE_NUMBER_ID || '1051938688012992';
  const apiKey = process.env.GOBUZZ_API_KEY;

  const components: any[] = [
    {
      type: 'header',
      parameters: [
        { type: 'document', document: { id: opts.mediaId, filename: opts.filename } },
      ],
    },
  ];
  if (opts.bodyParams && opts.bodyParams.length) {
    components.push({
      type: 'body',
      parameters: opts.bodyParams.map((t) => ({ type: 'text', text: String(t) })),
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: opts.to,
    type: 'template',
    template: {
      name: opts.templateName,
      language: { code: opts.templateLang || 'en' },
      components,
    },
  };

  return axios.post(`${baseUrl}/${phoneNumberId}/messages`, payload, {
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    httpsAgent: gobuzzHttpsAgent,
  });
}
