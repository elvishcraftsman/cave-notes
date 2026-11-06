/**
 * The app's updater: looks for a newer AppImage about once a day, and (unless told only to say so) puts it in the old one's
 * place. The steps themselves are in updater.ts; this keeps the schedule and what the window is told.
 */
import type { Settings } from '../shared/api';
import { findUpdate, installUpdate, UpdateError, type UpdateOffer, type Variant } from './updater';

export type UpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';

export interface UpdateState {
  phase: UpdatePhase;
  /** the version that runs */
  current: string;
  /** the newer version found */
  latest: string | null;
  /** a page about the release, when the source has one */
  notes: string | null;
  /** 0 to 1 while downloading */
  progress: number | null;
  /** a sentence for the person: what went wrong, or what happened */
  message: string;
  /** when the last successful look was made (ms since 1970); 0 for never */
  lastCheck: number;
  /** is this an AppImage that can replace itself? (otherwise the app only says that there is a newer version) */
  canInstall: boolean;
}

export interface UpdateDeps {
  version: string;
  /** the AppImage that runs ($APPIMAGE), or null when the app runs some other way */
  appImage: string | null;
  variant: Variant;
  backupDir: string;
  settings(): Pick<Settings, 'updateMode' | 'updateUrl' | 'lastUpdateCheck'>;
  remember(patch: { lastUpdateCheck: number }): void;
  fetch: Parameters<typeof findUpdate>[0]['fetch'];
  emit(state: UpdateState): void;
  now?(): number;
}

/** About a day: a little less, so that a check made at the same time of day each day is not always just too early. */
export const CHECK_EVERY_MS = 22 * 60 * 60 * 1000;
/** After a failed look (no network, say), try again after this. */
export const RETRY_AFTER_MS = 60 * 60 * 1000;

export class UpdateManager {
  private st: UpdateState;
  private offer: UpdateOffer | null = null;
  private busy = false;
  private lastAttempt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private first: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly d: UpdateDeps) {
    this.st = { phase: 'idle', current: d.version, latest: null, notes: null, progress: null, message: '', lastCheck: d.settings().lastUpdateCheck, canInstall: d.appImage !== null };
  }

  private now(): number {
    return this.d.now ? this.d.now() : Date.now();
  }

  state(): UpdateState {
    return { ...this.st, lastCheck: this.d.settings().lastUpdateCheck || this.st.lastCheck };
  }

  private set(patch: Partial<UpdateState>): void {
    this.st = { ...this.st, ...patch };
    this.d.emit(this.state());
  }

  /** Whether the daily look is due: never off, a day since the last one, and an hour since a failed one. */
  due(): boolean {
    const s = this.d.settings();
    if (s.updateMode === 'off') return false;
    const t = this.now();
    return t - s.lastUpdateCheck >= CHECK_EVERY_MS && t - this.lastAttempt >= RETRY_AFTER_MS;
  }

  /** Start looking: once shortly after the app has started (so it does not compete with opening the workspace), then hourly to see if a day has passed. */
  start(firstDelayMs = 45_000): void {
    this.stop();
    this.first = setTimeout(() => void this.tick(), firstDelayMs);
    this.timer = setInterval(() => void this.tick(), 60 * 60 * 1000);
    this.first.unref?.();
    this.timer.unref?.();
  }

  stop(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
    this.first = this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.due() && !this.busy && this.st.phase !== 'ready') await this.check(false);
  }

  /** Look for a newer version now. A person asking (`manual`) gets an answer even when the mode is off; what is found is installed only in the `install` mode, else it waits for the Install button. */
  async check(_manual: boolean): Promise<UpdateState> {
    if (this.busy) return this.state();
    this.busy = true;
    this.lastAttempt = this.now();
    this.set({ phase: 'checking', message: '', progress: null });
    try {
      const s = this.d.settings();
      const offer = await findUpdate({ current: this.d.version, source: s.updateUrl, variant: this.d.variant, fetch: this.d.fetch });
      this.d.remember({ lastUpdateCheck: this.now() });
      if (!offer) {
        this.offer = null;
        this.set({ phase: 'current', latest: null, notes: null, message: `Cave Notes ${this.d.version} is the newest version.` });
        return this.state();
      }
      this.offer = offer;
      this.set({ phase: 'available', latest: offer.version, notes: offer.notes ?? null, message: `Version ${offer.version} is available.` });
      if (this.st.canInstall && s.updateMode === 'install') {
        this.busy = false;
        return await this.install();
      }
      return this.state();
    } catch (e) {
      this.set({ phase: 'error', message: e instanceof UpdateError ? e.message : `The look for an update failed: ${(e as Error).message}` });
      return this.state();
    } finally {
      this.busy = false;
    }
  }

  /** Download the version found and put it in the old file's place. */
  async install(): Promise<UpdateState> {
    const offer = this.offer;
    const target = this.d.appImage;
    if (!offer || !target) {
      this.set({ phase: 'error', message: target ? 'There is no update to install. Look for one first.' : 'Only an AppImage can replace itself. This copy of the app was not started from one.' });
      return this.state();
    }
    if (this.busy) return this.state();
    this.busy = true;
    let lastShown = -1;
    this.set({ phase: 'downloading', progress: 0, message: `Downloading ${offer.version}…` });
    try {
      await installUpdate({
        offer,
        target,
        fetch: this.d.fetch,
        backupDir: this.d.backupDir,
        onProgress: (done, total) => {
          if (!total) return;
          const p = Math.min(1, done / total);
          if (p - lastShown >= 0.01) {
            lastShown = p;
            this.set({ progress: p });
          }
        },
      });
      this.set({ phase: 'ready', progress: 1, message: `Version ${offer.version} is in place. Restart Cave Notes to use it.` });
    } catch (e) {
      this.set({ phase: 'error', progress: null, message: e instanceof UpdateError ? e.message : `The update could not be installed: ${(e as Error).message}` });
    } finally {
      this.busy = false;
    }
    return this.state();
  }
}
