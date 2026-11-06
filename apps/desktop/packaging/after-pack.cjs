// electron-builder afterPack hook. An AppImage cannot hold a setuid chrome-sandbox (read-only, mounted nosuid), and a
// chrome-sandbox that is present but not setuid makes Chromium abort ("The SUID sandbox helper binary was found, but is
// not configured correctly") even where the user-namespace sandbox would work. Without the file Chromium goes straight to
// the user-namespace sandbox; AppRun adds --no-sandbox only where that is unavailable.
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const file = path.join(context.appOutDir, 'chrome-sandbox');
  if (fs.existsSync(file)) {
    fs.rmSync(file);
    console.log('  • removed chrome-sandbox (user-namespace sandbox is used instead)');
  }
};
