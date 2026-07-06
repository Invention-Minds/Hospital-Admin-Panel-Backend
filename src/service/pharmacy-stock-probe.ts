import axios from 'axios';

// Phase P — Pharmacy stock probe.
//
// Called inline when the doctor saves an IpdPrescription. Hits the HMIS
// inventory endpoint to look up what's actually on the shelf so the doctor
// gets a warning BEFORE save instead of a pharmacy rejection 20 minutes
// later. Returns a deterministic shape regardless of HMIS reachability so
// the controller can save a JSON snapshot of what the doctor saw.

const HMIS_BASE_URL = process.env.HMIS_BASE_URL || 'http://hmis-server/api';
const HMIS_API_KEY  = process.env.HMIS_API_KEY  || 'default-key';

export interface StockProbeResult {
  ok: boolean;                  // false → probe failed; treat as unknown stock
  source: 'hmis' | 'fallback';
  generic: string;
  quantityOnHand?: number;       // total units available (if known)
  brands?: Array<{ brand: string; quantity: number }>; // available brand list
  warning?: string;              // human-readable banner ('out of stock' / 'low (<5)')
  fetchedAt: string;
  raw?: unknown;                 // pass-through for debugging / FE display
}

const LOW_STOCK_THRESHOLD = 5;

/** Probe HMIS for current stock of a generic. Never throws — every error
 * path returns `ok: false` so the controller can record the failed probe
 * and continue saving the prescription. */
export async function probeStock(opts: {
  generic: string;
  dose?: string;
  route?: string;
}): Promise<StockProbeResult> {
  const fetchedAt = new Date().toISOString();
  const generic = opts.generic.trim();
  if (!generic) {
    return { ok: false, source: 'fallback', generic, fetchedAt, warning: 'No generic name supplied to probe' };
  }
  try {
    const url = `${HMIS_BASE_URL}/pharmacy/stock`;
    const resp = await axios.get(url, {
      params: { generic, dose: opts.dose, route: opts.route },
      headers: { Authorization: `Bearer ${HMIS_API_KEY}` },
      timeout: 4000,
    });
    const data = resp.data ?? {};
    const qty = typeof data.quantityOnHand === 'number' ? data.quantityOnHand : undefined;
    const brands: Array<{ brand: string; quantity: number }> = Array.isArray(data.brands)
      ? data.brands.filter((b: { brand?: unknown; quantity?: unknown }) =>
          typeof b.brand === 'string' && typeof b.quantity === 'number')
      : [];

    let warning: string | undefined;
    if (typeof qty === 'number') {
      if (qty <= 0) warning = `Out of stock — pharmacy will reject unless an alternative is selected.`;
      else if (qty < LOW_STOCK_THRESHOLD) warning = `Low stock — only ${qty} unit(s) on hand.`;
    } else {
      warning = `Stock unknown — pharmacy ack will confirm availability.`;
    }
    return { ok: true, source: 'hmis', generic, quantityOnHand: qty, brands, warning, fetchedAt, raw: data };
  } catch (err) {
    // HMIS unreachable / 5xx / timeout. Record the failure and continue — we
    // never want a stock probe outage to block prescribing in an emergency.
    return {
      ok: false, source: 'fallback', generic, fetchedAt,
      warning: `Stock probe unavailable (${(err as Error).message}). Pharmacy ack will validate.`,
    };
  }
}
