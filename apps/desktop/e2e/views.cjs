// Editing in database views: checkbox, select, multi-select, date, text, title. Run: node e2e/run.mjs e2e/views.cjs
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({ win, app }) => {
  const shots = process.env.CAVE_SHOTS;
  const ws = process.env.CAVE_SAMPLE ?? '/tmp/cave-sample';
  const js = (c) => win.webContents.executeJavaScript(c, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (expr, what, ms = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await js(`Boolean(${expr})`)) return;
      await sleep(100);
    }
    throw new Error(`timeout waiting for ${what}`);
  };
  const check = (c, w) => { if (!c) throw new Error(`CHECK FAILED: ${w}`); console.log('[e2e] ok:', w); };
  const read = (rel) => fs.readFileSync(path.join(ws, rel), 'utf8');
  try {
    win.setSize(1360, 840);
    fs.mkdirSync(path.join(ws, '.cave-notes'), { recursive: true });
    fs.writeFileSync(path.join(ws, '.cave-notes', 'schema.yaml'), 'attributes:\n  done: { type: bool }\n  kind: { type: select, values: [bug, feature, chore] }\n  labels: { type: multiselect, values: [ui, sync, docs] }\n  due: { type: date }\n');
    fs.mkdirSync(path.join(ws, 'Tasks'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'Tasks.md'), '---\nchildren:\n  done: false\n---\n# Tasks\n\n```view\ntype: table\nquery: under:$this\ncolumns: [title, done, kind, labels, due, note]\n```\n');
    fs.writeFileSync(path.join(ws, 'Tasks', 'First.md'), '# First\n');
    fs.writeFileSync(path.join(ws, 'Tasks', 'Second.md'), '---\nnote: hello\n---\n# Second\n');
    await waitFor('window.__cave && window.__cave.workspace.value && window.__cave.tree.rows.length > 0', 'workspace');
    await waitFor("window.__cave.indexStatus.value.state === 'ready'", 'indexing');
    await sleep(800);
    await js(`window.__cave.openPage('Tasks.md', { reveal: true })`);
    await waitFor(`document.querySelectorAll('.vb-table tbody tr').length === 2`, 'two rows');
    await sleep(500);
    check((await js(`document.querySelectorAll('.vb-table input.vb-checkbox').length`)) === 2, 'a checkbox in the done column of every row');
    await js(`document.querySelector('.vb-table tbody tr input.vb-checkbox').click()`);
    for (let i = 0; i < 50 && !/done: true/.test(read('Tasks/First.md')); i++) await sleep(100);
    check(/done: true/.test(read('Tasks/First.md')), 'ticking the checkbox writes done: true');
    await js(`(() => { const s = document.querySelector('.vb-table tbody tr select.vb-input'); s.value = 'bug'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    for (let i = 0; i < 50 && !/kind: bug/.test(read('Tasks/First.md')); i++) await sleep(100);
    check(/kind: bug/.test(read('Tasks/First.md')), 'the dropdown writes the chosen value');
    await js(`document.querySelector('.vb-table tbody tr .vb-multi-btn').click()`);
    await waitFor(`document.querySelector('.vb-multi-pop')`, 'multi-select popover');
    await js(`document.querySelectorAll('.vb-multi-pop input')[1].click()`);
    for (let i = 0; i < 50 && !/sync/.test(read('Tasks/First.md')); i++) await sleep(100);
    check(/labels:[\s\S]*sync/.test(read('Tasks/First.md')), 'the multi-select writes a list');
    await sleep(300);
    const shot = async (n) => { await sleep(300); fs.writeFileSync(path.join(shots, `${n}.png`), (await win.webContents.capturePage()).toPNG()); };
    await shot('20-view-editing');
    // text cell on the second row
    await js(`(() => { const b = [...document.querySelectorAll('.vb-table tbody tr')][1].querySelectorAll('.vb-cell-text'); b[b.length - 1].click(); })()`);
    await sleep(200);
    await js(`(() => { const i = document.querySelector('.vb-table input.vb-input[type=text]'); i.value = 'changed'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    for (let i = 0; i < 50 && !/note: changed/.test(read('Tasks/Second.md')); i++) await sleep(100);
    check(/note: changed/.test(read('Tasks/Second.md')), 'a text cell is edited in place');
    // title
    await js(`[...document.querySelectorAll('.vb-table tbody tr')][1].querySelector('.vb-open').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await sleep(200);
    await js(`(() => { const i = document.querySelector('.vb-table input.vb-input'); i.value = 'Renamed Second'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    for (let i = 0; i < 80 && !fs.existsSync(path.join(ws, 'Tasks', 'Renamed Second.md')); i++) await sleep(100);
    check(fs.existsSync(path.join(ws, 'Tasks', 'Renamed Second.md')) && /# Renamed Second/.test(read('Tasks/Renamed Second.md')), 'editing a title renames the page and its heading');
    console.log('[e2e] ALL CHECKS PASSED');
  } catch (e) {
    console.error('[e2e] FAILED', e);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
};
