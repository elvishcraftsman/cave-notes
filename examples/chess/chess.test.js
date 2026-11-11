import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE = process.env.CAVE_CORE ?? path.join(HERE, '../../packages/core-automation');
const { World, FakeWorkspace, makeEngine, splitFront } = await import(path.join(CORE, 'test/helpers.js'));

const RULES = fs.readFileSync(path.join(HERE, 'chess-game.yaml'), 'utf8');
const PLUGIN = fs.readFileSync(path.join(HERE, 'chess.yaml'), 'utf8');
const PAGE = fs.readFileSync(path.join(HERE, 'Chess.md'), 'utf8');

async function game(page = PAGE) {
  const world = new World();
  const ws = new FakeWorkspace(world, { 'Chess.md': page });
  const { engine } = await makeEngine(world, ws, RULES);
  const attr = (k) => {
    const m = new RegExp('^' + k + ': ?(.*)$', 'm').exec(ws.text('Chess.md').split('\n---')[0]);
    if (!m) return undefined;
    const v = m[1].trim();
    return v.startsWith('"') ? JSON.parse(v) : v === 'true' ? true : v === 'false' ? false : v;
  };
  const press = async (id, answers = {}) => {
    const r = await engine.runButton(id, 'Chess.md', answers);
    assert.equal(r.status, 'done', `${id}: ${r.status} ${r.detail}`);
  };
  // the move is typed into the dialog the Play button opens
  const play = async (...moves) => {
    for (const m of moves) await press('chess-play', { move: m });
  };
  return { ws, engine, attr, press, play, body: () => ws.text('Chess.md') };
}

test('New game sets the board up, with the buttons and the page notes kept', async () => {
  const g = await game();
  await g.press('chess-new');
  assert.equal(g.attr('fen'), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.equal(g.attr('status'), 'White to move');
  assert.match(g.body(), /\| \*\*8\*\* \| ♜ \| ♞ \| ♝ \| ♛ \| ♚ \| ♝ \| ♞ \| ♜ \| \*\*8\*\* \|/);
  assert.match(g.body(), /\[=Play move\]\(automation:chess-play\)/);
  assert.match(g.body(), /## Notes\n\nWrite what you like here/);
  assert.match(g.body(), /^# Chess$/m);
});

test('a game: moves are written in standard notation, and the board follows', async () => {
  const g = await game();
  await g.press('chess-new');
  await g.play('e4', 'e7e5', 'nf3', 'Nc6');
  assert.equal(g.attr('history'), 'e4 e5 Nf3 Nc6');
  assert.equal(g.attr('status'), 'White to move');
  assert.equal(g.attr('last'), 'Nc6');
  assert.match(g.body(), /\*\*Moves:\*\* 1\. e4 e5 2\. Nf3 Nc6/);
  assert.equal(g.attr('fen'), 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
});

test("scholar's mate ends the game, and no more moves are taken", async () => {
  const g = await game();
  await g.press('chess-new');
  await g.play('e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#');
  assert.equal(g.attr('result'), '1-0');
  assert.equal(g.attr('winner'), 'white');
  assert.match(g.attr('status'), /^Checkmate — White wins$/);
  assert.match(g.attr('history'), /Qxf7#$/);
  await g.play('a6');
  assert.match(g.attr('message'), /game is over/);
  assert.equal(g.attr('ply'), '7');
});

test('an illegal move is explained, and nothing changes', async () => {
  const g = await game();
  await g.press('chess-new');
  await g.play('e5');
  assert.match(g.body().replace(/\n  /g, ' '), /"e5" is not a legal move for White\. Moves you can make: .*e4/);
  assert.equal(g.attr('history'), '');
  await g.play('e4');
  assert.equal(g.attr('message'), '');
});

test('take back goes back one move at a time, even after checkmate', async () => {
  const g = await game();
  await g.press('chess-new');
  await g.play('f3', 'e5', 'g4', 'Qh4#');
  assert.equal(g.attr('winner'), 'black');
  await g.press('chess-undo');
  assert.equal(g.attr('history'), 'f3 e5 g4');
  assert.equal(g.attr('result'), '');
  assert.equal(g.attr('status'), 'Black to move');
  await g.press('chess-undo');
  await g.press('chess-undo');
  await g.press('chess-undo');
  assert.equal(g.attr('history'), '');
  await g.press('chess-undo');
  assert.match(g.attr('message'), /no move to take back/);
});

test('New game, Resign and Draw, and the questions the buttons ask first', async () => {
  const g = await game();
  const ask = await g.engine.buttonQuestions('chess-play', { path: 'Chess.md' });
  assert.equal(ask.title, 'Chess: Play a move');
  await g.press('chess-new');
  const q = await g.engine.buttonQuestions('chess-play', { path: 'Chess.md' });
  assert.deepEqual(q.ask.map((x) => [x.name, x.type]), [['board', 'info'], ['last', 'info'], ['move', 'text']]);
  assert.equal(q.ask[0].label, 'White to move');
  const sure = await g.engine.buttonQuestions('chess-resign', { path: 'Chess.md' });
  assert.deepEqual(sure.ask.map((x) => [x.type, x.label]), [['info', 'Does the player to move (white) resign?']]);
  assert.equal((await g.engine.buttonQuestions('chess-undo', { path: 'Chess.md' })).ask.length, 0);
  await g.play('d4');
  await g.press('chess-resign');
  assert.equal(g.attr('result'), '1-0');
  assert.equal(g.attr('status'), 'Black resigned — White wins');
  await g.press('chess-undo');
  assert.equal(g.attr('result'), '');
  assert.equal(g.attr('history'), 'd4');
  await g.press('chess-draw');
  assert.equal(g.attr('result'), '1/2-1/2');
  assert.equal(g.attr('winner'), 'draw');
  await g.press('chess-new');
  assert.equal(g.attr('history'), '');
  assert.equal(g.attr('result'), '');
});

test('castling, en passant, promotion and a disambiguated move', async () => {
  const g = await game();
  await g.press('chess-new');
  await g.play('e4', 'a6', 'e5', 'd5', 'exd6', 'Nf6', 'Nf3', 'e6', 'Be2', 'Be7', 'O-O');
  assert.match(g.attr('history'), /exd6/);
  assert.match(g.attr('history'), /O-O$/);
  assert.match(g.attr('fen'), /RNBQ1RK1 b/);
  // promotion, with a piece asked for and the queen by default
  const p = await game();
  await p.press('chess-new');
  await p.play('a4', 'b5', 'axb5', 'a6', 'bxa6', 'Nf6', 'a7', 'Ng8', 'axb8=N');
  assert.match(p.attr('history'), /axb8=N$/);
  const q = await game();
  await q.press('chess-new');
  await q.play('a4', 'b5', 'axb5', 'a6', 'bxa6', 'Nf6', 'a7', 'Ng8', 'axb8');
  assert.match(q.attr('history'), /axb8=Q$/);
});

test('two knights that can reach a square: the notation says which', async () => {
  const g = await game();
  await g.press('chess-new');
  await g.play('Nf3', 'Nf6', 'Nc3', 'Nc6', 'Nd4');
  await g.play('e5');
  assert.match(g.attr('history'), /Nd4 e5$/);
  const h = await game();
  await h.press('chess-new');
  await h.play('Nf3', 'a6', 'Ng5', 'a5', 'Nc3', 'a4');
  await h.play('Ne4');
  assert.match(h.body().replace(/\n  /g, ' '), /could mean several moves: Nge4, Nce4/);
  assert.equal(h.attr('history'), 'Nf3 a6 Ng5 a5 Nc3 a4');
  await h.play('Nge4');
  assert.match(h.attr('history'), /Nge4$/);
});

test('flip turns the board round and keeps the game', async () => {
  const g = await game();
  await g.press('chess-new');
  await g.play('e4');
  await g.press('chess-flip');
  assert.equal(g.attr('flip'), true);
  assert.match(g.body(), /\| \| h \| g \| f \| e \| d \| c \| b \| a \| \|/);
  assert.match(g.body(), /\| \*\*1\*\* \| ♖/);
  assert.equal(g.attr('history'), 'e4');
});

test('an edited "fen" is a new starting position, and stalemate is a draw', async () => {
  const g = await game();
  await g.press('chess-new');
  const t = g.body().replace(/^fen: .*$/m, 'fen: 7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
  g.ws.set('Chess.md', t);
  await g.play('Qf7-g6');
  assert.match(g.body(), /not a legal move/);
  await g.play('Kg6-h6');
  assert.equal(g.attr('start_fen'), '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
  assert.equal(g.attr('result'), '1/2-1/2');
  assert.match(g.attr('status'), /Stalemate/);
  await g.press('chess-new');
  assert.equal(g.attr('history'), '');
  assert.equal(g.attr('fen'), '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
});

test('the same position three times is a draw', async () => {
  const g = await game();
  await g.press('chess-new');
  await g.play('Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8');
  assert.equal(g.attr('result'), '1/2-1/2');
  assert.match(g.attr('status'), /three times/);
});

test('names of the players are used', async () => {
  const g = await game(PAGE.replace('white: White', 'white: Ada').replace('black: Black', 'black: Ben'));
  await g.press('chess-new');
  assert.equal(g.attr('status'), 'Ada (White) to move');
  await g.play('e4');
  assert.equal(g.attr('status'), 'Ben (Black) to move');
});


// ---------------------------------------------------------------- the plugin that sets the game up
async function installer({ allow }) {
  const world = new World();
  const ws = new FakeWorkspace(world, { 'Notes/Home.md': '---\nkind: note\n---\n# Home\n' });
  const { engine } = await makeEngine(world, ws, PLUGIN);
  const installed = new Map();
  const asked = [];
  engine.host.installAutomations = async (spec) => {
    asked.push(spec);
    const have = installed.get(spec.file);
    if (spec.remove ? have === undefined : have === spec.content) return { changed: false };
    if (!allow) return { denied: true, reason: 'you did not allow it' };
    if (spec.remove) installed.delete(spec.file);
    else installed.set(spec.file, spec.content);
    return { changed: true, created: have === undefined };
  };
  return { world, ws, engine, installed, asked };
}

test('the plugin asks to install the rules, then makes a game page under the current page', async () => {
  const { ws, engine, installed, asked } = await installer({ allow: true });
  const r = await engine.runPlugin('chess-new-game', { path: 'Notes/Home.md', text: '', answers: { name: 'Ada v Ben', white: 'Ada', black: 'Ben' } });
  assert.equal(r.status, 'done', r.detail);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].owner, 'chess');
  assert.equal(asked[0].file, 'chess-game.yaml');
  assert.equal(installed.get('chess-game.yaml'), fs.readFileSync(path.join(HERE, 'chess-game.yaml'), 'utf8'));
  const page = ws.text('Notes/Home/Ada v Ben.md');
  assert.match(page, /kind: chess/);
  assert.match(page, /white: Ada/);
  assert.match(page, /black: Ben/);
  assert.match(page, /\[=Play move\]\(automation:chess-play\)/);
  // a second game: the rules are there already, so nothing is asked again
  const again = await engine.runPlugin('chess-new-game', { path: 'Notes/Home.md', text: '', answers: { name: 'Second', white: 'W', black: 'B' } });
  assert.equal(again.status, 'done', again.detail);
  assert.ok(ws.text('Notes/Home/Second.md'));
});

test('when the person does not allow it, no game is made', async () => {
  const { ws, engine, installed } = await installer({ allow: false });
  const r = await engine.runPlugin('chess-new-game', { path: 'Notes/Home.md', text: '', answers: { name: 'Nope', white: 'W', black: 'B' } });
  assert.equal(r.status, 'failed');
  assert.match(r.detail, /not done: you did not allow it/);
  assert.equal(installed.size, 0);
  assert.equal(ws.has?.('Notes/Home/Nope.md') ?? false, false);
});

test('the other plugin takes the rules away, with the same owner', async () => {
  const { engine, installed, asked } = await installer({ allow: true });
  await engine.runPlugin('chess-new-game', { path: 'Notes/Home.md', text: '', answers: { name: 'G', white: 'W', black: 'B' } });
  const r = await engine.runPlugin('chess-remove', { path: 'Notes/Home.md', text: '', answers: {} });
  assert.equal(r.status, 'done', r.detail);
  assert.equal(installed.size, 0);
  assert.equal(asked.at(-1).remove, true);
  assert.equal(asked.at(-1).owner, 'chess');
});
