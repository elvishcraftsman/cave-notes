/**
 * Templates. A template is a note whose frontmatter says `template: true`. It lives either as a sub-page of any page (then
 * it is offered for that page's sub-pages, and for theirs) or in the workspace's `.cave-notes/templates` folder (offered
 * everywhere). Template pages never show in the page tree. The nearest one with a name wins.
 */
import { fs, path } from '@cave-notes/platform';
import YAML from 'yaml';
import { noteExtensions, pageFolder, parentPage } from '@cave-notes/core-tree';
import { stripFrontmatter } from '@cave-notes/core-md';

export const TEMPLATES_DIR = '.cave-notes/templates';

export interface TemplateInfo {
  name: string;
  /** the page that holds it (a template of the workspace has none) */
  holder: string | null;
  /** path from the workspace root, with `/` (a template of the app has `app/` and its file name) */
  rel: string;
  /** a template of the app (the app config folder): its whole path; every workspace offers it, one of the workspace's own with the same name wins */
  abs?: string;
}

const frontmatterOf = (text: string): Record<string, unknown> => {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return {};
  const v = YAML.parse(m[1]!) as unknown;
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
};

export const isTemplateText = (text: string): boolean => {
  try {
    const t = frontmatterOf(text).template;
    return t === true || (typeof t === 'string' && t.trim().toLowerCase() === 'true');
  } catch {
    return false;
  }
};

/** The folders to look in for sub-page templates, nearest first: the page's own, then each parent's, then the top level. */
export function templateFolders(page: string | null): string[] {
  const out: string[] = [];
  for (let p: string | null = page; p; p = parentPage(p)) out.push(pageFolder(p));
  out.push('');
  return out;
}

const join = (root: string, rel: string): string => path.join(root, ...rel.split('/').filter(Boolean));

async function entries(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

/**
 * The template files in a templates folder, as paths relative to it. A template is a single note file. A template set is a
 * notes page in the folder (its readme) with a folder of the same name: the readme is not a template itself, and the notes in
 * the folder are templates, as if they were in the templates folder directly.
 */
async function templateFiles(base: string, exts: string[], sub = '', depth = 1): Promise<string[]> {
  const names = (await entries(sub ? path.join(base, ...sub.split('/')) : base)).filter((n) => !n.startsWith('.')).sort();
  const out: string[] = [];
  for (const f of names) {
    const rel = sub ? `${sub}/${f}` : f;
    const ext = exts.find((e) => f.toLowerCase().endsWith(e));
    if (ext) {
      const stem = f.slice(0, -ext.length);
      if (depth < 3 && names.includes(stem) && (await isDir(path.join(base, ...(sub ? [...sub.split('/'), stem] : [stem]))))) continue; // a set's readme
      out.push(rel);
    } else if (depth < 3 && (await isDir(path.join(base, ...rel.split('/'))))) {
      // a folder is read only when a note of the same name sits beside it (a set); other folders are left alone
      if (exts.some((e) => names.includes(f + e))) out.push(...(await templateFiles(base, exts, rel, depth + 1)));
    }
  }
  return out;
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Every template usable for sub-pages of `page` (null = the top level), nearest first, one per name. */
export async function listTemplates(root: string, page: string | null, appDir?: string | null): Promise<TemplateInfo[]> {
  const exts = noteExtensions();
  const found = new Map<string, TemplateInfo>();
  const add = (info: TemplateInfo): void => {
    const k = info.name.toLowerCase();
    if (!found.has(k)) found.set(k, info);
  };
  for (const folder of templateFolders(page)) {
    for (const f of await entries(join(root, folder))) {
      const ext = exts.find((e) => f.toLowerCase().endsWith(e));
      if (!ext) continue;
      const rel = folder ? `${folder}/${f}` : f;
      let text: string;
      try {
        text = await fs.readFile(join(root, rel), 'utf8');
      } catch {
        continue;
      }
      if (isTemplateText(text)) add({ name: f.slice(0, -ext.length), holder: folder === '' ? null : null, rel });
    }
  }
  for (const rel of await templateFiles(join(root, TEMPLATES_DIR), exts)) {
    const f = rel.slice(rel.lastIndexOf('/') + 1);
    const ext = exts.find((e) => f.toLowerCase().endsWith(e))!;
    add({ name: f.slice(0, -ext.length), holder: null, rel: `${TEMPLATES_DIR}/${rel}` });
  }
  // the app's own templates come last: the workspace's win by name
  if (appDir) {
    for (const rel of await templateFiles(appDir, exts)) {
      const f = rel.slice(rel.lastIndexOf('/') + 1);
      const ext = exts.find((e) => f.toLowerCase().endsWith(e))!;
      add({ name: f.slice(0, -ext.length), holder: null, rel: `app/${rel}`, abs: path.join(appDir, ...rel.split('/')) });
    }
  }
  return [...found.values()];
}

export async function findTemplate(root: string, page: string | null, name: string, appDir?: string | null): Promise<(TemplateInfo & { text: string }) | null> {
  const t = (await listTemplates(root, page, appDir)).find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
  if (!t) return null;
  try {
    return { ...t, text: await fs.readFile(t.abs ?? join(root, t.rel), 'utf8') };
  } catch {
    return null;
  }
}

/**
 * A template name as written in frontmatter: plain text, or a page link. YAML reads an unquoted `[[template]]` as a
 * list inside a list, so lists are unwrapped; `[[name|alias]]`, `[[name#heading]]` and a trailing extension are cut.
 */
export function templateNameOf(v: unknown): string | null {
  let x: unknown = v;
  while (Array.isArray(x)) x = x[0];
  if (typeof x !== 'string') return null;
  let s = x.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '');
  s = s.split('|')[0]!.split('#')[0]!.trim();
  s = s.split('/').pop()!.trim();
  for (const e of noteExtensions()) if (s.toLowerCase().endsWith(e)) { s = s.slice(0, -e.length); break; }
  return s || null;
}

/** The template a page asks for its sub-pages: its own `childTemplate`, or one inside its `children:` block; else the parents'. */
export async function defaultTemplateName(root: string, page: string | null): Promise<string | null> {
  for (let p: string | null = page; p; p = parentPage(p)) {
    let text: string;
    try {
      text = await fs.readFile(join(root, p), 'utf8');
    } catch {
      continue;
    }
    let fm: Record<string, unknown>;
    try {
      fm = frontmatterOf(text);
    } catch {
      continue;
    }
    const own = templateNameOf(fm.childTemplate);
    if (own) return own;
    const kids = fm.children;
    const items = Array.isArray(kids) ? kids : kids && typeof kids === 'object' ? [kids] : [];
    for (const k of items) {
      const v = templateNameOf(k && typeof k === 'object' ? (k as Record<string, unknown>).childTemplate : undefined);
      if (v) return v;
    }
  }
  return null;
}

const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * The text of a new page made from a template: `template: true` is dropped (the page is not a template), `{{title}}` and
 * `{{date}}` are filled in, and a `# title` heading is added when the template has none.
 */
export function instantiate(templateText: string, title: string): string {
  let fm = '';
  let body = templateText;
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(templateText);
  if (m) {
    body = templateText.slice(m[0].length);
    const doc = YAML.parseDocument(m[1]!);
    if (doc.errors.length === 0 && YAML.isMap(doc.contents)) {
      doc.delete('template');
      doc.delete('childTemplate');
      const rest = String(doc).trimEnd();
      fm = doc.contents.items.length > 0 ? `---\n${rest}\n---\n` : '';
    } else fm = m[0];
  }
  const fill = (s: string): string => s.replace(/\{\{\s*title\s*\}\}/gi, title).replace(/\{\{\s*date\s*\}\}/gi, today());
  let out = fill(body).replace(/^\s*\n/, '');
  if (!/^#[ \t]+\S/m.test(out)) out = `# ${title}\n\n${out}`;
  return `${fm}${out.replace(/\s*$/, '\n')}`;
}

/**
 * A new page from a view: the template's text (as `instantiate` makes it) with the attributes the view gives the page
 * (the frontmatter of `made`) laid over the template's own, so the page both follows the template and shows in the view.
 */
export function mergeWithTemplate(templated: string, made: string): string {
  const fmRe = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
  const mm = fmRe.exec(made);
  if (!mm) return templated;
  const extra = YAML.parseDocument(mm[1]!);
  if (extra.errors.length > 0 || !YAML.isMap(extra.contents)) return templated;
  const tm = fmRe.exec(templated);
  const base = tm ? YAML.parseDocument(tm[1]!) : new YAML.Document({});
  if (base.errors.length > 0 || !YAML.isMap(base.contents)) return templated;
  for (const it of extra.contents.items) base.set((it.key as { value?: unknown }).value ?? it.key, it.value);
  const body = tm ? templated.slice(tm[0].length) : templated;
  return `---\n${String(base).trimEnd()}\n---\n${body}`;
}

export { stripFrontmatter };
