/**
 * Sequence diff and three-way merge on arrays of tokens (lines, or words and punctuation).
 *
 * The merge is built to be *symmetric*: merge3(base, a, b) and merge3(base, b, a) give the same text, so two
 * devices that merge the same pair of versions independently write identical bytes, and a sync tool sees no new
 * conflict. Nothing is dropped silently: where both sides changed the same stretch differently the result says
 * so (a conflict chunk) and carries both versions.
 */

/** Beyond this many edits in the differing middle part, give up matching it (more conflicts, never loss). */
const MAX_EDITS = 1500;

/**
 * Longest common subsequence as matching index pairs [i, j] (increasing in both), by Myers' O(ND) algorithm
 * after trimming the common head and tail.
 */
export function matchPairs(a, b) {
  let head = 0;
  const max = Math.min(a.length, b.length);
  while (head < max && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < max - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const out = [];
  for (let i = 0; i < head; i++) out.push([i, i]);
  for (const [i, j] of myers(a.slice(head, a.length - tail), b.slice(head, b.length - tail))) out.push([i + head, j + head]);
  for (let k = tail; k > 0; k--) out.push([a.length - k, b.length - k]);
  return out;
}

function myers(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [];
  const max = Math.min(n + m, MAX_EDITS);
  const off = n + m + 1;
  const v = new Int32Array(2 * (n + m) + 3);
  const trace = []; // trace[d]: v over k = -d-1 .. d+1 before round d
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m, d);
    }
  }
  return []; // too different to match: the caller treats the whole stretch as changed
}

function backtrack(trace, n, m, last) {
  const pairs = [];
  let x = n;
  let y = m;
  for (let d = last; d >= 0; d--) {
    const t = trace[d];
    const at = (k) => t[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK);
    const prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      pairs.push([x, y]);
    }
    x = prevX;
    y = prevY;
  }
  return pairs.reverse();
}

/** Changed regions between two sequences: [{ aStart, aEnd, bStart, bEnd }] with half-open ranges. */
export function hunks(a, b) {
  const out = [];
  let ai = 0;
  let bi = 0;
  for (const [i, j] of [...matchPairs(a, b), [a.length, b.length]]) {
    if (i > ai || j > bi) out.push({ aStart: ai, aEnd: i, bStart: bi, bEnd: j });
    ai = i + 1;
    bi = j + 1;
  }
  return out;
}

export const sameTokens = (x, y) => x.length === y.length && x.every((t, i) => t === y[i]);
export const compareStrings = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
const key = (tokens) => JSON.stringify(tokens);

/**
 * Three-way merge of token arrays.
 *
 * Returns chunks in order: { ok: tokens } for text that merged cleanly, and { conflict: { base, a, b } } where
 * both sides replaced the same stretch with different text. Two changes conflict only if their base ranges
 * overlap; neighbours do not. When both sides only *insert* at the same point, both insertions are kept in a
 * fixed order, which is not a conflict: nothing was removed, nothing is lost.
 */
export function merge3(base, a, b) {
  const ha = hunks(base, a).map((h) => ({ ...h, side: 'a' }));
  const hb = hunks(base, b).map((h) => ({ ...h, side: 'b' }));
  const chunks = [];
  const pushOk = (tokens) => {
    if (tokens.length === 0) return;
    const last = chunks[chunks.length - 1];
    if (last && last.ok) last.ok.push(...tokens);
    else chunks.push({ ok: [...tokens] });
  };

  // hunks of both sides in base order; at one position a pure insertion goes before a change that starts there
  const order = (p, q) => p.aStart - q.aStart || p.aEnd - q.aEnd;
  const all = [...ha, ...hb].sort(order);
  let pos = 0;
  let i = 0;
  while (i < all.length) {
    const first = all[i];
    const group = [first];
    const start = first.aStart;
    let end = first.aEnd;
    let allEmpty = first.aEnd === first.aStart;
    i++;
    while (i < all.length) {
      const h = all[i];
      const joins = h.aStart < end || (allEmpty && h.aStart === start && h.aEnd === h.aStart);
      if (!joins) break;
      group.push(h);
      end = Math.max(end, h.aEnd);
      if (h.aEnd !== h.aStart) allEmpty = false;
      i++;
    }
    pushOk(base.slice(pos, start));
    pos = end;

    const rebuild = (side, seq) => {
      const g = group.filter((h) => h.side === side);
      if (g.length === 0) return null;
      const out = [];
      let p = start;
      for (const h of g) {
        out.push(...base.slice(p, h.aStart), ...seq.slice(h.bStart, h.bEnd));
        p = h.aEnd;
      }
      out.push(...base.slice(p, end));
      return out;
    };
    const ra = rebuild('a', a);
    const rb = rebuild('b', b);
    const baseSpan = base.slice(start, end);
    if (ra && !rb) pushOk(ra);
    else if (rb && !ra) pushOk(rb);
    else if (sameTokens(ra, rb)) pushOk(ra);
    else if (sameTokens(ra, baseSpan)) pushOk(rb);
    else if (sameTokens(rb, baseSpan)) pushOk(ra);
    else if (end === start) {
      const [x, y] = compareStrings(key(ra), key(rb)) <= 0 ? [ra, rb] : [rb, ra];
      pushOk(x);
      pushOk(y);
    } else chunks.push({ conflict: { base: baseSpan, a: ra, b: rb } });
  }
  pushOk(base.slice(pos));
  return chunks;
}
