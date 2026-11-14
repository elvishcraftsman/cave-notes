/**
 * Updating the Android app. Android does not let an app replace itself quietly, so the app looks for a newer release (about
 * once a day, and when asked), and when there is one, "Install" opens the new APK's address: the phone downloads it, and a tap
 * on the downloaded file installs it over this one (Android may ask once to allow installs from the browser).
 *
 * Where to look is the same setting as on the desktop (Update address, empty for the project's releases on GitHub):
 *   - a GitHub repository, `https://github.com/owner/name` (its latest release that has an .apk file);
 *   - the address of a release list in GitHub's own JSON form (`…/releases/latest`, `…/releases`);
 *   - a small JSON file `{ "version": "0.9.1", "url": "https://…/cave-notes-debug.apk" }`.
 */
import type { UpdateStatus } from '@cave-notes/service/api';

export const DEFAULT_REPO = 'elvishcraftsman/cave-notes';

export interface ApkOffer {
  version: string;
  url: string;
  notes?: string;
}

const versionOf = (text: string): string | null => /(\d+\.\d+(?:\.\d+)?(?:\.\d+)?)/.exec(text)?.[1] ?? null;

/** Positive when `a` is newer than `b` (`0.9.1` over `0.9.0`; missing numbers count as 0). */
export function compareVersions(a: string, b: string): number {
  const x = (versionOf(a) ?? '0').split('.').map(Number);
  const y = (versionOf(b) ?? '0').split('.').map(Number);
  for (let i = 0; i < 4; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The address to ask for the releases of what the Update address setting says. */
export function sourceUrl(setting: string): string {
  const t = setting.trim();
  if (t === '') return `https://api.github.com/repos/${DEFAULT_REPO}/releases/latest`;
  const gh = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i.exec(t);
  if (gh) return `https://api.github.com/repos/${gh[1]}/${gh[2]}/releases/latest`;
  return t;
}

interface GhRelease {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: Array<{ name?: unknown; browser_download_url?: unknown }>;
}

/** What a source's JSON says is on offer: the newest release that has an APK. */
export function offerFrom(json: unknown): ApkOffer | null {
  if (json && typeof json === 'object' && !Array.isArray(json) && typeof (json as { version?: unknown }).version === 'string' && typeof (json as { url?: unknown }).url === 'string') {
    const j = json as { version: string; url: string; notes?: string };
    return { version: j.version.replace(/^v/i, ''), url: j.url, ...(typeof j.notes === 'string' ? { notes: j.notes } : {}) };
  }
  const releases = (Array.isArray(json) ? json : [json]) as GhRelease[];
  let best: ApkOffer | null = null;
  for (const r of releases) {
    if (!r || typeof r !== 'object' || r.draft === true || r.prerelease === true) continue;
    const apk = (r.assets ?? []).find((a) => typeof a.name === 'string' && /\.apk$/i.test(a.name) && typeof a.browser_download_url === 'string');
    const version = versionOf(String(r.tag_name ?? r.name ?? ''));
    if (!apk || !version) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { version, url: String(apk.browser_download_url), ...(typeof r.html_url === 'string' ? { notes: r.html_url } : {}) };
  }
  return best;
}

export interface UpdateIo {
  /** the app's own version */
  current: string;
  setting: () => string;
  fetchJson: (url: string) => Promise<unknown>;
  open: (url: string) => void;
  remember: (when: number) => void;
  lastCheck: () => number;
  now?: () => number;
}

/** Keeps the status the Updates row shows. */
export class AndroidUpdater {
  private st: UpdateStatus;
  private offer: ApkOffer | null = null;
  constructor(private readonly io: UpdateIo) {
    this.st = { phase: 'idle', current: io.current, latest: null, notes: null, progress: null, message: '', lastCheck: io.lastCheck(), canInstall: false };
  }

  status(): UpdateStatus {
    return this.st;
  }

  async check(): Promise<UpdateStatus> {
    this.st = { ...this.st, phase: 'checking', message: '' };
    try {
      const offer = offerFrom(await this.io.fetchJson(sourceUrl(this.io.setting())));
      const now = (this.io.now ?? Date.now)();
      this.io.remember(now);
      if (offer && compareVersions(offer.version, this.io.current) > 0) {
        this.offer = offer;
        this.st = { ...this.st, phase: 'available', latest: offer.version, notes: offer.notes ?? null, canInstall: true, lastCheck: now, message: `Version ${offer.version} is available. Install opens its download; tap the downloaded file to install it over this one.` };
      } else {
        this.offer = null;
        this.st = { ...this.st, phase: 'current', latest: null, notes: null, canInstall: false, lastCheck: now, message: 'You have the newest version.' };
      }
    } catch (e) {
      this.st = { ...this.st, phase: 'error', canInstall: false, message: `Could not look for updates: ${(e as Error).message}` };
    }
    return this.st;
  }

  /** Open the new APK's address: the phone downloads it and offers to install it. */
  install(): UpdateStatus {
    if (this.offer) this.io.open(this.offer.url);
    return this.st;
  }

  /** Look once a day, unless the person said never. */
  async maybeCheck(mode: string): Promise<void> {
    if (mode === 'off') return;
    if ((this.io.now ?? Date.now)() - this.io.lastCheck() < 20 * 3600 * 1000) return;
    await this.check();
  }
}
