/**
 * What the log screen shows. The application log (`cave-notes.log`: the main process, every workspace worker and the
 * windows' console errors, one line each) and, for each open workspace, its automation log (`automation.log`, one JSON
 * line per rule run, written out here as plain text). Only the end of a large file is read: it is the end that matters,
 * and a screen of several megabytes of text is slow to open.
 */
import fs from 'node:fs/promises';
import type { LogSource } from '../shared/api';

/** How much of the end of each file is shown. */
export const LOG_VIEW_BYTES = 2 * 1024 * 1024;

export interface AutomationLogRef {
  root: string;
  name: string;
  file: string;
}

const isFile = (f: string): Promise<boolean> => fs.stat(f).then((s) => s.isFile(), () => false);
const isAutomation = (s: LogSource): boolean => s.id.startsWith('automation:');

const sizeText = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The logs that exist right now, in the order the screen lists them. The first is the default. */
export async function listLogSources(appLog: string | null, automations: AutomationLogRef[]): Promise<LogSource[]> {
  const out: LogSource[] = [];
  if (appLog) {
    out.push({ id: 'app', label: 'Application log', path: appLog });
    if (await isFile(`${appLog}.1`)) out.push({ id: 'app-earlier', label: 'Application log (earlier part)', path: `${appLog}.1` });
  }
  const names = automations.map((a) => a.name);
  for (const a of automations) {
    if (!(await isFile(a.file))) continue;
    const label = names.filter((n) => n === a.name).length > 1 ? a.root : a.name; // two workspaces with one name: tell them apart by place
    out.push({ id: `automation:${a.root}`, label: `Automations: ${label}`, path: a.file });
  }
  return out.length > 1 ? [...out, { id: 'all', label: 'All logs', path: '' }] : out;
}

/** One line of `automation.log` (JSON) as a line of text, in the same style as the application log. Other lines pass unchanged. */
export function formatAutomationLine(line: string): string {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return line;
  }
  if (e === null || typeof e !== 'object' || typeof e.t !== 'number') return line;
  const when = new Date(e.t).toISOString();
  const head = `${when} ${String(e.status ?? '?').toUpperCase().padEnd(7)} ${String(e.rule ?? '?')}${e.path ? ` on ${String(e.path)}` : ''} (${String(e.trigger ?? '?')})${e.dry === true ? ' [dry run]' : ''}`;
  return e.detail ? `${head} - ${String(e.detail)}` : head;
}

/** The last `maxBytes` of a file, starting at a whole line. Null when it cannot be read. */
async function tail(file: string, maxBytes: number): Promise<{ text: string; size: number; cut: boolean } | null> {
  let fh: fs.FileHandle;
  try {
    fh = await fs.open(file, 'r');
  } catch {
    return null;
  }
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    let got = 0;
    while (got < buf.length) {
      const r = await fh.read(buf, got, buf.length - got, start + got);
      if (r.bytesRead === 0) break;
      got += r.bytesRead;
    }
    let text = buf.subarray(0, got).toString('utf8');
    if (start > 0) {
      const nl = text.indexOf('\n'); // the first line is probably a piece of one
      text = nl >= 0 ? text.slice(nl + 1) : '';
    }
    return { text, size, cut: start > 0 };
  } finally {
    await fh.close();
  }
}

async function textOf(s: LogSource, maxBytes: number): Promise<string> {
  const t = await tail(s.path, maxBytes);
  if (!t) return '(this log could not be read)\n';
  let text = isAutomation(s) ? t.text.split('\n').map((l) => (l.trim() === '' ? l : formatAutomationLine(l))).join('\n') : t.text;
  if (text.trim() === '') text = '(nothing has been logged yet)\n';
  if (t.cut) text = `[Only the end of this log is shown (${sizeText(maxBytes)} of ${sizeText(t.size)}). The whole file is ${s.path}]\n\n${text}`;
  return text.endsWith('\n') ? text : `${text}\n`;
}

/** The text of one log, or of all of them one after the other (the earlier part of the application log first). */
export async function readLogSource(sources: LogSource[], id: string, maxBytes = LOG_VIEW_BYTES): Promise<{ id: string; label: string; text: string }> {
  if (id === 'all') {
    const order = [...sources.filter((s) => s.id === 'app-earlier'), ...sources.filter((s) => s.id === 'app'), ...sources.filter(isAutomation)];
    const parts: string[] = [];
    for (const s of order) parts.push(`===== ${s.label} (${s.path}) =====\n\n${await textOf(s, maxBytes)}`);
    return { id, label: 'All logs', text: parts.length > 0 ? parts.join('\n') : '(there are no logs yet)\n' };
  }
  const s = sources.find((x) => x.id === id);
  if (!s) throw new Error('There is no such log.');
  return { id, label: s.label, text: await textOf(s, maxBytes) };
}
