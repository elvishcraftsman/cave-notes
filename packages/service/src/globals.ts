/**
 * The machine-level side of globally global settings. Each workspace that tags sections `!global` publishes them to one
 * file per workspace in the app's own data folder; what other workspaces may take from those files is the person's decision,
 * kept per computer in consent.json (never in a workspace, so it is not synced).
 */
import { fs, path, sha1 } from '@cave-notes/platform';
import { offered } from '@cave-notes/core-index';

export interface Offered {
  attributes?: Record<string, unknown>;
  schemaAttributes?: Record<string, unknown>;
  queries?: Record<string, unknown>;
  relations?: unknown[];
  rules?: unknown[];
  exportStyles?: Record<string, unknown>;
}
export interface Offer { root: string; name: string; hash: string; sections: Offered }
/** per source workspace: the version (hash) that was decided on, the workspaces it applies to, and every workspace that was asked */
export type Consent = Record<string, { hash: string; apply: string[]; decided: string[] }>;

const sha = (s: string): string => sha1(s);
const offerFile = (dir: string, root: string): string => path.join(dir, `offer-${sha(root).slice(0, 16)}.json`);

/** Write (or remove) what the workspace at `root` offers, from its settings files (read as one, see core-index config). */
export async function publishOffer(dir: string, root: string, config: { shared?: Record<string, unknown> }): Promise<void> {
  const sections = offered(config) as Offered;
  const file = offerFile(dir, root);
  if (Object.keys(sections).length === 0) {
    await fs.rm(file, { force: true });
    return;
  }
  const offer: Offer = { root, name: path.basename(root), hash: sha(JSON.stringify(sections)), sections };
  const body = JSON.stringify(offer);
  const same = await fs.readFile(file, 'utf8').then((t) => t === body, () => false);
  if (same) return;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${file}.tmp`, body);
  await fs.rename(`${file}.tmp`, file);
}

export async function readOffers(dir: string): Promise<Offer[]> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const out: Offer[] = [];
  for (const n of names.filter((x) => x.startsWith('offer-') && x.endsWith('.json')).sort()) {
    try {
      const o = JSON.parse(await fs.readFile(path.join(dir, n), 'utf8')) as Offer;
      // an offer of a workspace that is gone is ignored
      if (o && typeof o.root === 'string' && o.sections && (await fs.stat(o.root).then((s) => s.isDirectory(), () => false))) out.push(o);
    } catch {
      /* unreadable: ignore */
    }
  }
  return out.sort((a, b) => a.root.localeCompare(b.root));
}

export async function readConsent(dir: string): Promise<Consent> {
  try {
    const c = JSON.parse(await fs.readFile(path.join(dir, 'consent.json'), 'utf8')) as Consent;
    return c && typeof c === 'object' ? c : {};
  } catch {
    return {};
  }
}

export async function writeConsent(dir: string, c: Consent): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const f = path.join(dir, 'consent.json');
  await fs.writeFile(`${f}.tmp`, JSON.stringify(c, null, 1));
  await fs.rename(`${f}.tmp`, f);
}

/** The offers of other workspaces that this one has not been asked about (for their current version). */
export function pendingFor(root: string, offers: Offer[], consent: Consent): Offer[] {
  return offers.filter((o) => {
    if (o.root === root) return false;
    const c = consent[o.root];
    return !c || c.hash !== o.hash || !c.decided.includes(root);
  });
}

/** What `root` takes from the offers approved for it; several sources combine by name, later paths over earlier. */
export function inheritedFor(root: string, offers: Offer[], consent: Consent): Offered {
  const out: Offered = {};
  for (const o of offers) {
    if (o.root === root) continue;
    const c = consent[o.root];
    if (!c || c.hash !== o.hash || !c.apply.includes(root)) continue;
    const s = o.sections;
    if (s.attributes) out.attributes = { ...out.attributes, ...s.attributes };
    if (s.schemaAttributes) out.schemaAttributes = { ...out.schemaAttributes, ...s.schemaAttributes };
    if (s.queries) out.queries = { ...out.queries, ...s.queries };
    if (s.exportStyles) out.exportStyles = { ...out.exportStyles, ...s.exportStyles };
    if (s.rules) {
      const idOf = (r: unknown): string => String((r as { id?: string; name?: string })?.id ?? (r as { name?: string })?.name ?? '').toLowerCase();
      const ids = new Set(s.rules.map(idOf));
      out.rules = [...(out.rules ?? []).filter((r) => !ids.has(idOf(r))), ...s.rules];
    }
    if (s.relations) {
      const names = new Set(s.relations.map((r) => String((r as { name?: string })?.name ?? '').toLowerCase()));
      out.relations = [...(out.relations ?? []).filter((r) => !names.has(String((r as { name?: string })?.name ?? '').toLowerCase())), ...s.relations];
    }
  }
  return out;
}

/** A few words saying what an offer contains, for the question. */
export function describe(s: Offered): string[] {
  const out: string[] = [];
  if (s.attributes) out.push(`attributes: ${Object.keys(s.attributes).join(', ')}`);
  if (s.schemaAttributes) out.push(`schema for: ${Object.keys(s.schemaAttributes).join(', ')}`);
  if (s.queries) out.push(`saved queries: ${Object.keys(s.queries).join(', ')}`);
  if (s.exportStyles) out.push(`export styles: ${Object.keys(s.exportStyles).join(', ')}`);
  if (s.relations) out.push(`${s.relations.length} relation${s.relations.length === 1 ? '' : 's'}`);
  if (s.rules) out.push(`${s.rules.length} automation rule${s.rules.length === 1 ? '' : 's'}: ${s.rules.map((r) => String((r as { id?: string })?.id ?? '?')).join(', ')}`);
  return out;
}
