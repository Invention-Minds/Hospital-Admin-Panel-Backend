// GoBuzz / Pinbot WhatsApp Cloud-API client (v3 messages endpoint).
//
// Thin typed wrapper used by the patient-doctor WhatsApp bot. Distinct from the
// older bulk/template sends in whatsapp.controller.ts (which target the bulk
// endpoint); this hits POST /v3/{phone_number_id}/messages and supports the
// interactive message types the bot needs (text, reply buttons, list).
//
// Config via env (see .env):
//   GOBUZZ_API_URL           e.g. https://api.app.gobuzzmarketing.com
//   GOBUZZ_PHONE_NUMBER_ID   e.g. 1053878337814844
//   GOBUZZ_API_KEY           apikey header value
//   GOBUZZ_REPLY_TEMPLATE_NAME  (optional) approved template for >24h replies

import axios from 'axios';
import https from 'https';

const BASE = (process.env.GOBUZZ_API_URL ?? 'https://api.app.gobuzzmarketing.com').replace(/\/$/, '');

// api.app.gobuzzmarketing.com is a white-label alias to Pinbot servers whose
// TLS cert only covers *.pinbot.ai — so strict verification fails with a
// hostname/altnames mismatch. Relax verification for THIS vendor client only
// (the rest of the app keeps strict TLS). Set GOBUZZ_INSECURE_TLS=false to
// re-enable strict checking once the vendor fixes their certificate.
const gobuzzAgent = new https.Agent({ rejectUnauthorized: process.env.GOBUZZ_INSECURE_TLS === 'false' });
const PHONE_NUMBER_ID = process.env.GOBUZZ_PHONE_NUMBER_ID ?? '';
const API_KEY = process.env.GOBUZZ_API_KEY ?? '';

const messagesUrl = () => `${BASE}/v3/${PHONE_NUMBER_ID}/messages`;
const reqHeaders = () => ({ 'Content-Type': 'application/json', apikey: API_KEY });

// WhatsApp interactive limits (Meta-enforced). We truncate rather than error.
const BTN_TITLE_MAX = 20;
const ROW_TITLE_MAX = 24;
const ROW_DESC_MAX = 72;
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

async function post(payload: Record<string, unknown>): Promise<any> {
  if (!PHONE_NUMBER_ID || !API_KEY) {
    throw new Error('[gobuzz] GOBUZZ_PHONE_NUMBER_ID / GOBUZZ_API_KEY not configured');
  }
  try {
    const res = await axios.post(messagesUrl(), payload, { headers: reqHeaders(), httpsAgent: gobuzzAgent });
    return res.data;
  } catch (e: any) {
    console.error('[gobuzz] send failed:', e.response?.data || e.message);
    throw e;
  }
}

/**
 * Mark the patient's message read and show a "typing…" indicator while we work.
 * Best-effort: if the provider doesn't support typing_indicator it still marks
 * read. Never throws.
 */
export async function markReadAndTyping(messageId: string): Promise<void> {
  if (!messageId || !PHONE_NUMBER_ID || !API_KEY) return;
  try {
    await axios.post(
      messagesUrl(),
      { messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } },
      { headers: reqHeaders(), httpsAgent: gobuzzAgent },
    );
  } catch (e: any) {
    console.warn('[gobuzz] typing indicator failed:', e.response?.status ?? e.message);
  }
}

/** Plain free-form text. Only deliverable inside the 24h customer-service window. */
export async function sendText(to: string, body: string) {
  return post({ messaging_product: 'whatsapp', to, type: 'text', text: { body } });
}

/** Up to 3 quick-reply buttons. `id` comes back as interactive.button_reply.id. */
export async function sendButtons(
  to: string,
  bodyText: string,
  buttons: { id: string; title: string }[],
) {
  return post({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: trunc(b.title, BTN_TITLE_MAX) },
        })),
      },
    },
  });
}

/** Single-section list (max 10 rows). `id` comes back as interactive.list_reply.id. */
export async function sendList(
  to: string,
  header: string,
  bodyText: string,
  buttonLabel: string,
  rows: { id: string; title: string; description?: string }[],
) {
  return post({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: trunc(header, 60) },
      body: { text: bodyText },
      action: {
        button: trunc(buttonLabel, BTN_TITLE_MAX),
        sections: [
          {
            title: trunc(header, ROW_TITLE_MAX),
            rows: rows.slice(0, 10).map((r) => ({
              id: r.id,
              title: trunc(r.title, ROW_TITLE_MAX),
              ...(r.description ? { description: trunc(r.description, ROW_DESC_MAX) } : {}),
            })),
          },
        ],
      },
    },
  });
}

/**
 * Download inbound media (image/document/...) by its WhatsApp media id.
 * Two-step (Meta-style): GET /v3/{id} returns a JSON descriptor with a `url`,
 * then we fetch that url as bytes. Falls back to treating the first response as
 * the binary if no `url` is present. Returns null on failure (logged).
 */
export async function downloadMedia(
  mediaId: string,
): Promise<{ buffer: Buffer; mime?: string } | null> {
  if (!PHONE_NUMBER_ID || !API_KEY) {
    console.error('[gobuzz] media: not configured');
    return null;
  }
  try {
    const meta = await axios.get(`${BASE}/v3/${mediaId}?phone_number_id=${PHONE_NUMBER_ID}`, {
      headers: reqHeaders(),
      httpsAgent: gobuzzAgent,
    });
    // GoBuzz wraps payloads in `response` (confirmed via media upload shape);
    // also tolerate top-level / `data` shapes.
    const d: any = meta.data;
    const url: string | undefined = d?.url ?? d?.response?.url ?? d?.data?.url;
    const mime: string | undefined = d?.mime_type ?? d?.response?.mime_type ?? d?.data?.mime_type;

    if (!url) {
      // No descriptor URL — the first call likely returned the bytes directly.
      const direct = await axios.get(`${BASE}/v3/${mediaId}?phone_number_id=${PHONE_NUMBER_ID}`, {
        headers: reqHeaders(),
        httpsAgent: gobuzzAgent,
        responseType: 'arraybuffer',
      });
      return { buffer: Buffer.from(direct.data), mime: mime ?? direct.headers['content-type'] };
    }

    const bin = await axios.get(url, {
      headers: reqHeaders(),
      httpsAgent: gobuzzAgent,
      responseType: 'arraybuffer',
    });
    return { buffer: Buffer.from(bin.data), mime: mime ?? bin.headers['content-type'] };
  } catch (e: any) {
    console.error('[gobuzz] media download failed:', e.response?.status, e.response?.data || e.message);
    return null;
  }
}

/**
 * Approved template send — required when replying OUTSIDE the 24h window.
 * `params` fill the BODY {{1}}, {{2}} … placeholders in order.
 */
export async function sendTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  params: string[],
) {
  return post({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: params.length
        ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }]
        : [],
    },
  });
}
