import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, normalizeSettings } from '@cave-notes/service/settings';
import type { Settings } from '../shared/api';

// The rules for what a settings file may hold live in the service package, shared with the Android app.
export * from '@cave-notes/service/settings';

export class SettingsStore {
  private value: Settings = { ...DEFAULT_SETTINGS };
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string) {
    try {
      this.value = normalizeSettings(JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Settings>);
    } catch {
      /* first run or unreadable: defaults */
    }
  }

  get(): Settings {
    return this.value;
  }

  set(patch: Partial<Settings>): Settings {
    this.value = { ...this.value, ...patch };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
    return this.value;
  }

  /** Remember a workspace at the top of the recent list. */
  remember(root: string): void {
    const recent = [root, ...this.value.recent.filter((r) => r !== root)].slice(0, 8);
    this.set({ recent, lastWorkspace: root });
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.value, null, 2));
      fs.renameSync(tmp, this.file);
    } catch {
      /* settings are not worth crashing for */
    }
  }
}
