import fs from 'fs';
import path from 'path';

// Tracks how many times an OPD visit-summary PDF has been WhatsApp'd for a given
// patient + visit date, so the first send uses the initial template and later
// sends (updated notes) use the "updated" template. Persisted as a small JSON
// file (no DB / no migration), mirroring attendance.store.ts.
// Shape: { "<prn>|<YYYY-MM-DD>": number }  -> send count.
const STORE_PATH = path.join(process.cwd(), 'visit-summary-sent.json');

type SentMap = { [key: string]: number };

const keyOf = (prn: string, date: string): string => `${prn}|${date}`;

const read = (): SentMap => {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    return raw ? (JSON.parse(raw) as SentMap) : {};
  } catch (error) {
    console.error('Error reading visit-summary store:', error);
    return {};
  }
};

const write = (data: SentMap): void => {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data), 'utf-8');
  } catch (error) {
    console.error('Error writing visit-summary store:', error);
  }
};

/** How many times this patient's visit-summary was already sent for that date. */
export const getSentCount = (prn: string, date: string): number => {
  if (!prn || !date) return 0;
  return read()[keyOf(prn, date)] ?? 0;
};

/** Record one successful send; returns the new count. */
export const recordSent = (prn: string, date: string): number => {
  if (!prn || !date) return 0;
  const data = read();
  const k = keyOf(prn, date);
  data[k] = (data[k] ?? 0) + 1;
  write(data);
  return data[k];
};
