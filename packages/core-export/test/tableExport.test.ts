import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { cellDate, cellNumber, tableToCsv, tableToOds, tableToXlsx, typedCell } from '../src/index';

const HEAD = ['Name', 'Amount', 'Due', 'Done', 'Zip'];
const ROWS = [
  ['Ann, "the" first', '1,200.50', '2026-03-04', '50%', '02134'],
  ['Bob\nline two', '(15)', '4 Mar 2026', '', 'x < y & z'],
];

describe('what a cell says', () => {
  it('reads numbers, percentages and dates, and leaves codes and words as text', () => {
    expect(cellNumber('1,200.50')).toEqual({ value: 1200.5, percent: false });
    expect(cellNumber('$3.5')).toEqual({ value: 3.5, percent: false });
    expect(cellNumber('(15)')).toEqual({ value: -15, percent: false });
    expect(cellNumber('12%')).toEqual({ value: 0.12, percent: true });
    expect(cellNumber('\u22124')?.value).toBe(-4);
    for (const t of ['02134', '007', '1234567890123456789', 'abc', '', '1.2.3', '12 apples']) expect(cellNumber(t)).toBeNull();
    expect(cellNumber('0.5')?.value).toBe(0.5);
    expect(cellDate('2026-03-04')?.iso).toBe('2026-03-04');
    expect(cellDate('4 Mar 2026')?.iso).toBe('2026-03-04');
    expect(cellDate('March 4, 2026')?.iso).toBe('2026-03-04');
    expect(cellDate('2026-02-31')).toBeNull();
    expect(cellDate('Room 5')).toBeNull();
    expect(cellDate('2026-03-04')?.serial).toBe(46085); // days since 1899-12-30, as spreadsheets count
    expect(typedCell('hello')).toEqual({ t: 's', text: 'hello' });
  });
});

describe('table files', () => {
  it('writes CSV with quoting, CRLF and a byte-order mark', () => {
    const csv = tableToCsv(HEAD, ROWS);
    expect(csv.startsWith('\ufeffName,Amount')).toBe(true);
    expect(csv).toContain('"Ann, ""the"" first",');
    expect(csv).toContain('"Bob\nline two"');
    expect(csv.split('\r\n')).toHaveLength(4);
    expect(tableToCsv(['a'], [['b']], { bom: false })).toBe('a\r\nb\r\n');
  });

  it('writes an xlsx with typed cells and escaped text', async () => {
    const zip = await JSZip.loadAsync(await tableToXlsx(HEAD, ROWS, { sheet: 'My: sheet' }));
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toContain('<c r="B2"><v>1200.5</v></c>');
    expect(sheet).toContain('<c r="B3"><v>-15</v></c>');
    expect(sheet).toContain('<c r="C2" s="2"><v>46085</v></c>');
    expect(sheet).toContain('<c r="D2" s="3"><v>0.5</v></c>');
    expect(sheet).toContain('>02134</t>');
    expect(sheet).toContain('x &lt; y &amp; z');
    expect(sheet).not.toContain('r="D3"'); // an empty cell is not written
    expect(await zip.file('xl/workbook.xml')!.async('string')).toContain('name="My  sheet"');
  });

  it('writes an ods with typed cells and the type stored first', async () => {
    const bytes = await tableToOds(HEAD, ROWS);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)[0]).toBe('mimetype');
    expect(await zip.file('mimetype')!.async('string')).toBe('application/vnd.oasis.opendocument.spreadsheet');
    const content = await zip.file('content.xml')!.async('string');
    expect(content).toContain('office:value-type="float" office:value="1200.5"');
    expect(content).toContain('office:value-type="date" office:date-value="2026-03-04"');
    expect(content).toContain('office:value-type="percentage" office:value="0.5"');
    expect(content).toContain('<table:table-header-rows>');
  });
});

import fs from 'node:fs';
describe('files for outside checks', () => {
  it('writes samples to a temporary folder when asked', async () => {
    const dir = process.env.CAVE_TABLE_OUT;
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/t.csv`, tableToCsv(HEAD, ROWS));
    fs.writeFileSync(`${dir}/t.xlsx`, await tableToXlsx(HEAD, ROWS));
    fs.writeFileSync(`${dir}/t.ods`, await tableToOds(HEAD, ROWS));
  });
});
