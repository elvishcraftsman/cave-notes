// The app's preferences, kept as one JSON file in the app's private folder. Same rules as desktop (normalizeSettings), but the
// file is read once when the app starts and written a moment after each change, through the asynchronous file layer.
import { DEFAULT_SETTINGS, normalizeSettings } from '@cave-notes/service/settings';
import type { Settings } from '@cave-notes/service/api';
import type { createPluginFs } from './pluginFs';

type Fs = ReturnType<typeof createPluginFs>;

/** What differs from the desktop's starting point: a phone does not go looking through all of its storage for workspaces unasked. */
const ANDROID_DEFAULTS: Partial<Settings> = { scanAuto: false, showLeft: false, showRight: false, deviceName: '' };

export class AndroidSettings {
  private value: Settings = normalizeSettings({ ...ANDROID_DEFAULTS });
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly fs: Fs,
    private readonly file: string,
  ) {}

  /** Read the saved settings (first run or an unreadable file keeps the defaults). */
  async load(): Promise<void> {
    try {
      const raw = JSON.parse((await this.fs.readFile(this.file, 'utf8')) as string) as Partial<Settings>;
      this.value = normalizeSettings({ ...ANDROID_DEFAULTS, ...raw });
    } catch {
      this.value = normalizeSettings({ ...ANDROID_DEFAULTS });
    }
  }

  get(): Settings {
    return this.value;
  }

  set(patch: Partial<Settings>): Settings {
    this.value = { ...this.value, ...patch };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 300);
    return this.value;
  }

  /** Remember a workspace at the top of the recent list. */
  remember(root: string): void {
    const recent = [root, ...this.value.recent.filter((r) => r !== root)].slice(0, 8);
    this.set({ recent, lastWorkspace: root });
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const text = JSON.stringify(this.value, null, 2);
    this.saving = this.saving.then(async () => {
      try {
        const dir = this.file.replace(/\/[^/]*$/, '');
        await this.fs.mkdir(dir, { recursive: true });
        const tmp = `${this.file}.tmp`;
        await this.fs.writeFile(tmp, text);
        await this.fs.rename(tmp, this.file);
      } catch {
        /* settings are not worth crashing for */
      }
    });
    return this.saving;
  }
}

export { DEFAULT_SETTINGS };
