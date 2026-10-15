/**
 * Match an HMIS ward name to an existing DocMinds ward without creating
 * near-duplicates ("Semi Private Ward" / "Semi Private" / "Semi Prvt" are one
 * ward), while keeping genuinely different wards apart ("SF Semi Private -
 * C Wing" is not "Semi Private").
 *
 * Order of checks:
 *   1. remembered mapping — IpdWard.hmisWardId holds the HMIS name once matched
 *   2. same canonical name — after expanding abbreviations and dropping filler
 *      words like "ward"
 *   3. near-identical spelling — word by word ("Generl" ≈ "General"), never
 *      across words that tell wards apart ("Male" ≠ "Female", "ICU" ≠ "SICU")
 */

export interface WardLike {
  id: string;
  wardName: string;
  wardCode: string;
  hmisWardId: string | null;
}

export type WardMatch =
  | { ward: WardLike; how: 'remembered' | 'same-name' | 'similar' }
  | null;

/** Abbreviations seen in hospital ward names → the full word. */
const EXPAND: Record<string, string> = {
  prvt: 'private', pvt: 'private', priv: 'private', pvte: 'private',
  gen: 'general', genl: 'general', gnrl: 'general',
  semipvt: 'semi private', semiprivate: 'semi private',
  spl: 'special', dlx: 'deluxe', delux: 'deluxe',
  flr: 'floor', fl: 'floor', '1st': 'first', '2nd': 'second', '3rd': 'third', gf: 'ground floor',
  paed: 'paediatric', ped: 'paediatric', peds: 'paediatric', pediatric: 'paediatric', paediatrics: 'paediatric', pediatrics: 'paediatric',
  obg: 'obstetrics', obgy: 'obstetrics', gyn: 'gynaecology', gynae: 'gynaecology',
  mat: 'maternity', ortho: 'orthopaedic', neuro: 'neurology', cardio: 'cardiology',
  mal: 'male', fem: 'female',
};

/** Words that do not change which ward is meant. */
const FILLER = new Set(['ward', 'wd', 'wards', 'room', 'rooms', 'the', 'unit', 'and', 'of']);

export function canonicalWardName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/semi[\s-]*(private|prvt|pvt|priv)/g, 'semi private')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .flatMap((w) => (EXPAND[w] ?? w).split(' '))
    .filter((w) => w && !FILLER.has(w));
  return words.join(' ');
}

function bigrams(s: string): Map<string, number> {
  const t = s.replace(/\s+/g, '');
  const out = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Dice coefficient on character bigrams, 0–1. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let overlap = 0, total = 0;
  for (const n of A.values()) total += n;
  for (const n of B.values()) total += n;
  for (const [g, n] of A) overlap += Math.min(n, B.get(g) ?? 0);
  return total ? (2 * overlap) / total : 0;
}

/** Words that make a ward different even when the rest is spelled alike. */
const DISTINCT = new Set([
  'male', 'female', 'men', 'women', 'gents', 'ladies', 'adult', 'child', 'paediatric', 'neonatal',
  'icu', 'sicu', 'micu', 'nicu', 'picu', 'ccu', 'iccu', 'hdu', 'cardiac', 'surgical', 'medical',
  'first', 'second', 'third', 'fourth', 'ground', 'east', 'west', 'north', 'south',
]);

/**
 * Same ward spelled differently: same number of words, every word close in
 * spelling, and words that distinguish wards (male/female, ICU types, floors,
 * wing letters, numbers) identical.
 */
function sameWardSpelling(a: string, b: string): boolean {
  const x = a.split(' '), y = b.split(' ');
  if (x.length !== y.length) return false;
  return x.every((w, i) => {
    const v = y[i];
    if (w === v) return true;
    if (DISTINCT.has(w) || DISTINCT.has(v) || w.length <= 2 || v.length <= 2 || /\d/.test(w + v)) return false;
    return similarity(w, v) >= 0.7;
  });
}

export function matchWard(hmisName: string, wards: WardLike[]): WardMatch {
  const raw = hmisName.trim().toLowerCase();
  const remembered = wards.find((w) => (w.hmisWardId ?? '').trim().toLowerCase() === raw);
  if (remembered) return { ward: remembered, how: 'remembered' };

  const canon = canonicalWardName(hmisName);
  if (!canon) return null;
  const same = wards.find((w) => canonicalWardName(w.wardName) === canon || w.wardCode.toLowerCase() === raw);
  if (same) return { ward: same, how: 'same-name' };

  let best: { ward: WardLike; score: number } | null = null;
  for (const w of wards) {
    const other = canonicalWardName(w.wardName);
    if (!sameWardSpelling(canon, other)) continue;
    const score = similarity(canon, other);
    if (!best || score > best.score) best = { ward: w, score };
  }
  return best ? { ward: best.ward, how: 'similar' } : null;
}

/** Short unique code for a new ward: initials of its words ("SF Semi Private - C Wing" → "SSPCW"). */
export function wardCodeFor(hmisName: string, taken: Set<string>): string {
  const initials = hmisName.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).map((w) => w[0]).join('').toUpperCase() || 'WARD';
  let code = initials.slice(0, 10);
  for (let n = 2; taken.has(code); n++) code = `${initials.slice(0, 8)}-${n}`;
  taken.add(code);
  return code;
}
