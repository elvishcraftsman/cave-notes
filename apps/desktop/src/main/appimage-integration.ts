/**
 * Desktop integration for the AppImage build: on the first run (and whenever the AppImage has been moved, renamed or
 * updated) a launcher entry and the icons are put into the user's own data folder, so the app shows up in the
 * application grid with its icon and can open Markdown files:
 *
 *   $XDG_DATA_HOME/applications/cave-notes.desktop
 *   $XDG_DATA_HOME/icons/hicolor/<size>x<size>/apps/cave-notes.png   (and scalable/apps/cave-notes.svg)
 *
 * It is done for the AppImage (the runtime sets $APPIMAGE) and, with a `command`, for any other way of running the app (an
 * unpacked build, or a source checkout started with Electron), so that the app can be found in "Open With" wherever it
 * runs from. Nothing outside the user's home is touched. A launcher that
 * this app did not write is never overwritten. Opt out with CAVE_NO_DESKTOP_INTEGRATION=1, or run the AppImage once
 * with --remove-desktop-integration (removes the files and remembers the choice; --install-desktop-integration undoes it).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DESKTOP_ID = 'cave-notes';
export const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512] as const;
/** First line written into launchers made here: only files carrying it are ever replaced or removed. */
export const MARKER = 'X-Cave-Notes-AppImage=true';

export type IntegrationResult = 'installed' | 'updated' | 'current' | 'not-appimage' | 'opted-out' | 'foreign-launcher';

export interface IntegrationOptions {
  /** absolute path of the AppImage file ($APPIMAGE) */
  appImage: string | undefined;
  /** how to start the app when it is not an AppImage: the program, then its arguments (an unpacked build is just its executable) */
  command?: string[];
  /** the folder with `<size>.png` and `cave-notes.svg` */
  iconsDir: string;
  version: string;
  /** default $XDG_DATA_HOME or ~/.local/share */
  dataHome?: string;
  /** a file whose presence means "the user removed the integration, do not bring it back" */
  optOutFile?: string;
  env?: NodeJS.ProcessEnv;
}

export const dataHomeOf = (env: NodeJS.ProcessEnv = process.env): string =>
  env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.join(os.homedir(), '.local', 'share');

/** A path as one argument of an Exec= line (Desktop Entry spec: double quotes, with \ " ` $ escaped, and % doubled). */
export function quoteExecArg(p: string): string {
  const inner = p.replace(/[\\"`$]/g, (c) => `\\${c}`).replace(/%/g, '%%');
  return `"${inner}"`;
}

/** Desktop-file values are strings in which a backslash starts an escape, so each one is doubled again. */
const valueEscape = (s: string): string => s.replace(/\\/g, '\\\\');

export function desktopEntry(launch: string | string[], version: string): string {
  const argv = typeof launch === 'string' ? [launch] : launch;
  const appImage = argv[0]!;
  return [
    '[Desktop Entry]',
    MARKER,
    `X-AppImage-Version=${version}`,
    'Type=Application',
    'Version=1.0',
    'Name=Cave Notes',
    'GenericName=Hierarchical Notes',
    'Comment=Notes as a hierarchy of Markdown pages',
    `Exec=${valueEscape(argv.map(quoteExecArg).join(' '))} %F`,
    `TryExec=${valueEscape(appImage)}`,
    `Icon=${DESKTOP_ID}`,
    'Terminal=false',
    'Categories=Office;TextEditor;',
    'MimeType=text/markdown;text/x-markdown;',
    'Keywords=notes;markdown;outline;wiki;',
    `StartupWMClass=${DESKTOP_ID}`,
    'StartupNotify=true',
    '',
  ].join('\n');
}

const paths = (dataHome: string) => ({
  desktop: path.join(dataHome, 'applications', `${DESKTOP_ID}.desktop`),
  png: (s: number) => path.join(dataHome, 'icons', 'hicolor', `${s}x${s}`, 'apps', `${DESKTOP_ID}.png`),
  svg: path.join(dataHome, 'icons', 'hicolor', 'scalable', 'apps', `${DESKTOP_ID}.svg`),
});

/** Write a file only if its content differs; through a temporary file so a reader never sees half of it. */
function writeIfChanged(file: string, data: string | Buffer): boolean {
  const next = typeof data === 'string' ? Buffer.from(data) : data;
  try {
    if (fs.readFileSync(file).equals(next)) return false;
  } catch {
    /* missing: write it */
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, file);
  return true;
}

export function integrate(o: IntegrationOptions): IntegrationResult {
  const env = o.env ?? process.env;
  const launch: string[] | null = o.appImage ? [o.appImage] : o.command && o.command.length > 0 ? o.command : null;
  if (!launch) return 'not-appimage';
  if (env.CAVE_NO_DESKTOP_INTEGRATION === '1' || (o.optOutFile && fs.existsSync(o.optOutFile))) return 'opted-out';
  const dst = paths(o.dataHome ?? dataHomeOf(env));

  let existed = false;
  try {
    const old = fs.readFileSync(dst.desktop, 'utf8');
    if (!old.includes(MARKER)) return 'foreign-launcher';
    existed = true;
  } catch {
    /* none yet */
  }

  let changed = false;
  for (const s of ICON_SIZES) {
    try {
      changed = writeIfChanged(dst.png(s), fs.readFileSync(path.join(o.iconsDir, `${s}.png`))) || changed;
    } catch {
      /* a missing size is not worth failing for */
    }
  }
  try {
    changed = writeIfChanged(dst.svg, fs.readFileSync(path.join(o.iconsDir, `${DESKTOP_ID}.svg`))) || changed;
  } catch {
    /* no scalable icon */
  }
  // the launcher goes last, so an entry never exists without its icon
  changed = writeIfChanged(dst.desktop, desktopEntry(launch, o.version)) || changed;

  if (changed) refreshCaches(path.dirname(dst.desktop), path.join(o.dataHome ?? dataHomeOf(env), 'icons', 'hicolor'));
  return !changed ? 'current' : existed ? 'updated' : 'installed';
}

/** Remove what `integrate` wrote (only a launcher that carries the marker). Returns the files removed. */
export function removeIntegration(dataHome: string = dataHomeOf()): string[] {
  const dst = paths(dataHome);
  const removed: string[] = [];
  try {
    if (!fs.readFileSync(dst.desktop, 'utf8').includes(MARKER)) return removed;
  } catch {
    return removed;
  }
  for (const f of [dst.desktop, ...ICON_SIZES.map(dst.png), dst.svg]) {
    try {
      fs.rmSync(f);
      removed.push(f);
    } catch {
      /* already gone */
    }
  }
  refreshCaches(path.dirname(dst.desktop), path.join(dataHome, 'icons', 'hicolor'));
  return removed;
}

/** Best effort and never blocking: ask the desktop to notice the change (these tools may not exist). */
function refreshCaches(applicationsDir: string, hicolorDir: string): void {
  const run = (cmd: string, args: string[]): void => {
    try {
      const c = spawn(cmd, args, { stdio: 'ignore', detached: true });
      c.on('error', () => undefined);
      c.unref();
    } catch {
      /* not installed */
    }
  };
  run('update-desktop-database', [applicationsDir]);
  // only useful where a cache already exists; GTK ignores a stale one but rebuilding is cheap
  if (fs.existsSync(path.join(hicolorDir, 'icon-theme.cache'))) run('gtk-update-icon-cache', ['-f', '-t', hicolorDir]);
}
