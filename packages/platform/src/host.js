// What the service asks the machine about itself. Node answers for real; in the WebView the app installs its own answers
// with setHost (Android knows its own cache folder and device name), and whatever it leaves out gets a harmless default.

/** @typedef {{ hostname: () => string, homedir: () => string, tmpdir: () => string, cpuCount: () => number, pid: () => number, rssMB: () => number }} Host */

/** @param {Host} defaults */
export function createHostHolder(defaults) {
  let current = defaults;
  const host = {
    hostname: () => (current.hostname ?? defaults.hostname)(),
    homedir: () => (current.homedir ?? defaults.homedir)(),
    tmpdir: () => (current.tmpdir ?? defaults.tmpdir)(),
    cpuCount: () => (current.cpuCount ?? defaults.cpuCount)(),
    pid: () => (current.pid ?? defaults.pid)(),
    rssMB: () => (current.rssMB ?? defaults.rssMB)(),
  };
  return {
    host,
    setHost(impl) {
      current = { ...defaults, ...impl };
    },
    resetHost() {
      current = defaults;
    },
  };
}
