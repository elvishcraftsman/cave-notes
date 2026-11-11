// ---------------------------------------------------------------- the rule: one button press
// `vars.let.cmd` says which button it was: play, new, undo, flip, resign or draw.
const cmd = String((vars.let && vars.let.cmd) || 'play');
const str = (v) => (v === undefined || v === null ? '' : String(v));
const GLYPH = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟\uFE0E' };
const fail = (msg) => ({ props: { message: '⚠ ' + msg } });

const front = frontmatter(text);
const head = front ? text.slice(0, front.end) : '';
const rest = front ? text.slice(front.end) : text;
const h1 = (/^# .+$/m.exec(rest) || ['# Chess'])[0];
const notesAt = rest.indexOf('\n## Notes');
const notes = notesAt >= 0 ? rest.slice(notesAt + 1) : '## Notes\n\n';

let startFen = str(props.start_fen).trim() || START;
let tokens = str(props.history).trim() ? str(props.history).trim().split(/\s+/) : [];
let flip = props.flip === true;
let result = str(props.result);
let why = str(props.status);
let message = '';

let g;
try {
  g = replay(startFen, tokens);
} catch (e) {
  return fail(e.message);
}

// someone edited "fen": that is a new starting position
const typedFen = str(props.fen).trim();
if (typedFen && cmd !== 'new') {
  let norm;
  try {
    norm = toFen(parseFen(typedFen));
  } catch (e) {
    return fail('"fen" is not a position: ' + e.message);
  }
  if (norm !== toFen(g.s)) {
    startFen = norm;
    tokens = [];
    result = '';
    g = replay(startFen, tokens);
    message = 'Starting from the position in "fen".';
  }
}

const derived = () => ending(g);
const finished = () => derived() !== null || result !== '';
const sideName = (c) => (c === 'w' ? 'White' : 'Black');
const side = sideName(g.s.turn);

if (cmd === 'flip') {
  flip = !flip;
} else if (cmd === 'new') {
  tokens = [];
  result = '';
  g = replay(startFen, tokens);
  message = 'New game.';
} else if (cmd === 'undo') {
  if (result !== '' && derived() === null) {
    result = '';
    message = 'The game goes on.';
  } else if (tokens.length === 0) {
    message = 'There is no move to take back.';
  } else {
    const undone = tokens.pop();
    g = replay(startFen, tokens);
    result = '';
    message = 'Took back ' + undone + '.';
  }
} else if (cmd === 'resign' || cmd === 'draw') {
  if (finished()) message = 'The game is already over.';
  else if (cmd === 'draw') {
    result = '1/2-1/2';
    why = 'Draw agreed';
  } else {
    result = g.s.turn === 'w' ? '0-1' : '1-0';
    why = side + ' resigned';
  }
} else {
  // play
  const typed = str(ask.move).trim();
  if (finished()) message = 'The game is over. Press New game to play again.';
  else if (typed === '') message = 'No move was typed. Press Play move and type it (for example e4, Nf3, exd5 or O-O).';
  else {
    const found = findMoves(g.s, g.legal, typed);
    if (found.length === 0) {
      const all = g.legal.map((m) => sanOf(g.s, m, g.legal));
      message = '⚠ "' + typed + '" is not a legal move for ' + side + '. Moves you can make: ' + all.join(' ') + '.';
    } else if (found.length > 1) {
      message = '⚠ "' + typed + '" could mean several moves: ' + found.map((m) => sanOf(g.s, m, g.legal)).join(', ') + '. Say which piece, for example by its file (Nbd2).';
    } else {
      tokens.push(sanOf(g.s, found[0], g.legal));
      g = replay(startFen, tokens);
    }
  }
}

// how the game stands
const end = derived();
if (end) {
  result = end.result;
  why = end.why;
}
const turnNow = g.s.turn;
const checkNow = inCheck(g.s, turnNow);
const names = { w: str(props.white).trim() || 'White', b: str(props.black).trim() || 'Black' };
const named = (c) => (names[c] === sideName(c) ? sideName(c) : names[c] + ' (' + sideName(c) + ')');
let status;
if (result === '1-0' || result === '0-1') {
  const win = result === '1-0' ? 'w' : 'b';
  status = (why === 'Checkmate' ? 'Checkmate' : why) + ' — ' + named(win) + ' wins';
} else if (result === '1/2-1/2') status = why;
else status = named(turnNow) + ' to move' + (checkNow ? ' — check!' : '');

// the board, with White at the bottom (or Black, when flipped)
const files = flip ? 'hgfedcba' : 'abcdefgh';
const table = ['| | ' + files.split('').join(' | ') + ' | |', '|' + ':-:|'.repeat(10)];
for (let i = 0; i < 8; i++) {
  const r = flip ? 7 - i : i;
  const cells = [];
  for (let j = 0; j < 8; j++) {
    const c = flip ? 7 - j : j;
    const p = g.s.board[r * 8 + c];
    let cell = p ? GLYPH[p] : (r + c) % 2 === 1 ? '·' : ' ';
    if (p && g.last && g.last.to === r * 8 + c) cell = '**' + cell + '**';
    cells.push(cell);
  }
  table.push('| **' + (8 - r) + '** | ' + cells.join(' | ') + ' | **' + (8 - r) + '** |');
}

// the moves so far, numbered
let list = '';
g.sans.forEach((san, i) => {
  const n = g.numbers[i];
  if (n.turn === 'w') list += (list ? ' ' : '') + n.full + '. ' + san;
  else list += (list ? ' ' : '') + (i === 0 ? n.full + '... ' : '') + san;
});

const byValue = (a, b) => (VALUE[b.toUpperCase()] || 0) - (VALUE[a.toUpperCase()] || 0);
const taken = (c) => g.captured[c].slice().sort(byValue).map((p) => GLYPH[p]).join('') || '—';
const material = (c) => g.s.board.reduce((t, p) => t + (p !== '' && colorOf(p) === c ? VALUE[p.toUpperCase()] || 0 : 0), 0);
const lead = material('w') - material('b');

const body = [
  h1,
  '',
  '**' + status + '**',
  message ? '\n' + message : null,
  '',
  table.join('\n'),
  '',
  'Press **Play move** and type the move (`e4`, `Nf3`, `exd5`, `O-O`, `e7e8=Q`).',
  '',
  '[=Play move](automation:chess-play) · [=Take back](automation:chess-undo) · [=Flip board](automation:chess-flip) · [=Resign](automation:chess-resign) · [=Draw](automation:chess-draw) · [=New game](automation:chess-new)',
  '',
  '**Moves:** ' + (list || '—'),
  '',
  '**' + names.w + '** has taken ' + taken('w') + ' · **' + names.b + '** has taken ' + taken('b') + (lead === 0 ? ' · material is level' : ' · ' + (lead > 0 ? names.w : names.b) + ' is ahead by ' + Math.abs(lead)),
  '',
]
  .filter((x) => x !== null)
  .join('\n');

return {
  text: head + '\n\n' + body + '\n' + notes,
  props: {
    fen: toFen(g.s),
    turn: turnNow === 'w' ? 'white' : 'black',
    status,
    result,
    winner: result === '1-0' ? 'white' : result === '0-1' ? 'black' : result === '1/2-1/2' ? 'draw' : '',
    check: checkNow && !end,
    history: tokens.join(' '),
    ply: tokens.length,
    last: g.sans.length ? g.sans[g.sans.length - 1] : '',
    message,
    flip,
    start_fen: startFen === START ? null : startFen,
  },
};
