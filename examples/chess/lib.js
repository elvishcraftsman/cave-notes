// ---------------------------------------------------------------- the rules of chess
// A position is { board, turn, castling, ep, half, full }. `board` has 64 squares, 0 = a8 ... 63 = h1, each '' or a piece letter
// (capitals are white). `ep` is the square a pawn may capture on (or -1), `half` the moves since a capture or pawn move.
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FILES = 'abcdefgh';
const sqName = (i) => FILES[i & 7] + (8 - (i >> 3));
const sqIndex = (s) => (8 - Number(s[1])) * 8 + FILES.indexOf(s[0]);
const isWhite = (p) => p !== '' && p === p.toUpperCase();
const colorOf = (p) => (isWhite(p) ? 'w' : 'b');
const other = (c) => (c === 'w' ? 'b' : 'w');

function parseFen(fen) {
  const f = String(fen).trim().split(/\s+/);
  if (f.length < 2) throw new Error('A position needs at least the pieces and whose turn it is (like "' + START + '").');
  const rows = f[0].split('/');
  if (rows.length !== 8) throw new Error('The pieces of a position are eight rows separated by "/".');
  const board = [];
  for (const row of rows) {
    let n = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) {
        for (let k = 0; k < Number(ch); k++) board.push('');
        n += Number(ch);
      } else if (/[pnbrqkPNBRQK]/.test(ch)) {
        board.push(ch);
        n++;
      } else throw new Error('"' + ch + '" is not a piece in the position.');
    }
    if (n !== 8) throw new Error('Every row of a position must have eight squares.');
  }
  if (board.filter((p) => p === 'K').length !== 1 || board.filter((p) => p === 'k').length !== 1) throw new Error('A position needs one white and one black king.');
  if (board.some((p, i) => (p === 'P' || p === 'p') && (i < 8 || i > 55))) throw new Error('A pawn cannot stand on the first or last row.');
  let castling = f[2] && f[2] !== '-' ? f[2] : '';
  // keep only the rights that the pieces allow
  const ok = { K: board[60] === 'K' && board[63] === 'R', Q: board[60] === 'K' && board[56] === 'R', k: board[4] === 'k' && board[7] === 'r', q: board[4] === 'k' && board[0] === 'r' };
  castling = 'KQkq'.split('').filter((c) => castling.includes(c) && ok[c]).join('');
  const ep = f[3] && f[3] !== '-' && /^[a-h][36]$/.test(f[3]) ? sqIndex(f[3]) : -1;
  return { board, turn: f[1] === 'b' ? 'b' : 'w', castling, ep, half: Number(f[4]) >= 0 ? Number(f[4]) : 0, full: Number(f[5]) >= 1 ? Number(f[5]) : 1 };
}

function toFen(s) {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let row = '';
    let gap = 0;
    for (let c = 0; c < 8; c++) {
      const p = s.board[r * 8 + c];
      if (p === '') gap++;
      else {
        if (gap) row += gap;
        gap = 0;
        row += p;
      }
    }
    rows.push(row + (gap ? gap : ''));
  }
  return rows.join('/') + ' ' + s.turn + ' ' + (s.castling || '-') + ' ' + (s.ep >= 0 ? sqName(s.ep) : '-') + ' ' + s.half + ' ' + s.full;
}

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// is square `sq` attacked by a piece of colour `by`?
function attacked(board, sq, by) {
  const r = sq >> 3;
  const c = sq & 7;
  const pr = by === 'w' ? r + 1 : r - 1;
  if (pr >= 0 && pr < 8) for (const dc of [-1, 1]) if (c + dc >= 0 && c + dc < 8 && board[pr * 8 + c + dc] === (by === 'w' ? 'P' : 'p')) return true;
  const at = (rr, cc) => (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 ? board[rr * 8 + cc] : null);
  const N = by === 'w' ? 'N' : 'n';
  const K = by === 'w' ? 'K' : 'k';
  for (const [dr, dc] of KNIGHT) if (at(r + dr, c + dc) === N) return true;
  for (const [dr, dc] of KING) if (at(r + dr, c + dc) === K) return true;
  const slide = (dirs, a, b) => {
    for (const [dr, dc] of dirs) {
      for (let rr = r + dr, cc = c + dc; rr >= 0 && rr < 8 && cc >= 0 && cc < 8; rr += dr, cc += dc) {
        const p = board[rr * 8 + cc];
        if (p === '') continue;
        if (p === a || p === b) return true;
        break;
      }
    }
    return false;
  };
  return slide(DIAG, by === 'w' ? 'B' : 'b', by === 'w' ? 'Q' : 'q') || slide(ORTH, by === 'w' ? 'R' : 'r', by === 'w' ? 'Q' : 'q');
}

const kingSquare = (board, color) => board.indexOf(color === 'w' ? 'K' : 'k');
const inCheck = (s, color) => attacked(s.board, kingSquare(s.board, color), other(color));

// every move the pieces allow, before asking whether the king is left in check
function pseudoMoves(s) {
  const out = [];
  const me = s.turn;
  const b = s.board;
  const add = (from, to, extra) => out.push({ from, to, piece: b[from], cap: b[to], promo: '', ep: false, castle: '', dbl: false, ...extra });
  for (let from = 0; from < 64; from++) {
    const p = b[from];
    if (p === '' || colorOf(p) !== me) continue;
    const r = from >> 3;
    const c = from & 7;
    const t = p.toUpperCase();
    if (t === 'P') {
      const dir = me === 'w' ? -1 : 1;
      const startRow = me === 'w' ? 6 : 1;
      const lastRow = me === 'w' ? 0 : 7;
      const push = (to, extra) => {
        if (to >> 3 === lastRow) for (const q of ['Q', 'R', 'B', 'N']) add(from, to, { ...extra, promo: q });
        else add(from, to, extra);
      };
      const one = from + dir * 8;
      if (b[one] === '') {
        push(one, {});
        if (r === startRow && b[one + dir * 8] === '') add(from, one + dir * 8, { dbl: true });
      }
      for (const dc of [-1, 1]) {
        if (c + dc < 0 || c + dc > 7) continue;
        const to = one + dc;
        if (b[to] !== '' && colorOf(b[to]) !== me) push(to, {});
        else if (to === s.ep && b[to] === '') add(from, to, { ep: true, cap: me === 'w' ? 'p' : 'P' });
      }
    } else if (t === 'N' || t === 'K') {
      for (const [dr, dc] of t === 'N' ? KNIGHT : KING) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
        const to = rr * 8 + cc;
        if (b[to] === '' || colorOf(b[to]) !== me) add(from, to, {});
      }
    } else {
      for (const [dr, dc] of t === 'B' ? DIAG : t === 'R' ? ORTH : DIAG.concat(ORTH)) {
        for (let rr = r + dr, cc = c + dc; rr >= 0 && rr < 8 && cc >= 0 && cc < 8; rr += dr, cc += dc) {
          const to = rr * 8 + cc;
          if (b[to] === '') add(from, to, {});
          else {
            if (colorOf(b[to]) !== me) add(from, to, {});
            break;
          }
        }
      }
    }
  }
  // castling: neither piece has moved, the squares between are empty, and the king does not cross a square that is attacked
  const foe = other(me);
  const home = me === 'w' ? 60 : 4;
  if (b[home] === (me === 'w' ? 'K' : 'k') && !attacked(b, home, foe)) {
    const rights = me === 'w' ? ['K', 'Q'] : ['k', 'q'];
    if (s.castling.includes(rights[0]) && b[home + 1] === '' && b[home + 2] === '' && !attacked(b, home + 1, foe) && !attacked(b, home + 2, foe)) add(home, home + 2, { castle: 'K' });
    if (s.castling.includes(rights[1]) && b[home - 1] === '' && b[home - 2] === '' && b[home - 3] === '' && !attacked(b, home - 1, foe) && !attacked(b, home - 2, foe)) add(home, home - 2, { castle: 'Q' });
  }
  return out;
}

function makeMove(s, m) {
  const board = s.board.slice();
  const me = s.turn;
  board[m.to] = m.promo ? (me === 'w' ? m.promo : m.promo.toLowerCase()) : m.piece;
  board[m.from] = '';
  if (m.ep) board[m.to + (me === 'w' ? 8 : -8)] = '';
  if (m.castle === 'K') {
    board[m.to - 1] = board[m.to + 1];
    board[m.to + 1] = '';
  } else if (m.castle === 'Q') {
    board[m.to + 1] = board[m.to - 2];
    board[m.to - 2] = '';
  }
  let castling = s.castling;
  const drop = (cs) => (castling = castling.split('').filter((c) => !cs.includes(c)).join(''));
  if (m.piece === 'K') drop('KQ');
  if (m.piece === 'k') drop('kq');
  for (const sq of [m.from, m.to]) {
    if (sq === 63) drop('K');
    if (sq === 56) drop('Q');
    if (sq === 7) drop('k');
    if (sq === 0) drop('q');
  }
  return {
    board,
    turn: other(me),
    castling,
    ep: m.dbl ? (m.from + m.to) / 2 : -1,
    half: m.piece.toUpperCase() === 'P' || m.cap !== '' ? 0 : s.half + 1,
    full: me === 'b' ? s.full + 1 : s.full,
  };
}

function legalMoves(s) {
  return pseudoMoves(s).filter((m) => !inCheck(makeMove(s, m), s.turn));
}

// ---------------------------------------------------------------- writing and reading moves
function sanOf(s, m, legal) {
  let t;
  if (m.castle) t = m.castle === 'K' ? 'O-O' : 'O-O-O';
  else {
    const P = m.piece.toUpperCase();
    t = '';
    if (P === 'P') {
      if (m.cap !== '') t += FILES[m.from & 7];
    } else {
      t += P;
      const rivals = legal.filter((x) => x.piece === m.piece && x.to === m.to && x.from !== m.from);
      if (rivals.length > 0) {
        if (!rivals.some((x) => (x.from & 7) === (m.from & 7))) t += FILES[m.from & 7];
        else if (!rivals.some((x) => x.from >> 3 === m.from >> 3)) t += 8 - (m.from >> 3);
        else t += sqName(m.from);
      }
    }
    if (m.cap !== '') t += 'x';
    t += sqName(m.to);
    if (m.promo) t += '=' + m.promo;
  }
  const after = makeMove(s, m);
  if (inCheck(after, after.turn)) t += legalMoves(after).length === 0 ? '#' : '+';
  return t;
}

// the moves that fit what a person typed: standard notation (Nf3, exd5, O-O, e8=Q) or coordinates (e2e4, e7e8q)
function findMoves(s, legal, input) {
  let t = String(input).trim().replace(/[!?]+$/, '').replace(/\s+/g, '').replace(/[+#]+$/, '');
  if (/^[nrqk][a-h1-8x]/.test(t)) t = t[0].toUpperCase() + t.slice(1);
  if (/^[0Oo]-[0Oo]-[0Oo]$/.test(t)) return legal.filter((m) => m.castle === 'Q');
  if (/^[0Oo]-[0Oo]$/.test(t)) return legal.filter((m) => m.castle === 'K');
  let m = /^[KQRBN]?([a-h][1-8])[-x]?([a-h][1-8])=?([qrbnQRBN])?$/.exec(t);
  if (m) {
    const found = legal.filter((x) => sqName(x.from) === m[1] && sqName(x.to) === m[2]);
    return pickPromotion(found, m[3]);
  }
  m = /^([KQRBN])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([QRBNqrbn]))?$/.exec(t);
  if (!m) return [];
  const piece = m[1] || 'P';
  const found = legal.filter((x) => x.piece.toUpperCase() === piece && sqName(x.to) === m[4] && (!m[2] || FILES[x.from & 7] === m[2]) && (!m[3] || String(8 - (x.from >> 3)) === m[3]));
  return pickPromotion(found, m[5]);
}

// a pawn reaching the last row: the piece asked for, or a queen
function pickPromotion(found, want) {
  if (found.length === 0 || !found.some((m) => m.promo)) return found;
  return found.filter((m) => m.promo === (want ? want.toUpperCase() : 'Q'));
}

// ---------------------------------------------------------------- how a game stands
const VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9 };

function insufficient(board) {
  const rest = board.filter((p) => p !== '' && p.toUpperCase() !== 'K');
  if (rest.length === 0) return true;
  if (rest.some((p) => !'nbNB'.includes(p))) return false;
  if (rest.length === 1) return true;
  // only bishops, all on squares of one colour
  if (rest.every((p) => 'bB'.includes(p))) {
    const colours = new Set();
    board.forEach((p, i) => p !== '' && 'bB'.includes(p) && colours.add(((i >> 3) + (i & 7)) % 2));
    return colours.size === 1;
  }
  return false;
}

// a position's identity for the repetition rule: pieces, turn, castling, and the en passant square only when it matters
function positionKey(s, legal) {
  return s.board.map((p) => p || '.').join('') + s.turn + s.castling + (s.ep >= 0 && legal.some((m) => m.ep) ? s.ep : '');
}

// play a list of moves (standard notation) from a position; returns where it ended and what happened on the way
function replay(startFen, tokens) {
  let s = parseFen(startFen);
  let legal = legalMoves(s);
  const seen = {};
  const bump = (st, lg) => {
    const k = positionKey(st, lg);
    seen[k] = (seen[k] || 0) + 1;
    return seen[k];
  };
  let repeats = bump(s, legal);
  const sans = [];
  const numbers = [];
  const captured = { w: [], b: [] }; // pieces each side has taken
  let last = null;
  for (const tok of tokens) {
    const found = findMoves(s, legal, tok);
    if (found.length !== 1) throw new Error('The list of moves does not replay at "' + tok + '". Edit "history", or start a new game.');
    const m = found[0];
    numbers.push({ full: s.full, turn: s.turn });
    sans.push(sanOf(s, m, legal));
    if (m.cap !== '') captured[s.turn].push(m.cap);
    last = m;
    s = makeMove(s, m);
    legal = legalMoves(s);
    repeats = bump(s, legal);
  }
  return { s, legal, sans, numbers, captured, last, repeats };
}

// the end of the game, if the position is one: { result: '1-0' | '0-1' | '1/2-1/2', why }
function ending(g) {
  const { s, legal } = g;
  const checked = inCheck(s, s.turn);
  if (legal.length === 0) return checked ? { result: s.turn === 'w' ? '0-1' : '1-0', why: 'Checkmate' } : { result: '1/2-1/2', why: 'Stalemate' };
  if (insufficient(s.board)) return { result: '1/2-1/2', why: 'Draw: neither side has enough pieces to checkmate' };
  if (g.repeats >= 3) return { result: '1/2-1/2', why: 'Draw: the same position came up three times' };
  if (s.half >= 100) return { result: '1/2-1/2', why: 'Draw: fifty moves without a capture or a pawn move' };
  return null;
}
