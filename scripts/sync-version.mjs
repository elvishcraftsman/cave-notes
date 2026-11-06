// Copies the version of the package.json at the top of the repository into apps/desktop/package.json, which the app's
// About box and the packager read. Run by `npm version` (see the "version" script) and by the AppImage build.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const top = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = JSON.parse(await readFile(join(top, 'package.json'), 'utf8'));
const file = join(top, 'apps', 'desktop', 'package.json');
const text = await readFile(file, 'utf8');
const desktop = JSON.parse(text);
if (desktop.version !== root.version) {
  await writeFile(file, text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${root.version}$2`));
  console.log(`apps/desktop/package.json: ${desktop.version} -> ${root.version}`);
}
