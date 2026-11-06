import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { desktopEntry, ICON_SIZES, integrate, MARKER, quoteExecArg, removeIntegration } from '../src/main/appimage-integration';

let tmp: string;
let data: string;
let icons: string;
const env = { CAVE_NO_DESKTOP_INTEGRATION: undefined } as NodeJS.ProcessEnv;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cave-integ-'));
  data = path.join(tmp, 'share');
  icons = path.join(tmp, 'icons');
  fs.mkdirSync(icons);
  for (const s of ICON_SIZES) fs.writeFileSync(path.join(icons, `${s}.png`), `png${s}`);
  fs.writeFileSync(path.join(icons, 'cave-notes.svg'), '<svg/>');
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const desktop = (): string => path.join(data, 'applications', 'cave-notes.desktop');
const run = (appImage = '/home/me/Apps/Cave Notes.AppImage', extra: Partial<Parameters<typeof integrate>[0]> = {}) =>
  integrate({ appImage, iconsDir: icons, version: '1.2.3', dataHome: data, env, ...extra });

describe('quoteExecArg', () => {
  it('quotes spaces and escapes the characters the Desktop Entry spec names', () => {
    expect(quoteExecArg('/a b/c.AppImage')).toBe('"/a b/c.AppImage"');
    expect(quoteExecArg('/a"b$c`d\\e%f')).toBe('"/a\\"b\\$c\\`d\\\\e%%f"');
  });
});

describe('desktopEntry', () => {
  it('points Exec and TryExec at the AppImage and carries the marker', () => {
    const t = desktopEntry('/x/y z.AppImage', '1.2.3');
    expect(t).toContain(MARKER);
    expect(t).toContain('Exec="/x/y z.AppImage" %F');
    expect(t).toContain('TryExec=/x/y z.AppImage');
    expect(t).toContain('Icon=cave-notes');
  });
});

describe('integrate', () => {
  it('does nothing outside an AppImage', () => {
    expect(integrate({ appImage: undefined, iconsDir: icons, version: '1', dataHome: data, env })).toBe('not-appimage');
    expect(fs.existsSync(desktop())).toBe(false);
  });

  it('also works for an unpacked build or a source checkout, started by a command', () => {
    expect(integrate({ appImage: undefined, command: ['/opt/cave/cave-notes'], iconsDir: icons, version: '1', dataHome: data, env })).toBe('installed');
    expect(fs.readFileSync(desktop(), 'utf8')).toContain('Exec="/opt/cave/cave-notes" %F');
    expect(fs.readFileSync(desktop(), 'utf8')).toContain('MimeType=text/markdown;');
    expect(integrate({ appImage: undefined, command: ['/src/node_modules/electron/dist/electron', '/src/apps/desktop'], iconsDir: icons, version: '1', dataHome: data, env })).toBe('updated');
    expect(fs.readFileSync(desktop(), 'utf8')).toContain('Exec="/src/node_modules/electron/dist/electron" "/src/apps/desktop" %F');
    expect(fs.readFileSync(desktop(), 'utf8')).toContain('TryExec=/src/node_modules/electron/dist/electron');
  });

  it('installs the launcher and every icon on the first run, then leaves them alone', () => {
    expect(run()).toBe('installed');
    expect(fs.readFileSync(desktop(), 'utf8')).toContain('Exec="/home/me/Apps/Cave Notes.AppImage" %F');
    for (const s of ICON_SIZES) expect(fs.readFileSync(path.join(data, 'icons/hicolor', `${s}x${s}`, 'apps/cave-notes.png'), 'utf8')).toBe(`png${s}`);
    expect(fs.existsSync(path.join(data, 'icons/hicolor/scalable/apps/cave-notes.svg'))).toBe(true);
    expect(run()).toBe('current');
  });

  it('follows the AppImage when it is moved or the version changes', () => {
    run('/old/Cave.AppImage');
    expect(run('/new/Cave.AppImage')).toBe('updated');
    expect(fs.readFileSync(desktop(), 'utf8')).toContain('"/new/Cave.AppImage"');
    expect(run('/new/Cave.AppImage', { version: '2.0.0' })).toBe('updated');
    expect(fs.readFileSync(desktop(), 'utf8')).toContain('X-AppImage-Version=2.0.0');
  });

  it('puts back an icon that was deleted', () => {
    run();
    const f = path.join(data, 'icons/hicolor/48x48/apps/cave-notes.png');
    fs.rmSync(f);
    expect(run()).toBe('updated');
    expect(fs.existsSync(f)).toBe(true);
  });

  it('never replaces a launcher it did not write', () => {
    fs.mkdirSync(path.dirname(desktop()), { recursive: true });
    fs.writeFileSync(desktop(), '[Desktop Entry]\nName=Mine\nExec=custom\n');
    expect(run()).toBe('foreign-launcher');
    expect(fs.readFileSync(desktop(), 'utf8')).toContain('Exec=custom');
    expect(removeIntegration(data)).toEqual([]);
    expect(fs.existsSync(desktop())).toBe(true);
  });

  it('respects the opt-out switches', () => {
    expect(run('/a.AppImage', { env: { CAVE_NO_DESKTOP_INTEGRATION: '1' } as NodeJS.ProcessEnv })).toBe('opted-out');
    const flag = path.join(tmp, 'off');
    fs.writeFileSync(flag, '');
    expect(run('/a.AppImage', { optOutFile: flag })).toBe('opted-out');
    expect(fs.existsSync(desktop())).toBe(false);
  });

  it('removes what it installed', () => {
    run();
    const gone = removeIntegration(data);
    expect(gone).toContain(desktop());
    expect(gone).toHaveLength(ICON_SIZES.length + 2);
    expect(fs.existsSync(desktop())).toBe(false);
  });
});
