// Runs the built app in a virtual display and drives it with a script. Usage: node e2e/run.mjs [script.cjs]
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSample } from './sample-workspace.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(process.argv[2] ?? path.join(here, 'shots.cjs'));
const workspace = process.env.CAVE_SAMPLE ?? '/tmp/cave-sample';
const userData = '/tmp/cave-e2e-userdata';
const shots = process.env.CAVE_SHOTS ?? '/tmp/cave-shots';

await createSample(workspace);
await fs.rm(userData, { recursive: true, force: true });
await fs.rm(shots, { recursive: true, force: true });
await fs.mkdir(shots, { recursive: true });

const electron = path.resolve(here, '../../../node_modules/.bin/electron');
const child = spawn('xvfb-run', ['-a', '-s', '-screen 0 1440x900x24', electron, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`, path.resolve(here, '..'), ...(process.env.CAVE_ARGS ? process.env.CAVE_ARGS.split(' ') : [])], {
  stdio: 'inherit',
  env: { ...process.env, CAVE_WORKER_NODE: '1', CAVE_OPEN: process.env.CAVE_NO_WORKSPACE ? '' : workspace, CAVE_E2E: script, CAVE_SHOTS: shots, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
});
const code = await new Promise((r) => child.on('exit', r));
console.log(`electron exited with ${code}; screenshots in ${shots}`);
process.exit(code ?? 1);
