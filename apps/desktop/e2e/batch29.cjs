// Checks this batch in the real window: the menu icon row, Help, the plugins menu and window, app config folder, stats line.
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({ win, app }) => {
  const shots = process.env.CAVE_SHOTS;
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => { await sleep(400); fs.writeFileSync(path.join(shots, `${name}.png`), (await win.webContents.capturePage()).toPNG()); console.log('[e2e] shot', name); };
  const waitFor = async (expr, what, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(`Boolean(${expr})`)) return; await sleep(100); } throw new Error(`timeout waiting for ${what}`); };
  const click = (sel) => js(`(document.querySelector(${JSON.stringify(sel)}) || {click(){throw new Error('no ${sel}')}}).click()`);
  try {
    win.setSize(1360, 840);
    await waitFor('window.__cave && window.__cave.workspace.value && window.__cave.tree.rows.length > 0', 'workspace');
    await waitFor("window.__cave.indexStatus.value.state === 'ready'", 'indexing');
    await js(`window.__cave.openPage('Theology/Soteriology.md', { reveal: true })`);
    await sleep(900);
    // 1. the main menu
    await click('button[aria-label="Main menu"]'); await sleep(400);
    console.log('[e2e] menu toolbar buttons:', await js(`[...document.querySelectorAll('.menu-toolbar button')].map(b=>b.getAttribute('aria-label')+(b.disabled?'(disabled)':'')).join(',')`));
    console.log('[e2e] menu items:', await js(`[...document.querySelectorAll('.popover [role=menuitem], .popover .menu-item')].map(b=>b.textContent.trim()).join(' | ')`));
    await shot('a-main-menu');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'}); await sleep(300);
    await js(`(document.querySelector('.popover-backdrop')||document.body).click()`); await sleep(200);
    // 2. plugins menu
    await click('button[aria-label="Plugins"]'); await sleep(900);
    console.log('[e2e] plugins menu:', await js(`document.querySelector('.plugins-menu')?.innerText.replace(/\\n+/g,' | ')`));
    await shot('b-plugins-menu');
    await js(`(()=>{const i=document.querySelector('.plugin-search'); i.value='head'; i.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(300);
    console.log('[e2e] filtered:', await js(`document.querySelector('.plugin-items')?.innerText.replace(/\\n+/g,' | ')`));
    await shot('c-plugins-search');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'}); await sleep(300);
    // 3. all plugins window
    await js(`window.__cave.openPluginsDialog()`); await sleep(700);
    await shot('d-all-plugins');
    console.log('[e2e] plugin rows:', await js(`[...document.querySelectorAll('.plugin-row .pref-label')].map(x=>x.textContent).join(' | ')`));
    await js(`window.__cave.dialog.value = null`);
    // 4. help
    await js(`window.__cave.openHelp('docs')`); await sleep(600); await shot('e-help-docs');
    await js(`window.__cave.openHelp('shortcuts')`); await sleep(500); await shot('f-help-shortcuts');
    await js(`window.__cave.openHelp('about')`); await sleep(500); await shot('g-help-about');
    console.log('[e2e] about version line:', await js(`document.querySelector('.about-version-line')?.textContent`));
    await js(`window.__cave.openHelp('logs')`); await sleep(500); await shot('h-help-logs');
    await js(`window.__cave.dialog.value = null`);
    // 5. preferences > updates
    await js(`window.__cave.openPreferences()`); await sleep(500);
    await js(`[...document.querySelectorAll('.prefs-nav button')].find(b=>b.textContent==='Updates')?.click()`); await sleep(400);
    await shot('i-prefs-updates');
    await js(`window.__cave.dialog.value = null`);
    // 6. stats under the outline: set exportStyle on the page
    await js(`window.__cave.openPage('Welcome.md', { reveal: true })`); await sleep(700);
    console.log('[e2e] stats (plain):', await js(`document.querySelector('.doc-stats')?.innerText`));
    // 7. app config folder
    await js(`window.__cave.openAppConfigFolder()`); await sleep(1800);
    console.log('[e2e] app config tree:', await js(`window.__cave.tree.rows.map(r=>r.path||r.name).join(' | ')`));
    await shot('j-app-config');
  } catch (e) { console.error('[e2e] FAILED', e); process.exitCode = 1; } finally { app.quit(); }
};
