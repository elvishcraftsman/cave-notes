// The updater, end to end: a local server offers a newer AppImage; the running "AppImage" file is replaced under its own name.
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
module.exports = async ({ win, app }) => {
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (expr, what, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(`Boolean(${expr})`)) return; await sleep(100); } throw new Error(`timeout waiting for ${what}`); };
  const fresh = Buffer.alloc(2_500_000, 9);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 0x02]).copy(fresh, 0);
  Buffer.from('NEWVERSION').copy(fresh, 100);
  const sha = crypto.createHash('sha256').update(fresh).digest('hex');
  const server = http.createServer((req, res) => {
    if (req.url === '/latest.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ version: '0.2.0', url: 'files/Cave_Notes-0.2.0-x86_64.AppImage', sha256: sha })); }
    else if (req.url.startsWith('/files/')) { res.setHeader('content-length', fresh.length); res.end(fresh); }
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise((r) => server.listen(8765, '127.0.0.1', r));
  const target = process.env.APPIMAGE;
  try {
    await waitFor('window.__cave && window.__cave.workspace.value', 'workspace');
    const before = fs.readFileSync(target).subarray(100, 107).toString();
    await js(`window.__cave.setPreferences({ updateUrl: 'http://127.0.0.1:8765/latest.json', updateMode: 'install' })`);
    await sleep(500);
    await js(`window.__cave.checkForUpdate()`);
    await waitFor("window.__cave.update.value && ['ready','error'].includes(window.__cave.update.value.phase)", 'update', 30000);
    console.log('[e2e] state:', JSON.stringify(await js(`window.__cave.update.value`)));
    console.log('[e2e] before:', before, 'after:', fs.readFileSync(target).subarray(100, 110).toString());
    console.log('[e2e] directory:', fs.readdirSync(require('node:path').dirname(target)).join(', '));
    console.log('[e2e] executable:', (fs.statSync(target).mode & 0o111) !== 0);
    console.log('[e2e] lastUpdateCheck saved:', await js(`window.__cave.settings.value.lastUpdateCheck > 0`));
  } catch (e) { console.error('[e2e] FAILED', e); process.exitCode = 1; } finally { server.close(); app.quit(); }
};
