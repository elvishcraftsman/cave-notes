// Drives real user flows in the running app (real key presses, typing, mouse) and asserts on the outcome.
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ win, app }) => {
  const root = process.env.CAVE_OPEN;
  const shots = process.env.CAVE_SHOTS;
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const file = (rel) => path.join(root, ...rel.split('/'));
  const read = (rel) => fs.readFileSync(file(rel), 'utf8');
  let pass = 0;
  const failures = [];
  const check = (name, ok, detail = '') => {
    if (ok) {
      pass++;
      console.log(`[e2e] ok    ${name}`);
    } else {
      failures.push(name);
      console.log(`[e2e] FAIL  ${name} ${detail}`);
    }
  };
  const waitFor = async (expr, what, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        if (await js(`Boolean(${expr})`)) return true;
      } catch {}
      await sleep(80);
    }
    console.log(`[e2e] (timeout waiting for ${what})`);
    return false;
  };
  const shot = async (name) => {
    await sleep(300);
    fs.writeFileSync(path.join(shots, `${name}.png`), (await wc.capturePage()).toPNG());
  };
  const key = async (keyCode, modifiers = []) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await sleep(60);
  };
  // Enter/Space on a focused <button> is activated by the keypress (char) event, which
  // sendInputEvent only produces if we send it ourselves.
  const activate = async (keyCode = 'Enter') => {
    const ch = keyCode === 'Enter' ? '\r' : ' ';
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'char', keyCode: ch });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
    await sleep(60);
  };
  const state = (expr) => js(expr);
  // choose an option of a <select> the way a user would (set the value, fire change)
  const pick = (selector, value) => js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);

  const waitDisk = async (rel, needle, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (read(rel).includes(needle)) return true; } catch {}
      await sleep(80);
    }
    console.log(`[e2e] (timeout waiting for ${needle} in ${rel})`);
    return false;
  };

  try {
    win.setSize(1360, 840);
    await waitFor('window.__cave && window.__cave.workspace.value && window.__cave.tree.rows.length > 0', 'workspace');
    await waitFor("window.__cave.indexStatus.value.state === 'ready'", 'indexing');
    const ctl = 'window.__cave';

    // ---- 1. Keyboard navigation in the tree: up/down read pages, left/right walk the hierarchy
    await js(`document.querySelector('.tree').focus()`);
    await js(`${ctl}.tree.select(null)`);
    await key('Down');
    await waitFor(`${ctl}.current.value && ${ctl}.current.value.path === 'Theology.md'`, 'first row opens');
    check('Down selects and opens the first page', (await state(`${ctl}.current.value.path`)) === 'Theology.md');
    // Theology starts collapsed: the first Right expands it, the second moves into its first child.
    await key('Right');
    check('Right on a collapsed page expands it', (await state(`${ctl}.tree.expanded.has('Theology.md')`)) === true);
    await key('Right');
    const afterRight = await state(`${ctl}.tree.selected`);
    check('Right on an expanded page enters its first child', afterRight === 'Theology/Grace.md', afterRight);
    await key('Down');
    await key('Right'); // Soteriology: expand
    await key('Right'); // enter Imputation
    await waitFor(`${ctl}.current.value && ${ctl}.current.value.path === 'Theology/Soteriology/Imputation.md'`, 'imputation opens');
    check('Right twice walks down to a grandchild', (await state(`${ctl}.current.value.path`)) === 'Theology/Soteriology/Imputation.md');
    await key('Left');
    check('Left from a child goes to its parent', (await state(`${ctl}.tree.selected`)) === 'Theology/Soteriology.md');
    await key('Left'); // collapse
    check('Left on an expanded page collapses it', (await state(`${ctl}.tree.expanded.has('Theology/Soteriology.md')`)) === false);
    await key('Up');
    check('Up moves to the previous page', (await state(`${ctl}.tree.selected`)) === 'Theology/Grace.md');

    // ---- 2. Typing is saved automatically
    await js(`${ctl}.openPage('Welcome.md', { reveal: true, focus: true })`);
    await waitFor(`${ctl}.current.value.path === 'Welcome.md' && ${ctl}.editor.text().includes('Welcome to Cave Notes')`, 'welcome loaded');
    await js(`(() => { const v = ${ctl}.editor.view; v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
    await wc.insertText('\n\nTyped by the e2e test.');
    await waitDisk('Welcome.md', 'Typed by the e2e test.');
    await waitFor(`${ctl}.saveState.value === 'saved'`, 'autosave', 4000);
    check('typed text is autosaved to disk', read('Welcome.md').includes('Typed by the e2e test.'));
    check('save state returns to saved', (await state(`${ctl}.saveState.value`)) === 'saved');

    // ---- 3. [[ autocompletes page names
    await wc.insertText('\n\nSee [[Gra');
    const popup = await waitFor(`document.querySelector('.cm-tooltip-autocomplete')`, 'completion popup', 4000);
    check('typing [[Gra opens the completion popup', popup);
    check('the popup suggests Grace', (await state(`document.querySelector('.cm-tooltip-autocomplete').textContent`)).includes('Grace'));
    await shot('10-autocomplete');
    await key('Enter');
    await sleep(200);
    check('Enter inserts the page name and closes the link', (await state(`${ctl}.editor.text()`)).includes('See [[Grace]]'));
    await waitFor(`${ctl}.saveState.value === 'saved'`, 'autosave 2', 4000);

    // ---- 4. Ctrl+click follows a link
    await js(`(() => { const v = ${ctl}.editor.view; v.dispatch({ selection: { anchor: 0 } }); document.querySelector('.tree').focus(); })()`);
    await sleep(200);
    const rect = await js(`(() => { const r = [...document.querySelectorAll('.cm-wikilink')].find((e) => e.textContent === 'Theology').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    wc.sendInputEvent({ type: 'mouseMove', x: rect.x, y: rect.y });
    wc.sendInputEvent({ type: 'mouseDown', x: rect.x, y: rect.y, button: 'left', clickCount: 1, modifiers: ['control'] });
    wc.sendInputEvent({ type: 'mouseUp', x: rect.x, y: rect.y, button: 'left', clickCount: 1, modifiers: ['control'] });
    await waitFor(`${ctl}.current.value.path === 'Theology.md'`, 'ctrl+click navigation', 4000);
    check('Ctrl+click on a [[wikilink]] opens that page', (await state(`${ctl}.current.value.path`)) === 'Theology.md');

    // ---- 5. Renaming rewrites links, with a preview, and can be undone
    await js(`${ctl}.openPage('Notes/Reading List.md', { reveal: true })`);
    await waitFor(`${ctl}.current.value.path === 'Notes/Reading List.md'`, 'reading list');
    await js(`document.querySelector('.tree').focus()`);
    await key('F2');
    await waitFor(`${ctl}.dialog.value && ${ctl}.dialog.value.kind === 'prompt'`, 'rename prompt');
    check('F2 on a page opens the rename dialog', (await state(`${ctl}.dialog.value.title`)) === 'Rename Page');
    await js(`(() => { const i = document.querySelector('.dialog input'); i.value = 'Reading Queue'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await shot('11-rename-prompt');
    await key('Enter');
    const sawPlan = await waitFor(`${ctl}.dialog.value && ${ctl}.dialog.value.kind === 'plan'`, 'plan preview');
    check('renaming a linked page shows a preview of the link changes', sawPlan);
    check('the preview lists the link in Welcome', (await state(`document.querySelector('.plan-list').textContent`)).includes('Reading%20Queue.md'));
    await shot('12-rename-plan');
    await activate('Enter'); // the confirm button has focus
    await waitFor(`${ctl}.dialog.value === null`, 'dialog closes');
    await waitFor(`${ctl}.current.value && ${ctl}.current.value.path === 'Notes/Reading Queue.md'`, 'follows the rename');
    check('the page file is renamed on disk', fs.existsSync(file('Notes/Reading Queue.md')) && !fs.existsSync(file('Notes/Reading List.md')));
    check('links in other pages are rewritten', read('Welcome.md').includes('[the reading list](Notes/Reading%20Queue.md)'));
    check('the open page follows the rename', (await state(`${ctl}.current.value.path`)) === 'Notes/Reading Queue.md');
    check('a toast offers Undo', (await state(`${ctl}.toasts.value.some((t) => t.action && t.action.label === 'Undo')`)) === true);
    await shot('13-rename-done');
    await js(`${ctl}.undoMove()`);
    await waitFor(`${ctl}.current.value && ${ctl}.current.value.path === 'Notes/Reading List.md'`, 'undo');
    check('Undo restores the file and the links', fs.existsSync(file('Notes/Reading List.md')) && read('Welcome.md').includes('Notes/Reading%20List.md'));

    // ---- 6. Dragging a page onto another moves it
    await js(`${ctl}.movePage('Notes/Ideas.md', 'Theology.md')`);
    await waitFor(`!${ctl}.dialog.value ? true : ${ctl}.dialog.value.kind !== 'plan' || (${ctl}.dialog.value.resolve(true), ${ctl}.dialog.value = null, true)`, 'move plan');
    await sleep(900);
    check('moving a page puts it inside its new parent', fs.existsSync(file('Theology/Ideas.md')) && !fs.existsSync(file('Notes/Ideas.md')));

    // ---- 7. New page
    await js(`${ctl}.newPageIn('Theology.md')`);
    await waitFor(`document.querySelector('.dialog input')`, 'new page dialog');
    await shot('14-new-page');
    await js(`(() => { const i = document.querySelector('.dialog input'); i.value = 'Predestination'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await key('Enter');
    await waitFor(`${ctl}.current.value && ${ctl}.current.value.path === 'Theology/Predestination.md'`, 'new page opens');
    check('creating a page makes the file with a title', read('Theology/Predestination.md').startsWith('# Predestination'));
    check('the new page is shown in the tree', (await state(`${ctl}.tree.rows.some((r) => r.path === 'Theology/Predestination.md')`)) === true);
    // a name that already exists is refused with a message, not an exception
    await js(`${ctl}.newPageIn('Theology.md')`);
    await waitFor(`document.querySelector('.dialog input')`, 'dialog 2');
    await js(`(() => { const i = document.querySelector('.dialog input'); i.value = 'predestination'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await key('Enter');
    await waitFor(`document.querySelector('.field-error')`, 'error message');
    check('a duplicate name shows an error in the dialog', (await state(`document.querySelector('.field-error').textContent`)).includes('already exists'));
    await key('Escape');
    await waitFor(`${ctl}.dialog.value === null`, 'dialog closes');

    // ---- 8. Changes made outside the app
    await js(`${ctl}.openPage('Welcome.md', { reveal: true })`);
    await waitFor(`${ctl}.current.value.path === 'Welcome.md' && ${ctl}.saveState.value === 'saved'`, 'welcome again');
    fs.writeFileSync(file('Welcome.md'), read('Welcome.md') + '\nEdited in another program.\n');
    await waitFor(`${ctl}.editor.text().includes('Edited in another program.')`, 'external reload', 6000);
    check('an outside edit to a clean page is reloaded', (await state(`${ctl}.editor.text()`)).includes('Edited in another program.'));
    fs.writeFileSync(file('Theology/NewFromOutside.md'), '# From outside\n');
    await waitFor(`${ctl}.tree.rows.some((r) => r.path === 'Theology/NewFromOutside.md')`, 'new file shows in tree', 6000);
    check('a page created outside appears in the tree', (await state(`${ctl}.tree.rows.some((r) => r.path === 'Theology/NewFromOutside.md')`)) === true);

    // ---- 9. Conflicts are surfaced, never silently overwritten
    await js(`(() => { const v = ${ctl}.editor.view; v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
    await wc.insertText('\nMY UNSAVED WORDS');
    fs.writeFileSync(file('Welcome.md'), '# Welcome\n\nTHEIR VERSION\n');
    const conflict = await waitFor(`${ctl}.saveState.value === 'conflict'`, 'conflict', 6000);
    check('editing while the file changes on disk raises a conflict', conflict);
    check('the other version is not overwritten', read('Welcome.md').includes('THEIR VERSION'));
    await shot('15-conflict');
    await js(`${ctl}.resolveConflict('overwrite')`);
    await waitFor(`${ctl}.saveState.value === 'saved'`, 'keep mine saves');
    check('"Keep Mine" saves the editor text', read('Welcome.md').includes('MY UNSAVED WORDS'));

    // ---- 10. Dialogs: delete confirmation (cancelled), context menu, links panel
    await js(`${ctl}.openPage('Theology/Grace.md', { reveal: true })`);
    await waitFor(`${ctl}.current.value.path === 'Theology/Grace.md'`, 'grace');
    const del = js(`${ctl}.deletePage('Theology/Soteriology.md')`);
    await waitFor(`${ctl}.dialog.value && ${ctl}.dialog.value.kind === 'confirm'`, 'delete confirm');
    check('deleting warns about sub-pages and broken links', /sub-page/.test(await state(`${ctl}.dialog.value.details.join(' ')`)));
    await shot('16-delete-confirm');
    await js(`${ctl}.closeDialog()`);
    await del;
    check('cancelling a delete keeps the page', fs.existsSync(file('Theology/Soteriology.md')));
    await js(`${ctl}.setRightTab('links')`);
    wc.sendInputEvent({ type: 'mouseDown', x: 120, y: 118, button: 'right', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: 120, y: 118, button: 'right', clickCount: 1 });
    await waitFor(`document.querySelector('.context-anchor .popover')`, 'context menu', 3000);
    await shot('17-context-menu');
    await key('Escape');

    // ---- 10b. Tables and frontmatter render as widgets, and become raw text when entered
    await js(`${ctl}.openPage('Theology/Soteriology.md', { reveal: true })`);
    await waitFor(`${ctl}.current.value.path === 'Theology/Soteriology.md' && document.querySelector('.cm-table')`, 'table widget');
    check('a table renders as a real table', (await state(`document.querySelectorAll('.cm-table tbody tr').length`)) === 2);
    check('frontmatter shows as a compact properties card', (await state(`document.querySelector('.cm-properties') && document.querySelector('.cm-properties').textContent.includes('draft')`)) === true);
    await shot('18-table-and-properties');
    const trect = await js(`(() => { const r = document.querySelector('.cm-table').getBoundingClientRect(); return { x: Math.round(r.x + 20), y: Math.round(r.y + 10) }; })()`);
    wc.sendInputEvent({ type: 'mouseDown', x: trect.x, y: trect.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: trect.x, y: trect.y, button: 'left', clickCount: 1 });
    await sleep(250);
    check('clicking the table reveals its Markdown for editing', (await state(`!document.querySelector('.cm-table') && ${ctl}.editor.text().includes('| Justification |')`)) === true);
    await js(`(() => { const v = ${ctl}.editor.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
    await sleep(200);
    check('moving away shows the table again', (await state(`Boolean(document.querySelector('.cm-table'))`)) === true);

    // ---- 10c. Search: Ctrl+Shift+F, results with highlighted snippets, filter chips, keyboard use
    await js(`${ctl}.openPage('Welcome.md', { reveal: true })`);
    await waitFor(`${ctl}.current.value.path === 'Welcome.md'`, 'welcome for search');
    await js(`document.querySelector('.tree').focus()`);
    await key('F', ['control', 'shift']);
    await waitFor(`${ctl}.searchOpen.value && document.querySelector('.search-input') === document.activeElement`, 'search opens focused', 3000);
    check('Ctrl+Shift+F opens search with the box focused', (await state(`${ctl}.searchOpen.value && document.activeElement === document.querySelector('.search-input')`)) === true);
    const t0 = Date.now();
    await wc.insertText('grace');
    await waitFor(`${ctl}.searchState.value.searched && ${ctl}.searchState.value.results.length > 0 && !${ctl}.searchState.value.loading`, 'results for grace', 3000);
    const took = Date.now() - t0;
    check('typing finds pages (and answers quickly)', (await state(`${ctl}.searchState.value.results.some((r) => r.path === 'Theology/Grace.md')`)) === true && took < 1500, `${took}ms`);
    check('matches are highlighted in snippets', (await state(`document.querySelectorAll('.result-snippet mark').length > 0`)) === true);
    await shot('19-search-results');
    const first = await state(`${ctl}.searchSel.value`);
    await key('Down');
    check('Down moves the selection', (await state(`${ctl}.searchSel.value`)) === first + 1);
    await waitFor(`${ctl}.current.value.path === ${ctl}.searchState.value.results[${ctl}.searchSel.value].path`, 'selection previews the page', 3000);
    check('the selected result opens as a preview', (await state(`${ctl}.current.value.path === ${ctl}.searchState.value.results[${ctl}.searchSel.value].path`)) === true);

    await js(`${ctl}.setSearchQuery('status:draft', true)`);
    await waitFor(`${ctl}.searchState.value.searched && ${ctl}.searchState.value.query === 'status:draft' && !${ctl}.searchState.value.loading`, 'status filter', 3000);
    check('an attribute filter finds pages by frontmatter', (await state(`${ctl}.searchState.value.results.some((r) => r.path === 'Theology/Soteriology.md')`)) === true);
    check('the filter is shown as a chip', (await state(`document.querySelector('.chip .chip-label') && document.querySelector('.chip .chip-label').textContent`)) === 'status: draft');
    await shot('20-search-filter');
    await js(`document.querySelector('.chip-x').click()`);
    await sleep(150);
    check('removing the chip clears the filter', (await state(`${ctl}.searchQuery.value`)) === '');

    // Filters panel: typed controls built from the schema (enum values become choices)
    await js(`${ctl}.setSearchQuery('', true)`);
    await js(`[...document.querySelectorAll('.search-tools .pill-button')].find((b) => b.textContent === 'Filters').click()`);
    await waitFor(`document.querySelector('.filter-builder .fb-add')`, 'filter builder', 3000);
    await pick(`.filter-builder .fb-add`, 'status');
    await waitFor(`document.querySelector('.filter-builder .fb-multi .facet-chip')`, 'status choices', 3000);
    check('the filter builder offers the schema\'s status values as choices', (await state(`[...document.querySelectorAll('.filter-builder .fb-multi .facet-chip')].map((b) => b.textContent).join()`)) === 'idea,todo,doing,review,done');
    await shot('21-search-filter-builder');
    await js(`[...document.querySelectorAll('.filter-builder .fb-multi .facet-chip')].find((b) => b.textContent === 'review').click()`);
    await waitFor(`${ctl}.searchQuery.value.includes('status:review') && ${ctl}.searchState.value.searched && !${ctl}.searchState.value.loading`, 'builder filter applied', 3000);
    check('choosing a value applies that filter', (await state(`${ctl}.searchState.value.results.map((r) => r.path).join()`)) === 'Theology/Grace.md');
    await pick(`.filter-builder .fb-op`, 'is-not');
    await waitFor(`${ctl}.searchQuery.value.includes('-status:review') && !${ctl}.searchState.value.loading`, 'negated filter', 3000);
    check('changing the condition rewrites the query', (await state(`${ctl}.searchQuery.value.trim()`)) === '-status:review');
    await js(`${ctl}.setSearchQuery('', true)`);
    await js(`[...document.querySelectorAll('.search-tools .pill-button')].find((b) => b.textContent === 'Filters').click()`);

    await js(`${ctl}.setSearchQuery('imputation', true)`);
    await waitFor(`${ctl}.searchState.value.results.length > 0 && !${ctl}.searchState.value.loading`, 'imputation results', 3000);
    await js(`document.querySelector('.search-input').focus()`);
    await key('Enter');
    await waitFor(`${ctl}.current.value.path.endsWith('Imputation.md')`, 'enter opens result', 3000);
    check('Enter opens the result and focuses the editor', (await state(`${ctl}.current.value.path.endsWith('Imputation.md') && Boolean(document.activeElement.closest('.cm-content'))`)) === true);

    await js(`document.querySelector('.search-input').focus()`);
    await key('Escape'); // clears the query
    await key('Escape'); // closes the panel
    await waitFor(`!${ctl}.searchOpen.value && document.querySelector('.tree')`, 'search closes', 3000);
    check('Escape twice clears then closes search and brings the tree back', (await state(`!${ctl}.searchOpen.value && Boolean(document.querySelector('.tree'))`)) === true);

    // ---- 10d. Sub-page bar under the editor
    await js(`${ctl}.openPage('Projects.md', { reveal: true })`);
    await waitFor(`${ctl}.current.value.path === 'Projects.md' && document.querySelector('.children-bar')`, 'children bar', 5000);
    const names = await state(`[...document.querySelectorAll('.children-list .child-name')].map((e) => e.textContent).sort().join()`);
    check('the bar lists the page\'s sub-pages', names === 'Fix bugs,Ideas Box,Release,Write docs', names);
    await js(`${ctl}.editor.view.scrollDOM.scrollTop = 0`);
    await sleep(350);
    check('it is a slim strip while there is more page below', (await state(`document.querySelector('.children-bar').dataset.expanded`)) === 'false');
    check('and the strip is short', (await state(`document.querySelector('.children-bar').getBoundingClientRect().height < 60`)) === true);
    await js(`(() => { const s = ${ctl}.editor.view.scrollDOM; s.scrollTop = s.scrollHeight; })()`);
    await waitFor(`document.querySelector('.children-bar').dataset.expanded === 'true'`, 'bar expands at the end', 4000);
    await sleep(350);
    check('it expands once the page cannot scroll further', (await state(`document.querySelector('.children-bar').getBoundingClientRect().height > 150`)) === true);
    await shot('22-children-bar-expanded');
    await js(`${ctl}.editor.view.scrollDOM.scrollTop = 0`);
    await waitFor(`document.querySelector('.children-bar').dataset.expanded === 'false'`, 'bar collapses again', 4000);
    await js(`document.querySelector('.children-head .icon-button').click()`);
    await waitFor(`document.querySelector('.children-bar').dataset.expanded === 'true'`, 'pinned open', 3000);
    check('pinning keeps it expanded away from the end', (await state(`${ctl}.settings.value.childrenDocked === true && ${ctl}.editor.view.scrollDOM.scrollTop === 0`)) === true);
    await js(`document.querySelector('.children-head .icon-button').click()`);
    await waitFor(`document.querySelector('.children-bar').dataset.expanded === 'false'`, 'unpinned', 3000);
    await js(`document.querySelector('.children-list .child').click()`);
    await waitFor(`${ctl}.current.value.path.startsWith('Projects/')`, 'child opens', 3000);
    check('clicking a sub-page opens it', (await state(`${ctl}.current.value.path.startsWith('Projects/')`)) === true);

    // ---- 10e. Database views
    await js(`${ctl}.openPage('Projects.md', { reveal: true })`);
    await waitFor(`document.querySelectorAll('.view-block').length === 3 && document.querySelector('.view-block.t-table tbody tr')`, 'three view blocks', 6000);
    // The editor only draws widgets near the viewport, so a block far down may not be in the DOM: the ones drawn must be right, in order.
    check('view blocks render for the ```view fences', (await state(`(() => { const t = [...document.querySelectorAll('.view-block')].map((v) => v.dataset.viewType); return t.length >= 2 && 'table,kanban,calendar'.startsWith(t.join()); })()`)) === true);
    check('the table lists every page under this one', (await state(`document.querySelectorAll('.view-block.t-table tbody tr').length`)) === 4);
    check('the table is sorted by its due date', (await state(`[...document.querySelectorAll('.view-block.t-table tbody tr td:first-child')].map((e) => e.textContent).join()`)) === 'Write docs,Fix bugs,Release,Ideas Box');
    await js(`document.querySelector('.view-block.t-table').scrollIntoView()`);
    await shot('23-view-table');
    const cols = await state(`[...document.querySelectorAll('.view-block.t-kanban .vb-col')].map((c) => c.dataset.column + ':' + c.querySelectorAll('.vb-kcard').length).join()`);
    check('the board has a column per declared status, plus one for pages without', cols === 'idea:0,todo:1,doing:1,review:0,done:1,:1', cols);
    await js(`document.querySelector('.view-block.t-kanban').scrollIntoView()`);
    await shot('24-view-board');
    check('the calendar shows tasks on their due dates', (await state(`document.querySelector('.view-block.t-calendar [data-date="2026-10-12"] .vb-event') && document.querySelector('.view-block.t-calendar [data-date="2026-10-12"] .vb-event').textContent`)) === 'Write docs');
    await js(`document.querySelector('.view-block.t-calendar').scrollIntoView()`);
    await shot('25-view-calendar');

    // drag a card to another column: the page's frontmatter changes on disk and the board follows
    await js(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'Projects/Write docs.md'); document.querySelector('.view-block.t-kanban [data-column="review"]').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
    await waitDisk('Projects/Write docs.md', 'status: review');
    check('dropping a card writes the new value to the page', read('Projects/Write docs.md').includes('status: review') && read('Projects/Write docs.md').includes('tags: [writing, docs]'));
    await waitFor(`document.querySelector('.view-block.t-kanban [data-column="review"] .vb-kcard')`, 'card moved', 5000);
    check('the card is now in that column', (await state(`document.querySelector('.view-block.t-kanban [data-column="review"] .vb-kcard .vb-open').textContent`)) === 'Write docs');
    // and onto a day in the calendar
    await js(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'Projects/Fix bugs.md'); document.querySelector('.view-block.t-calendar [data-date="2026-10-16"]').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
    await waitDisk('Projects/Fix bugs.md', 'due: 2026-10-16');
    check('dropping on a day sets the date', read('Projects/Fix bugs.md').includes('due: 2026-10-16'));

    // blocks far off screen are unmounted by the editor and come back when scrolled to, so scroll to the table first
    await js(`${ctl}.editor.view.scrollDOM.scrollTop = 0`);
    await waitFor(`document.querySelector('.view-block.t-table tbody tr')`, 'table remounts with its rows at once', 3000);
    check('a view that scrolls back into sight shows its last results straight away', (await state(`document.querySelectorAll('.view-block.t-table tbody tr').length`)) === 4);
    // switch the table to a list and back: the change is written into the fence, as plain text
    await js(`(() => { const b = document.querySelector('.view-block.t-table'); if (!b.querySelector('[data-view-type-select]')) b.querySelector('[data-vb-expand]').click(); })()`);
    await waitFor(`document.querySelector('.view-block.t-table [data-view-type-select]')`, 'view controls open', 2000);
    await js(`(() => { const s = document.querySelector('.view-block.t-table [data-view-type-select]'); s.value = 'list'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(`${ctl}.editor.text().includes('type: list') && document.querySelector('.view-block.t-list li')`, 'switch to list', 4000);
    check('switching the view type edits the block\'s text', (await state(`${ctl}.editor.text().includes('type: list') && !${ctl}.editor.text().includes('type: table')`)) === true);
    await js(`(() => { const b = document.querySelector('.view-block.t-list'); if (!b.querySelector('[data-view-type-select]')) b.querySelector('[data-vb-expand]').click(); })()`);
    await waitFor(`document.querySelector('.view-block.t-list [data-view-type-select]')`, 'view controls open', 2000);
    await js(`(() => { const s = document.querySelector('.view-block.t-list [data-view-type-select]'); s.value = 'gallery'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(`document.querySelector('.view-block.t-gallery .vb-card')`, 'gallery', 4000);
    check('the gallery shows a card per page', (await state(`document.querySelectorAll('.view-block.t-gallery .vb-card').length`)) === 4);
    await js(`(() => { const b = document.querySelector('.view-block.t-gallery'); if (!b.querySelector('[data-view-type-select]')) b.querySelector('[data-vb-expand]').click(); })()`);
    await waitFor(`document.querySelector('.view-block.t-gallery [data-view-type-select]')`, 'view controls open', 2000);
    await js(`(() => { const s = document.querySelector('.view-block.t-gallery [data-view-type-select]'); s.value = 'table'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(`document.querySelector('.view-block.t-table tbody tr')`, 'table again', 4000);

    // filter controls inside a view
    await js(`(() => { const b = document.querySelector('.view-block.t-table'); if (!b.querySelector('[data-panel]')) b.querySelector('[data-vb-expand]').click(); })()`);
    await js(`document.querySelector('.view-block.t-table [data-panel="filter"]').click()`);
    await waitFor(`document.querySelector('.view-block.t-table .filter-builder .fb-add')`, 'view filter builder', 3000);
    await pick(`.view-block.t-table .filter-builder .fb-add`, 'tags');
    await waitFor(`document.querySelector('.view-block.t-table .filter-builder .fb-value')`, 'tags value box', 3000);
    // the existing under: row has a value box too; the new (draft) row's is the last one
    await js(`(() => { const els = document.querySelectorAll('.view-block.t-table .filter-builder .fb-value'); const el = els[els.length - 1]; el.value = 'docs'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(`${ctl}.editor.text().includes('under:$this tags:docs') && document.querySelectorAll('.view-block.t-table tbody tr').length === 2`, 'tag filter applied', 5000);
    check('a filter added with the controls is written into the query and applied', (await state(`document.querySelectorAll('.view-block.t-table tbody tr').length`)) === 2);
    check('the filter panel stays open while the block is updated', (await state(`Boolean(document.querySelector('.view-block.t-table .filter-builder'))`)) === true);
    await shot('26-view-filter-panel');
    await js(`document.querySelector('.view-block.t-table [data-panel="filter"]').click()`);

    // the block's raw settings can be edited as text
    await js(`document.querySelector('.view-block.t-table [aria-label="Edit view settings"]').click()`);
    await waitFor(`!document.querySelector('.view-block.t-table')`, 'raw text shown', 3000);
    check('editing as text reveals the fenced settings', (await state(`document.querySelector('.cm-content').textContent.includes('query: under:$this tags:docs')`)) === true);
    await js(`(() => { const v = ${ctl}.editor.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
    await waitFor(`document.querySelector('.view-block.t-table')`, 'view returns', 3000);

    // a mistake in the settings is explained, not hidden
    await js(`(() => { const v = ${ctl}.editor.view; v.dispatch({ changes: { from: v.state.doc.length, insert: '\\n\\n\`\`\`view\\ntype: chart\\n\`\`\`\\n\\nend\\n' } }); v.dispatch({ selection: { anchor: v.state.doc.length }, scrollIntoView: true }); })()`);
    await waitFor(`document.querySelector('[data-view-error]')`, 'error block', 4000);
    check('an unknown view type shows a plain explanation', (await state(`document.querySelector('[data-view-error]').textContent.includes('Unknown view type "chart"')`)) === true);
    await js(`${ctl}.openPage('Welcome.md', { reveal: true, force: true })`);
    await waitFor(`${ctl}.current.value.path === 'Welcome.md'`, 'leave projects', 3000);
    // insert a fresh block with the shortcut
    await js(`window.__welcomeBefore = ${ctl}.editor.text()`);
    await js(`${ctl}.editor.view.focus(); (() => { const v = ${ctl}.editor.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
    await key('V', ['control', 'alt']);
    await waitFor(`${ctl}.editor.text().includes('\`\`\`view\\ntype: table\\nquery: under:$this')`, 'insert view', 3000);
    await waitFor(`document.querySelector('.view-block.t-table')`, 'inserted view renders', 4000);
    check('Ctrl+Alt+V inserts a database view block that renders', true);
    await js(`(() => { const v = ${ctl}.editor.view; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: window.__welcomeBefore } }); })()`);
    await sleep(300);

    // ---- 11. Theme choice is remembered
    await js(`${ctl}.setTheme('light')`);
    await sleep(700);
    check('light mode sets the theme attribute', (await state(`document.documentElement.dataset.theme`)) === 'light');
    app.emit('before-quit');
    const settings = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
    check('the theme is saved in the settings file', settings.theme === 'light');
    await js(`${ctl}.setTheme('dark')`);
  } catch (e) {
    failures.push(`script error: ${e && e.stack}`);
    console.error('[e2e] script error', e);
  } finally {
    console.log(`[e2e] ${pass} passed, ${failures.length} failed${failures.length ? ': ' + failures.join('; ') : ''}`);
    process.exitCode = failures.length ? 1 : 0;
    app.quit();
  }
};
