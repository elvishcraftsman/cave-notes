import JSZip from 'jszip';

/**
 * A table's cells as a file for spreadsheet software: CSV, Excel (.xlsx) or OpenDocument (.ods). Cells are plain text (the
 * Markdown marks are gone). A cell that reads as a number, a percentage or a date is written as one, so a sheet can add,
 * sort and chart it; everything else stays text. A number with a leading zero (a ZIP code, a part number) or more than
 * 15 digits stays text, because a spreadsheet would change it.
 */

export type Cell = { t: 's'; text: string } | { t: 'n'; value: number; percent: boolean } | { t: 'd'; iso: string; serial: number };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NUM = /^[-+\u2212]?[$€£¥]?\s*[-+\u2212]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*%?$/;

/** The number a cell says (`1,200`, `$3.50`, `-4`, `(12)`, `12%` as 0.12), or null. Also what a column sort uses. */
export function cellNumber(text: string): { value: number; percent: boolean } | null {
  let s = text.trim();
  if (s === '') return null;
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    s = paren[1]!.trim();
    negative = true;
  }
  if (!NUM.test(s)) return null;
  const percent = s.endsWith('%');
  const digits = s.replace(/[%\s$€£¥,]/g, '').replace(/\u2212/g, '-');
  // "007" and "02134" are codes, not amounts; so are very long runs of digits
  if (/^[-+]?0\d/.test(digits) || digits.replace(/[^\d]/g, '').length > 15) return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return { value: (negative ? -n : n) / (percent ? 100 : 1), percent };
}

/** The date a cell says (`2026-03-04`, `4 Mar 2026`, `March 4, 2026`), as an ISO day and a spreadsheet serial number, or null. */
export function cellDate(text: string): { iso: string; serial: number; time: number } | null {
  const s = text.trim();
  let y: number, m: number, d: number;
  let r: RegExpExecArray | null;
  if ((r = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/.exec(s))) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s)) && MONTHS.includes(r[2]!.slice(0, 3).toLowerCase())) [y, m, d] = [Number(r[3]), MONTHS.indexOf(r[2]!.slice(0, 3).toLowerCase()) + 1, Number(r[1])];
  else if ((r = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s)) && MONTHS.includes(r[1]!.slice(0, 3).toLowerCase())) [y, m, d] = [Number(r[3]), MONTHS.indexOf(r[1]!.slice(0, 3).toLowerCase()) + 1, Number(r[2])];
  else return null;
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return { iso: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, serial: Math.round(t / 86400000) + 25569, time: t };
}

/** What one cell is, for a file. */
export function typedCell(text: string): Cell {
  const d = cellDate(text);
  if (d) return { t: 'd', iso: d.iso, serial: d.serial };
  const n = cellNumber(text);
  if (n) return { t: 'n', value: n.value, percent: n.percent };
  return { t: 's', text };
}

/** Comma-separated values (RFC 4180: CRLF between rows, a cell with a comma, a quote or a line break in quotes). With a byte-order mark by default, so Excel reads the accents. */
export function tableToCsv(head: string[], rows: string[][], opts: { bom?: boolean } = {}): string {
  const q = (c: string): string => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return (opts.bom === false ? '' : '\ufeff') + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Characters XML cannot hold are dropped. */
const xmlText = (s: string): string => esc(s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, ''));
const colName = (i: number): string => {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

/** An Excel workbook with one sheet: a bold header row that stays in view, numbers, percentages and dates as such. */
export async function tableToXlsx(head: string[], rows: string[][], opts: { sheet?: string } = {}): Promise<Uint8Array> {
  const sheet = (opts.sheet ?? 'Table').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Table';
  const widths = head.map((h, c) => Math.min(60, Math.max(8, h.length + 2, ...rows.map((r) => (r[c] ?? '').split('\n')[0]!.length + 2))));
  const cell = (c: number, r: number, text: string, header: boolean): string => {
    const ref = `${colName(c)}${r + 1}`;
    if (text === '') return '';
    if (header) return `<c r="${ref}" s="1" t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
    const v = typedCell(text);
    if (v.t === 'n') return `<c r="${ref}"${v.percent ? ' s="3"' : ''}><v>${v.value}</v></c>`;
    if (v.t === 'd') return `<c r="${ref}" s="2"><v>${v.serial}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
  };
  const row = (cells: string[], r: number): string => `<row r="${r + 1}">${cells.map((t, c) => cell(c, r, t, r === 0)).join('')}</row>`;
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${[head, ...rows].map(row).join('')}</sheetData></worksheet>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  // cell formats: 0 plain, 1 bold header, 2 date (yyyy-mm-dd), 3 percent
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  zip.file('xl/worksheets/sheet1.xml', sheetXml);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** An OpenDocument spreadsheet with one sheet: a bold header row, numbers, percentages and dates as such. */
export async function tableToOds(head: string[], rows: string[][], opts: { sheet?: string } = {}): Promise<Uint8Array> {
  const sheet = (opts.sheet ?? 'Table').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Table';
  const text = (s: string): string => s.split('\n').map((l) => `<text:p>${xmlText(l).replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`).replace(/\t/g, '<text:tab/>')}</text:p>`).join('');
  const cell = (s: string, header: boolean): string => {
    if (s === '') return '<table:table-cell/>';
    if (header) return `<table:table-cell table:style-name="ceHead" office:value-type="string">${text(s)}</table:table-cell>`;
    const v = typedCell(s);
    if (v.t === 'n') return v.percent ? `<table:table-cell table:style-name="cePct" office:value-type="percentage" office:value="${v.value}">${text(s)}</table:table-cell>` : `<table:table-cell office:value-type="float" office:value="${v.value}">${text(s)}</table:table-cell>`;
    if (v.t === 'd') return `<table:table-cell table:style-name="ceDate" office:value-type="date" office:date-value="${v.iso}">${text(v.iso)}</table:table-cell>`;
    return `<table:table-cell office:value-type="string">${text(s)}</table:table-cell>`;
  };
  const row = (cells: string[], header: boolean): string => `<table:table-row>${cells.map((c) => cell(c, header)).join('')}</table:table-row>`;
  const body = `<table:table-header-rows>${row(head, true)}</table:table-header-rows>${rows.map((r) => row(r, false)).join('')}`;
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" office:version="1.2"><office:automatic-styles><number:date-style style:name="Nd"><number:year number:style="long"/><number:text>-</number:text><number:month number:style="long"/><number:text>-</number:text><number:day number:style="long"/></number:date-style><number:percentage-style style:name="Np"><number:number number:decimal-places="2" number:min-integer-digits="1"/><number:text>%</number:text></number:percentage-style><style:style style:name="ceHead" style:family="table-cell"><style:text-properties fo:font-weight="bold"/></style:style><style:style style:name="ceDate" style:family="table-cell" style:data-style-name="Nd"/><style:style style:name="cePct" style:family="table-cell" style:data-style-name="Np"/></office:automatic-styles><office:body><office:spreadsheet><table:table table:name="${esc(sheet)}">${head.map(() => '<table:table-column/>').join('')}${body}</table:table></office:spreadsheet></office:body></office:document-content>`;
  const zip = new JSZip();
  // the type comes first and is stored, not compressed, so that programs can tell what the file is without opening it
  zip.file('mimetype', 'application/vnd.oasis.opendocument.spreadsheet', { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`);
  zip.file('content.xml', content);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.oasis.opendocument.spreadsheet' });
}
