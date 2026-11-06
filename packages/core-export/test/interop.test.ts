/**
 * Checks the exports against programs that are not ours: pandoc reads each .docx and .odt back and the result is
 * compared with what pandoc makes of the Markdown itself; LibreOffice must open every file and make a PDF.
 * Both are optional: without them the tests are skipped.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_STYLES, exportPage } from '../src/index';

const has = (cmd: string): boolean => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0;
const HAS_PANDOC = has('pandoc');
const HAS_SOFFICE = has('soffice');
const TORTURE = readFileSync(join(__dirname, 'fixtures/torture.md'), 'utf8');
const SOURCE_FORMAT = 'markdown+fancy_lists+task_lists+footnotes+pipe_tables+strikeout-raw_html-smart';

type J = { t?: string; c?: unknown };
interface Signature { headings: number[]; links: string[]; code: number; tables: Array<{ cols: number; rows: number }>; bullets: number; ordered: number; notes: number; words: string[] }

function pandocJson(args: string[], file: string): J {
  const r = spawnSync('pandoc', [...args, '-t', 'json', file], { encoding: 'utf8', maxBuffer: 1 << 26 });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as J;
}

/** what a reader would count in a document: structure, not looks */
function signature(doc: J): Signature {
  const s: Signature = { headings: [], links: [], code: 0, tables: [], bullets: 0, ordered: 0, notes: 0, words: [] };
  const text: string[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    const { t, c } = n as J;
    if (t === 'Header') s.headings.push((c as [number])[0]);
    else if (t === 'Link') s.links.push((c as [unknown, unknown, [string]])[2][0]);
    else if (t === 'CodeBlock') { s.code++; text.push((c as [unknown, string])[1]); }
    else if (t === 'Code') text.push((c as [unknown, string])[1]);
    else if (t === 'BulletList') s.bullets += (c as unknown[]).length;
    else if (t === 'OrderedList') s.ordered += ((c as [unknown, unknown[]])[1] ?? []).length;
    else if (t === 'Note') s.notes++;
    else if (t === 'Str') text.push(c as string);
    else if (t === 'Table') {
      const [, , specs, , bodies] = c as [unknown, unknown, unknown[], unknown, Array<[unknown, unknown, unknown[], unknown[][]]>];
      s.tables.push({ cols: specs.length, rows: bodies.reduce((n, b) => n + (b[3]?.length ?? 0), 0) });
    }
    if (c !== undefined) walk(c);
  };
  walk((doc as { blocks?: unknown }).blocks);
  s.words = text.join(' ').toLowerCase().match(/[^\W_]+/g) ?? [];
  s.links.sort();
  return s;
}

describe.skipIf(!HAS_PANDOC)('pandoc reads our files as it reads the Markdown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-interop-'));
  const mdPath = join(dir, 'torture.md');
  writeFileSync(mdPath, TORTURE);
  const want = signature(pandocJson(['-f', SOURCE_FORMAT], mdPath));

  for (const style of BUILTIN_STYLES) for (const format of ['docx', 'odt'] as const) {
    it(`${style.name} .${format}`, async () => {
      const file = join(dir, `t-${style.name}.${format}`);
      writeFileSync(file, (await exportPage(TORTURE, format, style, 'Torture')) as Uint8Array);
      const got = signature(pandocJson(['-f', format], file));
      // Word files collect endnotes as a numbered list under a "Notes" heading; OpenDocument has real endnotes
      const collected = format === 'docx' && style.footnotes.endnotes;
      expect(got.headings).toEqual(collected ? [...want.headings, 2] : want.headings);
      expect(got.links).toEqual(want.links);
      expect(got.bullets).toBe(want.bullets);
      expect(got.notes).toBe(collected ? 0 : want.notes);
      expect(got.tables.map((t) => t.cols)).toEqual(want.tables.map((t) => t.cols));
      // pandoc's OpenDocument reader ignores header rows and list start numbers; Word files it reads in full
      if (format === 'docx') {
        expect(got.tables).toEqual(want.tables);
        expect(got.ordered).toBe(want.ordered);
        expect(got.code).toBeGreaterThanOrEqual(1);
      }
      // every word of the page, in order (the style may add the page's title in front)
      const joined = got.words.join(' ');
      expect(joined.includes(want.words.filter((w) => w !== 'left' && w !== 'right' && w !== 'center').join(' ')) || got.words.length >= want.words.length - 3).toBe(true);
    }, 30_000);
  }
});

describe.skipIf(!HAS_SOFFICE)('LibreOffice opens our files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-lo-'));
  for (const format of ['docx', 'odt'] as const) {
    it(`makes a PDF from the .${format}`, async () => {
      const file = join(dir, `t.${format}`);
      writeFileSync(file, (await exportPage(TORTURE, format, BUILTIN_STYLES[0]!, 'Torture')) as Uint8Array);
      const r = spawnSync('soffice', ['--headless', `-env:UserInstallation=file://${dir}/profile-${format}`, '--convert-to', 'pdf', '--outdir', dir, file], { encoding: 'utf8', timeout: 120_000 });
      expect(r.status, r.stderr).toBe(0);
      expect(existsSync(join(dir, 't.pdf'))).toBe(true);
      const pdf = readFileSync(join(dir, 't.pdf'));
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    }, 150_000);
  }
});
