// Relation cells (autocomplete, mutual edits), query-link buttons inside embedded text, the find bar. Run: node e2e/run.mjs e2e/relations.cjs
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({ win }) => {
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
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true }); fs.writeFileSync(path.join(ws, rel), text); };
  const shot = async (n) => { await sleep(300); fs.writeFileSync(path.join(shots, `${n}.png`), (await win.webContents.capturePage()).toPNG()); };
  try {
    win.setSize(1360, 840);
    put('.cave-notes/workspace.yaml', 'queries:\n  tasks: kind:task\n  projects: kind:project\nrelations:\n  - name: Project\n    from: tasks\n    to: projects\n    attribute: project\n    multiple: false\n    backattribute: tasks\n    backname: Tasks\n');
    put('Alpha.md', '---\nkind: project\n---\n# Alpha\n');
    put('Beta.md', '---\nkind: project\n---\n# Beta\n');
    put('One.md', '---\nkind: task\n---\n# One\n');
    put('Two.md', '---\nkind: task\nproject: [[Beta]]\n---\n# Two\n');
    put('Doctrine.md', '# Doctrine\n');
    put('Doctrine/Scripture.md', '# Scripture\n\nWritings: [[?doctrine:$this|={title}]]\n');
    put('Doctrine/Grace.md', '# Grace\n');
    put('Writing One.md', '---\ndoctrine: [[Scripture]]\n---\n# Writing One\n');
    put('Systematic.md', '# Systematic\n\nProjects: [[?kind:project|={title}]]\n');
    put('Home.md', '# Home\n\n![[Systematic]]\n\n```view\ntype: table\nquery: kind:task\ncolumns: [title, Project]\n```\n');
    await waitFor('window.__cave && window.__cave.workspace.value && window.__cave.tree.rows.length > 0', 'workspace');
    await waitFor("window.__cave.indexStatus.value.state === 'ready'", 'indexing');
    await sleep(1000);
    await js(`window.__cave.openPage('Home.md', { reveal: true })`);
    await waitFor(`document.querySelectorAll('.vb-table tbody tr').length === 2`, 'two task rows');
    await sleep(500);
    await shot('30-relations-home');
    // click the empty Project cell of One and pick Alpha
    await js(`(() => { const r = [...document.querySelectorAll('.vb-table tbody tr')].find((x) => /One/.test(x.textContent)); r.querySelector('.vb-relation-cell').click(); })()`);
    await waitFor(`document.querySelector('.vb-relation-input')`, 'the relation field opens');
    await waitFor(`document.querySelectorAll('.vb-suggest-item').length === 2`, 'both projects offered');
    await shot('31-relation-autocomplete');
    await js(`(() => { const i = document.querySelector('.vb-relation-input'); i.value = 'alp'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await waitFor(`document.querySelectorAll('.vb-suggest-item').length === 1`, 'the list narrows to Alpha');
    await js(`document.querySelector('.vb-suggest-item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
    for (let i = 0; i < 60 && !/project:/.test(read('One.md')); i++) await sleep(100);
    check(/\[\[Alpha\]\]/.test(read('One.md')), 'picking Alpha writes the link into the task');
    for (let i = 0; i < 60 && !/One/.test(read('Alpha.md')); i++) await sleep(100);
    check(/\[\[One\]\]/.test(read('Alpha.md')), 'and the task into the project (the back attribute)');
    // a single-valued attribute: choose Beta for Two (already Beta) -> choose Alpha instead
    check(/\[\[Two\]\]/.test(read('Beta.md')) === false, 'Beta does not name Two yet (it was written by hand, one side only)');
    // query links: the page and the embedded copy both show the button
    await js(`window.__cave.openPage('Doctrine/Scripture.md', { reveal: true })`);
    await waitFor(`document.querySelector('.cm-querylinks .cm-wikilink-button')`, 'the query link draws a button');
    check((await js(`document.querySelector('.cm-querylinks .cm-wikilink-button').textContent`)) === 'Writing One', 'the button says the page title');
    await js(`window.__cave.openPage('Home.md', { reveal: true })`);
    await waitFor(`document.querySelector('.cm-embed .cm-querylinks .cm-wikilink-button')`, 'a query link inside dynamic text draws a button too');
    await shot('32-embed-querylinks');
    // a page edited elsewhere shows up without reopening
    put('Gamma.md', '---\nkind: project\n---\n# Gamma\n');
    await waitFor(`document.querySelectorAll('.cm-embed .cm-querylinks .cm-wikilink-button').length === 3`, 'the new page appears in the open page');
    // find bar, dark mode
    await js(`window.__cave.settings.value.theme !== 'dark' && window.__cave.toggleTheme()`);
    await sleep(500);
    await js(`document.querySelector('.cm-content').focus()`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'f', modifiers: ['control'] });
    await waitFor(`document.querySelector('.cm-findbar')`, 'the find bar opens');
    await js(`(() => { const i = document.querySelector('.cm-findbar input[name=search]'); i.value = 'Home'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(300);
    check(/of|result/.test(await js(`document.querySelector('.cm-find-count').textContent`)), 'the find bar counts matches');
    await shot('33-findbar-dark');
    console.log('[e2e] ALL CHECKS PASSED');
  } catch (e) {
    console.log('[e2e] FAILED', e && e.message);
    try { await shot('99-failure'); } catch {}
    process.exitCode = 1;
  }
};
