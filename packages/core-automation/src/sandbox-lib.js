/**
 * The inside of the JavaScript sandbox: what a rule's script gets to use.
 *
 * `createApi` is written as ordinary JavaScript so it can be read and tested, but it is never imported by the script's world:
 * the sandbox takes its *source text* (`createApi.toString()`) and compiles it inside the locked-down context. That is why it
 * must not mention anything outside itself (no imports, no helper declared beside it).
 *
 * Positions are always offsets: the number of characters from the start of the text, starting at 0. Lines and columns, where
 * they appear, count from 1, as in the editor's status bar.
 */
export function createApi(call, namesJson, inputJson) {
  const names = JSON.parse(namesJson);
  const input = JSON.parse(inputJson);
  const logs = [];

  // ---- the functions of the expression language: fn.add(today, "7d"), fn.format(...)
  const unwrap = (s) => {
    const r = JSON.parse(s);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  const fn = {};
  for (const n of names) fn[n] = (...args) => unwrap(call(JSON.stringify([n, args])));

  const log = (...parts) => {
    if (logs.length < 50) logs.push(parts.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ').slice(0, 500));
  };

  // ---- reading the structure of a Markdown text: fenced code, the frontmatter and the headings
  let cache = null;
  const scan = (text) => {
    if (cache && cache.text === text) return cache;
    const fences = [];
    const headings = [];
    let front = null;
    let open = null; // the fence being read: { mark, size, start }
    let offset = 0;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      const start = offset;
      const end = start + line.length;
      offset += raw.length + 1;
      if (i === 0 && /^---\s*$/.test(line)) {
        let j = 1;
        let at = offset;
        while (j < lines.length && !/^(---|\.\.\.)\s*$/.test(lines[j].replace(/\r$/, ''))) {
          at += lines[j].length + 1;
          j++;
        }
        if (j < lines.length) {
          front = { start: 0, end: at + lines[j].replace(/\r$/, '').length };
          i = j;
          offset = at + lines[j].length + 1;
          continue;
        }
      }
      if (open) {
        const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
        if (m && m[1][0] === open.mark && m[1].length >= open.size) {
          fences.push({ start: open.start, end });
          open = null;
        }
        continue;
      }
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (f) {
        open = { mark: f[1][0], size: f[1].length, start };
        continue;
      }
      const h = /^( {0,3})(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line);
      if (h) {
        const text0 = h[3] ?? '';
        const textStart = text0 === '' ? end : start + line.indexOf(text0, h[1].length + h[2].length);
        headings.push({ level: h[2].length, text: text0, line: i + 1, start, end, textStart });
      }
    }
    if (open) fences.push({ start: open.start, end: text.length });
    cache = { text, fences, headings, front };
    return cache;
  };
  const copy = (o) => (o === null ? null : { ...o });

  const outline = (text) => scan(text).headings.map(copy);
  const fences = (text) => scan(text).fences.map(copy);
  const frontmatter = (text) => copy(scan(text).front);
  const isInFence = (text, pos) => scan(text).fences.some((f) => pos >= f.start && pos <= f.end);
  const headingAt = (text, pos) => {
    let found = null;
    for (const h of scan(text).headings) if (h.start <= pos) found = h;
    return copy(found);
  };
  const nextHeading = (text, pos, maxLevel) => copy(scan(text).headings.find((h) => h.start > pos && (maxLevel === undefined || h.level <= maxLevel)) ?? null);
  const previousHeading = (text, pos, maxLevel) => {
    let found = null;
    for (const h of scan(text).headings) if (h.start < pos && (maxLevel === undefined || h.level <= maxLevel)) found = h;
    return copy(found);
  };
  const section = (text, pos) => {
    const h = headingAt(text, pos);
    if (!h) return null;
    const next = nextHeading(text, h.start, h.level);
    return { heading: h, start: h.start, end: next ? next.start : text.length };
  };
  const lineAt = (text, pos) => {
    const p = Math.max(0, Math.min(pos, text.length));
    const start = text.lastIndexOf('\n', p - 1) + 1;
    let end = text.indexOf('\n', p);
    if (end === -1) end = text.length;
    const line = text.slice(0, start).split('\n').length;
    return { line, column: p - start + 1, start, end, text: text.slice(start, end).replace(/\r$/, '') };
  };
  const offsetAt = (text, line, column = 1) => {
    let start = 0;
    for (let n = 1; n < line; n++) {
      const i = text.indexOf('\n', start);
      if (i === -1) return text.length;
      start = i + 1;
    }
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    return Math.min(start + Math.max(0, column - 1), end);
  };
  const applyEdits = (text, edits) => {
    const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to);
    let out = '';
    let at = 0;
    const steps = [];
    for (const e of sorted) {
      if (e.from < at) throw new Error('applyEdits: two edits overlap');
      out += text.slice(at, e.from) + e.insert;
      steps.push({ from: e.from, to: e.to, newFrom: out.length - e.insert.length, newTo: out.length });
      at = e.to;
    }
    out += text.slice(at);
    const map = (pos) => {
      let delta = 0;
      for (const s of steps) {
        if (pos >= s.to) delta = s.newTo - s.to;
        else if (pos > s.from) return s.newTo; // inside text that was replaced: just after the new text
        else break;
      }
      return pos + delta;
    };
    return { text: out, map };
  };

  const globals = {
    text: input.text,
    selection: input.selection,
    cursor: input.cursor,
    page: input.page,
    props: input.props,
    ask: input.ask,
    today: input.today,
    now: input.now,
    vars: input.vars,
    fn,
    log,
    outline,
    fences,
    frontmatter,
    isInFence,
    headingAt,
    nextHeading,
    previousHeading,
    section,
    lineAt,
    offsetAt,
    applyEdits,
  };

  // ---- what the script returns, as text the outside can read
  const finish = (value) => {
    if (value && typeof value.then === 'function') throw new Error('the script returned a promise: await is not available, return the result itself');
    let out = value === undefined ? null : typeof value === 'string' ? { text: value } : value;
    const json = JSON.stringify({ value: out, logs });
    if (json.length > 5_000_000) throw new Error('the script returned too much');
    return json;
  };
  return { names: Object.keys(globals), values: Object.values(globals), finish };
}
