/**
 * Updating the AppImage. The app looks for a newer one about once a day (see UpdateManager in update-manager.ts), downloads it
 * next to the one that runs, and puts it in that one's place under the same file name, so launchers, shortcuts and "Open With"
 * keep working. This file holds the parts that need neither Electron nor a window: where to look, how to read what is found,
 * which of the files of a release is the right build, and how to put it in place safely.
 *
 * Where to look (Settings → Updates → "Update address", empty for the default):
 *   - a GitHub repository, `https://github.com/owner/name` (its latest release);
 *   - the address of a release in GitHub's own JSON form (`…/releases/latest`, or a list of releases `…/releases`);
 *   - a small JSON file you keep anywhere: `{ "version": "0.3.0", "url": "https://…/Cave_Notes-0.3.0-x86_64.AppImage", "sha256": "…" }`;
 *   - the address of an AppImage itself, when its file name carries the version (`Cave_Notes-0.3.0-x86_64.AppImage`).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** The repository the app looks at unless told otherwise. */
export const DEFAULT_REPO = 'elvishcraftsman/cave-notes';

/** The three kinds of AppImage the project makes (see packaging/build-appimage.sh); they differ in their runtime. */
export type Variant = 'fuse2' | 'uruntime' | 'type2';

export interface UpdateOffer {
  /** the version on offer, without a leading `v` */
  version: string;
  /** where to download the file */
  url: string;
  /** the file's own name at the source */
  name: string;
  sha256?: string;
  size?: number;
  /** a page about the release, when the source gives one */
  notes?: string;
}

export class UpdateError extends Error {}

/** `1.2.3`, `v1.2.3`, `Cave_Notes-1.2.3-x86_64.AppImage`: the numbers of a version, with a pre-release tag after a hyphen. */
export function parseVersion(text: string): { nums: number[]; pre: string } | null {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.]+))?/.exec(text);
  if (!m) return null;
  const nums = [m[1], m[2], m[3] ?? '0', m[4] ?? '0'].map((n) => Number(n));
  const pre = m[5] && /^(alpha|beta|rc|pre|dev|next)/i.test(m[5]) ? m[5] : '';
  return { nums, pre };
}

/** The version written in a text, as text: `0.9.0` out of `Cave_Notes-0.9.0-x86_64.AppImage`, `1.0.0-rc1` out of `v1.0.0-rc1`. */
export function versionOf(text: string): string | null {
  const m = /(\d+\.\d+(?:\.\d+)?(?:\.\d+)?)(?:-((?:alpha|beta|rc|pre|dev|next)[0-9A-Za-z.]*))?/i.exec(text);
  return m ? (m[2] ? `${m[1]}-${m[2]}` : m[1]!) : null;
}

/** Positive when `a` is newer than `b`. A release candidate is older than the release it leads to. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 4; i++) {
    if (x.nums[i]! !== y.nums[i]!) return x.nums[i]! - y.nums[i]!;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === '') return 1;
  if (y.pre === '') return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** Which runtime the running AppImage has: written into it when it is built, else guessed from its file name. */
export function variantOf(fileName: string, marker?: string | null): Variant {
  const m = (marker ?? '').trim();
  if (m === 'fuse2' || m === 'uruntime' || m === 'type2') return m;
  const n = fileName.toLowerCase();
  return n.includes('uruntime') ? 'uruntime' : n.includes('type2') ? 'type2' : 'fuse2';
}

const variantOfAsset = (name: string): Variant => variantOf(name, null);

interface GhAsset {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
  digest?: unknown;
}

/** The AppImage of a release that suits this computer and this build of the app (same runtime, same processor). */
export function pickAsset(assets: GhAsset[], variant: Variant, arch: string = process.arch): { name: string; url: string; size?: number; sha256?: string } | null {
  const want = arch === 'arm64' ? /aarch64|arm64/i : /x86[_-]?64|amd64|x64/i;
  for (const a of assets) {
    if (typeof a.name !== 'string' || typeof a.browser_download_url !== 'string') continue;
    if (!/\.AppImage$/i.test(a.name) || !want.test(a.name) || variantOfAsset(a.name) !== variant) continue;
    const digest = typeof a.digest === 'string' ? /^sha256:([0-9a-f]{64})$/i.exec(a.digest) : null;
    return { name: a.name, url: a.browser_download_url, ...(typeof a.size === 'number' ? { size: a.size } : {}), ...(digest ? { sha256: digest[1]!.toLowerCase() } : {}) };
  }
  return null;
}

/** The address to ask for a source the person typed (or the default). */
export function sourceRequest(source: string): { kind: 'github' | 'json' | 'file'; url: string } {
  const text = source.trim() || `https://github.com/${DEFAULT_REPO}`;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    throw new UpdateError('The update address is not a web address. Use one that starts with https://');
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))) {
    throw new UpdateError('The update address must start with https:// (http:// is only accepted for this computer itself).');
  }
  if (/\.AppImage$/i.test(u.pathname)) return { kind: 'file', url: u.href };
  if (u.hostname === 'github.com' || u.hostname === 'www.github.com') {
    const [owner, repo] = u.pathname.split('/').filter(Boolean);
    if (!owner || !repo) throw new UpdateError('A GitHub address needs the owner and the repository: https://github.com/owner/name');
    return { kind: 'github', url: `https://api.github.com/repos/${owner}/${repo.replace(/\.git$/, '')}/releases/latest` };
  }
  return { kind: 'json', url: u.href };
}

type Fetcher = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; headers: { get(name: string): string | null }; body: unknown }>;

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** A release in GitHub's form → the offer for this build. */
function offerFromRelease(rel: Record<string, unknown>, variant: Variant, arch: string): UpdateOffer | null {
  const tag = typeof rel.tag_name === 'string' ? rel.tag_name : typeof rel.name === 'string' ? rel.name : '';
  const v = parseVersion(tag);
  if (!v) return null;
  const asset = pickAsset(Array.isArray(rel.assets) ? (rel.assets as GhAsset[]) : [], variant, arch);
  if (!asset) throw new UpdateError(`Version ${tag.replace(/^v/i, '')} has no AppImage for this build (${variant}, ${arch}).`);
  return { version: versionOf(tag) ?? tag.replace(/^[^\d]*/, ''), url: asset.url, name: asset.name, ...(asset.sha256 ? { sha256: asset.sha256 } : {}), ...(asset.size ? { size: asset.size } : {}), ...(typeof rel.html_url === 'string' ? { notes: rel.html_url } : {}) };
}

/**
 * Ask the source what the newest version is. `null` when what runs is as new as that (or newer). Throws UpdateError with a
 * sentence for the person when the source cannot be read or has nothing for this build.
 */
export async function findUpdate(opts: { current: string; source: string; variant: Variant; arch?: string; fetch: Fetcher; timeoutMs?: number }): Promise<UpdateOffer | null> {
  const arch = opts.arch ?? process.arch;
  const req = sourceRequest(opts.source);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 20000);
  try {
    if (req.kind === 'file') {
      const v = parseVersion(path.basename(new URL(req.url).pathname));
      if (!v) throw new UpdateError('The file name at that address has no version in it (Cave_Notes-0.3.0-x86_64.AppImage), so there is no way to tell whether it is newer. Use a GitHub address or a small JSON file instead.');
      const version = versionOf(path.basename(new URL(req.url).pathname))!;
      return compareVersions(version, opts.current) > 0 ? { version, url: req.url, name: path.basename(new URL(req.url).pathname) } : null;
    }
    const res = await opts.fetch(req.url, { headers: { Accept: 'application/vnd.github+json, application/json', 'User-Agent': 'Cave-Notes-updater' }, signal: ctl.signal }).catch((e: unknown) => {
      throw new UpdateError(`Could not reach ${new URL(req.url).hostname}: ${(e as Error).name === 'AbortError' ? 'it took too long to answer' : (e as Error).message}`);
    });
    if (res.status === 404 && req.kind === 'github') throw new UpdateError('That repository has no releases yet (or is not public).');
    if (res.status === 403 || res.status === 429) throw new UpdateError('GitHub is limiting requests from this connection right now. Cave Notes will try again later.');
    if (!res.ok) throw new UpdateError(`The update address answered with an error (${res.status}).`);
    const data = await res.json().catch(() => {
      throw new UpdateError('The update address did not answer with JSON.');
    });
    let offer: UpdateOffer | null = null;
    const rec = asRecord(data);
    if (Array.isArray(data)) {
      // a list of releases: the newest one that is not a draft or a pre-release
      const rels = data.map(asRecord).filter((r): r is Record<string, unknown> => !!r && r.draft !== true && r.prerelease !== true && !!parseVersion(String(r.tag_name ?? '')));
      rels.sort((a, b) => compareVersions(String(b.tag_name), String(a.tag_name)));
      if (rels[0]) offer = offerFromRelease(rels[0], opts.variant, arch);
    } else if (rec && typeof rec.tag_name === 'string') {
      offer = offerFromRelease(rec, opts.variant, arch);
    } else if (rec && typeof rec.version === 'string' && typeof rec.url === 'string') {
      const base = req.url;
      const url = new URL(rec.url, base).href;
      if (!/^https:/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) throw new UpdateError('The file the update address names must be an https:// address.');
      offer = { version: versionOf(rec.version) ?? rec.version.replace(/^[^\d]*/, ''), url, name: path.basename(new URL(url).pathname) || 'Cave_Notes.AppImage', ...(typeof rec.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(rec.sha256) ? { sha256: rec.sha256.toLowerCase() } : {}), ...(typeof rec.notes === 'string' ? { notes: rec.notes } : {}) };
    } else {
      throw new UpdateError('That address does not describe a release. It should be a GitHub repository, or a JSON file with "version" and "url".');
    }
    if (!offer) throw new UpdateError('No released version was found there.');
    return compareVersions(offer.version, opts.current) > 0 ? offer : null;
  } finally {
    clearTimeout(timer);
  }
}

/** Is this a file an AppImage runtime would start? (an ELF program with the AppImage marker at byte 8) */
export function looksLikeAppImage(head: Buffer): boolean {
  return head.length >= 11 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46 && head[8] === 0x41 && head[9] === 0x49 && (head[10] === 0x01 || head[10] === 0x02);
}

export interface InstallOptions {
  offer: UpdateOffer;
  /** the AppImage that runs now; the new file takes its place under this very name */
  target: string;
  fetch: Fetcher;
  /** where the old file is kept (one copy, replaced each time), so a bad update can be undone by hand */
  backupDir: string;
  onProgress?: (done: number, total: number | null) => void;
  signal?: AbortSignal;
}

/**
 * Download the new AppImage next to the old one, check it, keep a copy of the old one in `backupDir`, and rename the new one
 * over the old one. Renaming is one step the file system does whole: either the old file is there or the new one, and the
 * running program (which has the old file open) is not disturbed. Returns the path written (the same as `target`).
 */
export async function installUpdate(o: InstallOptions): Promise<string> {
  const dir = path.dirname(o.target);
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    throw new UpdateError(`The folder ${dir} cannot be written to, so the AppImage cannot be replaced there. Move it somewhere you own, or download the new one yourself.`);
  }
  const part = path.join(dir, `.${path.basename(o.target)}.update-${process.pid}.part`);
  try {
    const res = await o.fetch(o.offer.url, { headers: { 'User-Agent': 'Cave-Notes-updater', Accept: 'application/octet-stream' }, ...(o.signal ? { signal: o.signal } : {}) });
    if (!res.ok || !res.body) throw new UpdateError(`The download failed (${res.status}).`);
    const total = Number(res.headers.get('content-length')) || o.offer.size || null;
    const hash = crypto.createHash('sha256');
    let done = 0;
    const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    source.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      done += chunk.length;
      o.onProgress?.(done, total);
    });
    await pipeline(source, fs.createWriteStream(part, { mode: 0o755 }));
    if (total && done !== total) throw new UpdateError('The download stopped before the end of the file.');
    if (done < 1_000_000) throw new UpdateError('The downloaded file is too small to be the app.');
    const digest = hash.digest('hex');
    if (o.offer.sha256 && digest !== o.offer.sha256) throw new UpdateError('The downloaded file does not match its checksum, so it was thrown away.');
    const fd = fs.openSync(part, 'r');
    const head = Buffer.alloc(16);
    try {
      fs.readSync(fd, head, 0, 16, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (!looksLikeAppImage(head)) throw new UpdateError('The downloaded file is not an AppImage, so it was thrown away.');
    fs.chmodSync(part, 0o755);
    fs.mkdirSync(o.backupDir, { recursive: true });
    try {
      fs.copyFileSync(o.target, path.join(o.backupDir, path.basename(o.target)));
    } catch {
      /* the old file may already be gone; the update goes on */
    }
    fs.renameSync(part, o.target);
    return o.target;
  } finally {
    fs.rmSync(part, { force: true });
  }
}
