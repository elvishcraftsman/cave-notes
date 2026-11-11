import fs from 'node:fs';
const lib = fs.readFileSync('lib.js', 'utf8');
const E = new Function(lib + '\nreturn { parseFen, toFen, legalMoves, makeMove, START, sanOf, findMoves, replay, ending };')();
const perft = (s, d) => { const ms = E.legalMoves(s); if (d === 1) return ms.length; let n = 0; for (const m of ms) n += perft(E.makeMove(s, m), d - 1); return n; };
const cases = [
  ['start', E.START, [20, 400, 8902, 197281]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['pos3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['pos4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['pos5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
  ['pos6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]],
];
let bad = 0;
for (const [name, fen, want] of cases) {
  const s = E.parseFen(fen);
  want.forEach((w, i) => { const got = perft(s, i + 1); if (got !== w) { bad++; console.log('FAIL', name, 'depth', i + 1, got, 'want', w); } else console.log('ok', name, i + 1, got); });
}
console.log(bad ? 'FAILED' : 'ALL PERFT OK');
