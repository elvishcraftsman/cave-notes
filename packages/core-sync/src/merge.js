import { compareStrings, hunks, matchPairs, merge3, sameTokens } from './diff.js';

const TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;
export const tokenize = (s) => s.match(TOKEN) ?? [];
export const splitLines = (s) => (s === '' ? [] : s.split(/(?<=\n)/));

const FRONTMATTER = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** Split a page into its frontmatter block (with its fences, or '') and the rest. */
export function splitFrontmatter(text) {
  const m = FRONTMATTER.exec(text);
  return m ? { front: m[0], body: text.slice(m[0].length) } : { front: '', body: text };
}

export const CONFLICT_OPEN = '<<<<<<< conflict: both versions kept';
export const CONFLICT_MID = '=======';
export const CONFLICT_CLOSE = '>>>>>>> end of conflict';

const withNewline = (s) => (s === '' || s.endsWith('\n') ? s : `${s}\n`);

/**
 * Merge three texts. Lines first; where both sides changed the same lines, the words inside are merged;
 * what still clashes goes to `onConflict(base, a, b)`, which returns the text to use.
 */
function mergeText(base, a, b, onConflict) {
  const chunks = merge3(splitLines(base), splitLines(a), splitLines(b));
  let out = '';
  let conflicts = 0;
  for (const c of chunks) {
    if (c.ok) {
      out += c.ok.join('');
      continue;
    }
    const [cb, ca, cn] = [c.conflict.base.join(''), c.conflict.a.join(''), c.conflict.b.join('')];
    const fine = merge3(tokenize(cb), tokenize(ca), tokenize(cn));
    if (fine.every((x) => x.ok)) out += fine.map((x) => x.ok.join('')).join('');
    else {
      conflicts++;
      out += onConflict(cb, ca, cn);
    }
  }
  return { text: out, conflicts };
}

/**
 * Merge two versions of a page that both grew out of `base`.
 *
 * - Pure function of its inputs, symmetric in `local` and `remote` (apart from the `*Time` tie-break, which
 *   is the same on every device because file times travel with the file).
 * - Frontmatter never gets conflict markers (that would break it): a clash there goes to the side saved
 *   later, and the other side's text is reported in `lost` so the caller can keep it in the history.
 * - In the body a clash keeps both versions between marker lines.
 *
 * @returns {{ text: string, conflicts: number, lost: string[] }}
 */
export function mergeDocuments({ base, local, remote, localTime = 0, remoteTime = 0 }) {
  if (local === remote) return { text: local, conflicts: 0, lost: [] };
  if (base === local) return { text: remote, conflicts: 0, lost: [] };
  if (base === remote) return { text: local, conflicts: 0, lost: [] };

  const [B, L, R] = [splitFrontmatter(base), splitFrontmatter(local), splitFrontmatter(remote)];
  const lost = [];

  const localNewer = localTime !== remoteTime ? localTime > remoteTime : compareStrings(local, remote) > 0;
  const front = mergeText(B.front, L.front, R.front, (_b, a, b) => {
    lost.push(localNewer ? b : a);
    return localNewer ? a : b;
  });

  let conflicts = 0;
  const body = mergeText(B.body, L.body, R.body, (_b, a, b) => {
    conflicts++;
    const [x, y] = compareStrings(a, b) <= 0 ? [a, b] : [b, a];
    return `${CONFLICT_OPEN}\n${withNewline(x)}${CONFLICT_MID}\n${withNewline(y)}${CONFLICT_CLOSE}\n`;
  });
  return { text: front.text + body.text, conflicts, lost };
}

/** How many lines differ between two texts (a rough distance). */
export function lineDistance(x, y) {
  let n = 0;
  for (const h of hunks(splitLines(x), splitLines(y))) n += Math.max(h.aEnd - h.aStart, h.bEnd - h.bStart);
  return n;
}

/** The lines two texts have in common, in order (a stand-in base when no real common ancestor is known). */
export function commonLines(x, y) {
  const a = splitLines(x);
  return matchPairs(a, splitLines(y)).map(([i]) => a[i]).join('');
}

/**
 * Choose the best common ancestor for two diverged versions from texts seen earlier (newest first): the one
 * closest to both. With nothing close, the lines the two share stand in, which keeps everything from both.
 */
export function pickBase(candidates, a, b) {
  let best = { text: commonLines(a, b), score: lineDistance(commonLines(a, b), a) + lineDistance(commonLines(a, b), b) + 0.5 };
  for (const c of candidates) {
    const score = lineDistance(c, a) + lineDistance(c, b);
    if (score < best.score) best = { text: c, score };
  }
  return best.text;
}

export { sameTokens };

/**
 * The edits that turn `from` into `to`, as [{ from, to, insert }] with offsets into `from` (ascending, not
 * overlapping): changed lines found by diff, then trimmed to the characters that really differ. Applied to an
 * editor they leave the cursor and undo history alone wherever the text did not change.
 */
export function textChanges(from, to) {
  if (from === to) return [];
  const a = splitLines(from);
  const b = splitLines(to);
  const starts = [0];
  for (const l of a) starts.push(starts[starts.length - 1] + l.length);
  const bStarts = [0];
  for (const l of b) bStarts.push(bStarts[bStarts.length - 1] + l.length);
  const out = [];
  for (const h of hunks(a, b)) {
    let f = starts[h.aStart];
    let t = starts[h.aEnd];
    let ins = to.slice(bStarts[h.bStart], bStarts[h.bEnd]);
    let head = 0;
    const old = from.slice(f, t);
    while (head < old.length && head < ins.length && old[head] === ins[head]) head++;
    let tail = 0;
    while (tail < old.length - head && tail < ins.length - head && old[old.length - 1 - tail] === ins[ins.length - 1 - tail]) tail++;
    f += head;
    t -= tail;
    ins = ins.slice(head, ins.length - tail);
    out.push({ from: f, to: t, insert: ins });
  }
  return out;
}
