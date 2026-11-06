// Drives the window through a tour and saves screenshots. Runs inside Electron's main process.
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ win, app }) => {
  const shots = process.env.CAVE_SHOTS;
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    await sleep(350);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shots, `${name}.png`), img.toPNG());
    console.log('[e2e] shot', name);
  };
  const waitFor = async (expr, what, ms = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await js(`Boolean(${expr})`)) return;
      await sleep(100);
    }
    throw new Error(`timeout waiting for ${what}`);
  };
  try {
    win.setSize(1360, 840);
    await waitFor('window.__cave && window.__cave.workspace.value && window.__cave.tree.rows.length > 0', 'workspace');
    await waitFor("window.__cave.indexStatus.value.state === 'ready'", 'indexing');
    await js(`window.__cave.tree.reveal('Theology/Soteriology.md')`);
    await js(`window.__cave.openPage('Theology/Soteriology.md', { reveal: true })`);
    await sleep(800);
    await shot('01-dark-soteriology');

    await js(`window.__cave.setRightTab('links')`);
    await shot('02-dark-links');

    await js(`window.__cave.setRightTab('outline'); window.__cave.openPage('Welcome.md', { reveal: true })`);
    await sleep(600);
    await shot('03-dark-welcome');

    await js(`window.__cave.setTheme('light')`);
    await sleep(500);
    await shot('04-light-welcome');
    await js(`window.__cave.openPage('Theology/Soteriology.md', { reveal: true })`);
    await sleep(700);
    await shot('05-light-soteriology');
    await js(`window.__cave.setTheme('dark')`);
  } catch (e) {
    console.error('[e2e] FAILED', e);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
};
