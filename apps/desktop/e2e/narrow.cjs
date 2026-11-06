// Phone-sized tour: the page sidebar as a drawer, the page, the outline drawer. Runs inside Electron's main process.
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ win, app }) => {
  const shots = process.env.CAVE_SHOTS;
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    await sleep(500);
    fs.writeFileSync(path.join(shots, `${name}.png`), (await win.webContents.capturePage()).toPNG());
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
    win.setMinimumSize(300, 300);
    win.setSize(390, 800);
    // behave like a phone: touch input (a coarse pointer), so rows are taller and nothing waits for hover
    win.webContents.enableDeviceEmulation({ screenPosition: 'mobile', screenSize: { width: 390, height: 800 }, viewSize: { width: 390, height: 800 }, deviceScaleFactor: 2 });
    win.webContents.reload();
    await sleep(1500);
    await waitFor('window.__cave && window.__cave.workspace.value && window.__cave.tree.rows.length > 0', 'workspace');
    await js(`window.__cave.settings.value = { ...window.__cave.settings.value, showLeft: true, showRight: false }`);
    await shot('n1-tree-drawer');
    console.log('[e2e] coarse=', await js(`matchMedia('(pointer: coarse)').matches`), 'narrow=', await js(`matchMedia('(max-width: 720px)').matches`));
    await js(`document.querySelector('.tree-row[role=treeitem]').click()`);
    await sleep(1200);
    console.log('[e2e] left drawer still open after tapping a page:', await js(`window.__cave.settings.value.showLeft`));
    await shot('n2-page');
    await js(`window.__cave.settings.value = { ...window.__cave.settings.value, showRight: true }`);
    await shot('n3-outline-drawer');
  } catch (e) {
    console.error('[e2e] failed:', e);
  } finally {
    app.quit();
  }
};
