// Exercises tabs, preferences, dropping between rows, hidden pages, lists, new pages and clicks after a table.
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ win, app }) => {
  const shots = process.env.CAVE_SHOTS;
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
    console.log(`[e2e] ${cond ? 'ok  ' : 'FAIL'} ${what}`);
    if (!cond) process.exitCode = 1;
  };
  const write = (root, rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  try {
    win.setSize(1360, 840);
    const first = process.env.CAVE_OPEN;
    const second = '/tmp/cave-second';
    fs.rmSync(second, { recursive: true, force: true });
    write(second, 'Garden.md', '# Garden\n\nPlants.');
    write(second, 'Garden/Roses.md', '# Roses');
    write(second, 'Kitchen.md', '# Kitchen');

    await waitFor('window.__cave && window.__cave.workspace.value && window.__cave.tree.rows.length > 0', 'workspace');
    await waitFor("window.__cave.indexStatus.value.state === 'ready'", 'indexing');

    // ---- pages for the checks, in the first workspace
    write(first, 'Lists.md', '# Lists\n\n- first item with a long line that wraps around the edge of the editor so that we can see where the second line starts, which should be under the text\n  - nested one with a rather long sentence that also wraps around so the second line lines up with its own text start\n    - nested two\n- back at the top\n\n1. one\n2. two\n   - mixed\n\n- [ ] a task\n- [x] done task\n');
    write(first, 'Table.md', '# Table\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nLine A\n\nLine B\n\nLine C\n\nLine D\n');
    write(first, 'Hidden Parent.md', '# Hidden Parent');
    write(first, 'Hidden Parent/Shown.md', '# Shown');
    write(first, 'Hidden Parent/Secret.md', '---\nhidden: true\n---\n# Secret');
    write(first, 'Order/Alpha.md', '# Alpha');
    write(first, 'Order.md', '# Order');
    write(first, 'Order/Beta.md', '# Beta');
    write(first, 'Order/Gamma.md', '# Gamma');
    await sleep(1500);

    // ---- tabs: two workspaces, accent colours and icons
    await js(`window.__cave.openWorkspace(${JSON.stringify(second)})`);
    await waitFor('window.__cave.tabs.value.length === 2', 'second tab');
    await js(`window.__cave.setWorkspaceLook(${JSON.stringify(second)}, { color: '#e62d42', icon: 'book' })`);
    await js(`window.__cave.setWorkspaceLook(${JSON.stringify(first)}, { color: '#3584e4', icon: 'cave' })`);
    await js(`window.__cave.openPage('Garden/Roses.md', { reveal: true })`);
    await sleep(500);
    await js(`window.__cave.openInNewTab('Kitchen.md')`);
    await sleep(600);
    check((await js('window.__cave.tabs.value.length')) === 3, 'three tabs');
    check(fs.existsSync(path.join(second, '.cave-notes', 'workspace.yaml')), 'look saved in .cave-notes');
    await shot('10-tabs');
    check((await js(`window.__cave.tree.rows.map(r => r.path).join()`)).includes('Garden/Roses.md'), 'tree of the second workspace shows Roses (page revealed)');
    await js(`window.__cave.activateTab(window.__cave.tabs.value[0].id)`);
    await sleep(700);
    check((await js('window.__cave.workspace.value.root')) === first, 'first workspace back when its tab is activated');
    check((await js(`window.__cave.tree.rows.some(r => r.path === 'Welcome.md')`)), 'its own tree');

    // ---- preferences
    await js('window.__cave.openPreferences()');
    await sleep(300);
    await shot('11-preferences');
    await js('window.__cave.closeDialog(); window.__cave.setPreferences({ fontStyle: 'serif' })');
    await js(`window.__cave.openPage('Lists.md', { reveal: true })`);
    await sleep(900);
    await shot('12-lists-serif');
    await js('window.__cave.setPreferences({ fontStyle: 'sans' })');
    await sleep(300);
    await shot('13-lists-sans');
    await js('window.__cave.openWorkspacePreferences()');
    await sleep(300);
    await shot('14-look');
    await js('window.__cave.closeDialog()');

    // ---- clicking lines after a table lands on that line
    await js(`window.__cave.openPage('Table.md', { reveal: true })`);
    await sleep(900);
    let bad = 0;
    for (const label of ['Line A', 'Line B', 'Line C', 'Line D']) {
      const pt = await js(`(() => { const v = window.__cave.editor.view; const at = v.state.doc.toString().indexOf(${JSON.stringify(label)}); v.dispatch({ selection: { anchor: 0 } }); v.dispatch({ effects: window.__cave.editor.view.constructor.scrollIntoView ? [] : [] }); const c = v.coordsAtPos(at + 2); return c ? { x: Math.round(c.left), y: Math.round((c.top + c.bottom) / 2), at } : null; })()`);
      if (!pt) { bad++; continue; }
      win.webContents.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
      await sleep(200);
      const got = await js(`(() => { const v = window.__cave.editor.view; return v.state.doc.lineAt(v.state.selection.main.head).text; })()`);
      if (got !== label) { bad++; console.log(`[e2e]   clicked ${label}, cursor is on "${got}"`); }
    }
    check(bad === 0, 'clicks after a table land on the clicked line');

    // ---- hidden page, and the tree shows its parent
    await js(`window.__cave.openPage('Hidden Parent/Secret.md', { reveal: true })`);
    await sleep(900);
    check((await js('window.__cave.tree.selected')) === 'Hidden Parent.md', 'open hidden page: its parent is selected in the tree');
    check(!(await js(`window.__cave.tree.rows.some(r => r.path === 'Hidden Parent/Secret.md')`)), 'hidden page is not a tree row');
    check((await js(`window.__cave.children.value.length`)) === 0, 'secret has no sub-pages');
    await js(`window.__cave.openPage('Hidden Parent.md', { reveal: true })`);
    await sleep(700);
    check((await js(`window.__cave.children.value.map(c => c.name).join()`)) === 'Secret,Shown', 'sub-page bar lists the hidden page too');

    // ---- drag to reorder: between rows
    await js(`window.__cave.openPage('Order.md', { reveal: true })`);
    await js(`window.__cave.tree.expand('Order.md')`);
    await sleep(600);
    const names = () => js(`window.__cave.tree.siblings('Order.md').map(n => n.name).join()`);
    check((await names()) === 'Alpha,Beta,Gamma', 'order starts alphabetical');
    await js(`window.__cave.dropPage('Order/Gamma.md', { parent: 'Order.md', before: 'Order/Alpha.md' }, 'before')`);
    await sleep(900);
    check((await names()) === 'Gamma,Alpha,Beta', 'dropped Gamma before Alpha');
    // a real drag with the mouse: Beta onto the gap above Gamma
    const rowY = async (p) => js(`(() => { const i = window.__cave.tree.indexOf(${JSON.stringify(p)}); const t = document.querySelector('.tree'); const r = t.getBoundingClientRect(); return { x: Math.round(r.left + 90), y: Math.round(r.top + i * 34 + 17 - t.scrollTop) }; })()`);
    const from = await rowY('Order/Beta.md');
    const to = await rowY('Order/Gamma.md');
    win.webContents.sendInputEvent({ type: 'mouseMove', x: from.x, y: from.y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 });
    for (let k = 1; k <= 8; k++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: from.x, y: Math.round(from.y + ((to.y - 12 - from.y) * k) / 8) });
      await sleep(40);
    }
    await shot('15-dragging');
    win.webContents.sendInputEvent({ type: 'mouseUp', x: from.x, y: to.y - 12, button: 'left', clickCount: 1 });
    await sleep(1000);
    console.log('[e2e] order after real drag:', await names());

    // ---- auto-collapse
    await js(`window.__cave.setPreferences({ autoCollapseSeconds: 2 })`);
    await js(`window.__cave.openPage('Theology/Soteriology.md', { reveal: true })`);
    await sleep(500);
    await js(`window.__cave.tree.expand('Order.md')`);
    await sleep(500);
    check(await js(`window.__cave.tree.expanded.has('Order.md')`), 'Order is expanded');
    await sleep(4500);
    check(!(await js(`window.__cave.tree.expanded.has('Order.md')`)), 'Order collapsed after the delay');
    check(await js(`window.__cave.tree.expanded.has('Theology.md')`), 'the branch with the open page stays');

    // ---- new page: cursor under the title
    await js(`window.__cave.newPageIn(null)`);
    await sleep(300);
    await js(`window.__cave.dialog.value.submit('Fresh Page')`);
    await sleep(1200);
    const where = await js(`(() => { const v = window.__cave.editor.view; const l = v.state.doc.lineAt(v.state.selection.main.head); return l.number + ':' + JSON.stringify(l.text) + ':' + v.hasFocus; })()`);
    check(where === '3:"":true', `new page: cursor on the empty line under the title (${where})`);

    // ---- typing a fence
    for (let k = 0; k < 3; k++) {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '`' });
      win.webContents.sendInputEvent({ type: 'char', keyCode: '`' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: '`' });
      await sleep(60);
    }
    await sleep(300);
    check((await js('window.__cave.editor.text()')).endsWith('```\n```'), 'typing ``` adds the closing fence');
    await shot('16-new-page');

    // ---- add attributes
    await js(`window.__cave.openPage('Welcome.md', { reveal: true })`);
    await sleep(800);
    await shot('17-attributes-hover');
    await js(`document.querySelector('.cm-attr-info').click()`);
    await sleep(300);
    await shot('18-attributes-help');
    await js(`document.querySelector('.cm-attr-info').click(); document.querySelector('.cm-attr-add').click()`);
    await sleep(300);
    check((await js('window.__cave.editor.text()')).startsWith('---\n\n---\n'), 'add attributes inserts an empty block');
  } catch (e) {
    console.error('[e2e] FAILED', e);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
};
