import { parseHmisExport, parseHmisDate, HmisExportError } from '../hmis-export-parser';
import { canonicalWardName, matchWard, wardCodeFor, type WardLike } from '../ward-matcher';

const grid = (headers: string[], rows: string[][]) => Buffer.from(
  `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML//EN"><html><body><table>` +
  `<thead><tr>${headers.map((h) => `<th class="rgHeader">${h}</th>`).join('')}</tr></thead><tbody>` +
  `<tr>${headers.map(() => '<td>&nbsp;</td>').join('')}</tr>` + // grid filter row
  rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') +
  `</tbody></table></body></html>`,
);

describe('parseHmisExport', () => {
  it('detects Current Occupancy and skips the blank filter row', () => {
    const out = parseHmisExport(grid(
      ['PRN', 'Patient Name', 'Admission No.', 'Ward', 'Bed No', 'Bed Category'],
      [['101', 'Test &amp; Person', '5001', 'VIP Suite', '1219', 'VIP Suite']],
    ), 'occ.xls');
    expect(out.kind).toBe('OCCUPANCY');
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]['Patient Name']).toBe('Test & Person');
  });

  it('detects Admissions, Discharge Summary and Patient Movement', () => {
    expect(parseHmisExport(grid(['PRN', 'Admission No', 'Admit in Ward', 'Bed No'], []), 'a.xls').kind).toBe('ADMISSIONS');
    expect(parseHmisExport(grid(['PRN', 'Admission No', 'Discharge Date', 'WARD', 'BED'], []), 'd.xls').kind).toBe('DISCHARGES');
    expect(parseHmisExport(grid(['', 'Patient Name', 'Ward', 'Transferred Date Time', ''], []), 'm.xls').kind).toBe('MOVEMENT');
  });

  it('keeps repeated headers apart', () => {
    const out = parseHmisExport(grid(['PRN', 'Admission No', 'Discharge Date', 'Contact', 'Contact'], [['1', '2', '', 'a', 'b']]), 'd.xls');
    expect(out.rows[0]['Contact']).toBe('a');
    expect(out.rows[0]['Contact 2']).toBe('b');
  });

  it('rejects a re-saved workbook and unknown grids', () => {
    expect(() => parseHmisExport(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'x.xlsx')).toThrow(HmisExportError);
    expect(() => parseHmisExport(grid(['Foo', 'Bar'], []), 'x.xls')).toThrow(/unrecognised/);
  });
});

describe('parseHmisDate', () => {
  it('reads dd/MM/yyyy with and without time', () => {
    const d = parseHmisDate('10/10/2026 01:11')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 10, 1, 11]);
    expect(parseHmisDate('25/09/2026')!.getDate()).toBe(25);
    expect(parseHmisDate('')).toBeNull();
  });
});

describe('ward matching', () => {
  const wards: WardLike[] = [
    { id: 'w1', wardName: 'Semi Private Ward', wardCode: 'SPW', hmisWardId: null },
    { id: 'w2', wardName: 'Male General Ward', wardCode: 'MGW', hmisWardId: null },
    { id: 'w3', wardName: 'Paediatric Ward', wardCode: 'PW', hmisWardId: null },
    { id: 'w4', wardName: 'Deluxe', wardCode: 'DLX', hmisWardId: 'Deluxe Rooms (HMIS)' },
  ];

  it('treats spelling variants of one ward as the same ward', () => {
    for (const name of ['Semi Private', 'Semi Prvt', 'semi-private ward', 'SEMI PVT']) {
      expect(matchWard(name, wards)?.ward.id).toBe('w1');
    }
    expect(matchWard('Male Gen Ward', wards)?.ward.id).toBe('w2');
    expect(matchWard('Male Generl Ward', wards)?.ward.id).toBe('w2');
    expect(matchWard('Pediatric', wards)?.ward.id).toBe('w3');
  });

  it('keeps genuinely different wards apart', () => {
    expect(matchWard('SF Semi Private - C Wing', wards)).toBeNull();
    expect(matchWard('Female General Ward', wards)).toBeNull();
    expect(matchWard('SICU First Floor', wards)).toBeNull();
  });

  it('uses the remembered HMIS name first', () => {
    expect(matchWard('Deluxe Rooms (HMIS)', wards)).toEqual({ ward: wards[3], how: 'remembered' });
  });

  it('builds canonical names and unique codes', () => {
    expect(canonicalWardName('Semi Prvt Ward')).toBe('semi private');
    const taken = new Set(['SSPCW']);
    expect(wardCodeFor('SF Semi Private - C Wing', taken)).toBe('SSPCW-2');
  });
});
