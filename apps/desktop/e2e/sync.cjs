// Drives the new behaviour: a file opened on its own, accent colours, merging with disk changes, conflict copies, moves, deletion.
// Run with:  CAVE_ARGS=/tmp/solo/Solo.md node e2e/run.mjs e2e/sync.cjs
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ win, app }) => {
  const shots = process.env.CAVE_SHOTS;
  const ws = process.env.CAVE_SAMPLE ?? '/tmp/cave-sample';
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    await sleep(400);
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
  const check = (cond, what) => {
    if (!cond) throw new Error(`CHECK FAILED: ${what}`);
    console.log('[e2e] ok:', what);
  };
  try {
    win.setSize(1360, 840);
    await waitFor('window.__cave && window.__cave.workspace.value && window.__cave.tree.rows.length > 0', 'workspace');
    await waitFor("window.__cave.indexStatus.value.state === 'ready'", 'indexing');
    await waitFor('window.__cave.tabs.value.some((t) => t.single)', 'the single-file tab');
    check((await js('window.__cave.activeSingle.value')) === true, 'the file given on the command line is shown on its own');
    await shot('10-single-file');

    // accent colours: shown tab = middle shade, title bar = darkest shade
    await js(`window.__cave.activateTab(window.__cave.tabs.value.find((t) => !t.single).id)`);
    await js(`window.__cave.setWorkspaceLook(window.__cave.workspace.value.root, { color: '#2875e0' })`);
    await js(`window.__cave.openPage('Welcome.md', { reveal: true })`);
    await sleep(700);
    await shot('11-accent-dark');
    await js(`window.__cave.setTheme('light')`);
    await shot('12-accent-light');
    await js(`window.__cave.setTheme('dark')`);

    // back and forward
    await js(`window.__cave.openPage('Theology/Soteriology.md', { reveal: true })`);
    await sleep(500);
    check((await js('window.__cave.canGoBack.value')) === true, 'back is available after opening a second page');
    await js('window.__cave.stepHistory(-1)');
    await sleep(500);
    check((await js('window.__cave.current.value.path')) === 'Welcome.md', 'back returns to the previous page');
    check((await js('window.__cave.canGoForward.value')) === true, 'forward is available');
    await js('window.__cave.stepHistory(1)');
    await sleep(500);

    // typing here while the file changes on disk: both survive
    await js(`window.__cave.setConflictMerge('auto')`);
    const file = path.join(ws, 'Theology', 'Soteriology.md');
    const original = fs.readFileSync(file, 'utf8');
    await js(`window.__cave.editor.applyChanges([{ from: 0, to: 0, insert: 'TYPED HERE\\n' }], { undoable: true })`);
    fs.writeFileSync(file, original + '\nWRITTEN ON DISK\n');
    await waitFor(`window.__cave.editor.text().includes('TYPED HERE') && window.__cave.editor.text().includes('WRITTEN ON DISK')`, 'editor holding both edits');
    await waitFor(`window.__cave.saveState.value === 'saved'`, 'saved');
    const onDisk = fs.readFileSync(file, 'utf8');
    check(onDisk.includes('TYPED HERE') && onDisk.includes('WRITTEN ON DISK'), 'disk holds both edits after the merge');
    await shot('13-merged');

    // a Syncthing conflict copy is merged in and removed
    const copy = path.join(ws, 'Theology', 'Soteriology.sync-conflict-20260101-120000-ABCDEFG.md');
    fs.writeFileSync(copy, original + '\nFROM THE OTHER DEVICE\n');
    await waitFor(`!${JSON.stringify(fs.existsSync(copy))} || true`, 'copy written');
    for (let i = 0; i < 100 && fs.existsSync(copy); i++) await sleep(100);
    check(!fs.existsSync(copy), 'the conflict copy was deleted');
    await waitFor(`window.__cave.editor.text().includes('FROM THE OTHER DEVICE')`, 'copy merged into the open page');
    check(fs.readFileSync(file, 'utf8').includes('FROM THE OTHER DEVICE'), 'the copy is merged into the page on disk');

    // a move keeps the page open
    const moved = path.join(ws, 'Theology', 'Moved Away.md');
    fs.renameSync(file, moved);
    await waitFor(`window.__cave.current.value && window.__cave.current.value.path === 'Theology/Moved Away.md'`, 'page following its move');
    check(true, 'a moved page stays open at its new path');
    await shot('14-moved');

    // deletion asks
    fs.rmSync(moved);
    await waitFor(`window.__cave.dialog.value && window.__cave.dialog.value.kind === 'choose'`, 'the deletion question');
    await shot('15-deleted-asks');
    await js(`window.__cave.dialog.value.resolve('keep'); window.__cave.dialog.value = null`);
    await waitFor(`${JSON.stringify(true)}`, 'x');
    for (let i = 0; i < 50 && !fs.existsSync(moved); i++) await sleep(100);
    check(fs.existsSync(moved), 'keeping the page writes it again');
    console.log('[e2e] ALL CHECKS PASSED');
  } catch (e) {
    console.error('[e2e] FAILED', e);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
};
