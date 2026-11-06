/**
 * Process entry for the workspace worker. Runs either as an Electron utilityProcess or, for
 * development and tests, as a plain Node child process (the message channel differs, nothing else).
 */
import { configureLog, isLevel, log, setLogLevel, watchEventLoop } from '../shared/log';
import os from 'node:os';
import { activity, toWireError, WorkspaceService } from '@cave-notes/service/service';

// Logging: the main process hands over the log file, level and this worker's name through the environment.
configureLog({ file: process.env.CAVE_LOG_FILE || null, level: isLevel(process.env.CAVE_LOG) ? process.env.CAVE_LOG : 'info', tag: process.env.CAVE_LOG_TAG || 'worker', mirror: false });
log.info(`worker up pid=${process.pid} node=${process.versions.node} electron=${process.versions.electron ?? '-'}`);
watchEventLoop();
// Indexing is background work: it should never compete with the desktop for the CPU.
try {
  os.setPriority(process.pid, 10);
} catch (e) {
  log.debug('could not lower priority', e);
}
// One line a minute while there is activity: what the process did, how much CPU it used, and its memory.
let lastCpu = process.cpuUsage();
setInterval(() => {
  const c = process.cpuUsage(lastCpu);
  lastCpu = process.cpuUsage();
  const cpuPct = Math.round(((c.user + c.system) / 1000 / 60_000) * 100);
  if (activity.batches > 0 || cpuPct >= 5) {
    log.info(`last minute: cpu ${cpuPct}% of one core, ${activity.batches} change batch(es) covering ${activity.files} file(s), rss ${Math.round(process.memoryUsage.rss() / 1048576)} MB`);
  }
  activity.batches = 0;
  activity.files = 0;
}, 60_000).unref();

type Port = { post(msg: unknown): void };

const electronPort = (process as unknown as { parentPort?: { postMessage(m: unknown): void; on(ev: 'message', cb: (e: { data: unknown }) => void): void } }).parentPort;

let port: Port;
let onMessage: (cb: (msg: unknown) => void) => void;
if (electronPort) {
  port = { post: (m) => electronPort.postMessage(m) };
  onMessage = (cb) => electronPort.on('message', (e) => cb(e.data));
} else if (process.send) {
  port = { post: (m) => void process.send?.(m as never) };
  onMessage = (cb) => void process.on('message', cb);
} else {
  throw new Error('worker must be started with a message channel');
}

const service = new WorkspaceService((event, payload) => port.post({ event, payload }));

onMessage(async (msg) => {
  const m = msg as { logLevel?: unknown };
  if (m && isLevel(m.logLevel)) {
    setLogLevel(m.logLevel);
    log.info(`log level is now ${m.logLevel}`);
    return;
  }
  const { id, method, args } = msg as { id: number; method: string; args: unknown[] };
  try {
    port.post({ id, ok: true, value: await service.call(method, args ?? []) });
  } catch (e) {
    port.post({ id, ok: false, error: toWireError(e) });
  }
});

process.on('uncaughtException', (e) => log.error('uncaught exception', e));
process.on('unhandledRejection', (e) => log.error('unhandled rejection', e));
