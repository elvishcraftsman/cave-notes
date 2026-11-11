# Chess for Cave Notes

A complete game of chess for two players, played in a page. The page holds the position and the moves; six button rules (automations) play them. It is an example of what pages, attributes, buttons and `run_js` can do together.

## Install

1. Copy `drop-in/.cave-notes/chess.yaml` into your workspace's `.cave-notes` folder (any YAML file there is read as automations), and `drop-in/Chess.md` into the workspace.
2. In **Preferences ▸ Automations**, turn on **Let automations run JavaScript**. The first time you press a button the app shows the script and asks; choose *Always allow this script* (all six buttons share the one script).
3. Open `Chess.md` and press **New game**.

## Play

- The player to move types the move into the **move** attribute at the top of the page: `e4`, `Nf3`, `exd5`, `O-O`, `O-O-O`, `e8=Q` (standard notation), or squares: `e2e4`, `e7e8q`. Capitals for pieces: `Nf3`, not `nf3`.
- Press **Play move**. The board is redrawn (White at the bottom; **Flip board** turns it), the last move is in bold, and the move list, captured pieces and material are updated.
- A move that is not legal is explained, with the moves that are. A move that could be two pieces says so (`Nge4` or `Nce4`).
- **Take back** undoes one move at a time (also after checkmate or a resignation). **Resign**, **Draw** (agreed) and **New game** ask to be pressed twice when a game is going on, so a slip does not end it.
- Checkmate, stalemate, a position that came up three times, fifty moves without a capture or pawn move, and too few pieces to mate all end the game by themselves; the page shows the result (`result: 1-0`) and who `winner` is.
- Everything is ordinary attributes: `fen`, `turn`, `status`, `history`, `check`, `ply`, `last`, `winner`. A view can list every game (`kind:chess`) with its status and winner.
- Give the players names with `white:` and `black:`.
- Several games: copy `Chess.md` to another name; the rules work on every page with `kind: chess`.
- Set up a position: edit **fen** to any position (a "FEN" string) and press any button; the game starts from it, and **New game** returns to it. Remove `start_fen` to go back to the usual start.
- Write what you like under `## Notes`; the rest of the page below the title is redrawn at every move.

## How it works

The position is the move list (`history`, in standard notation) played from the start (or from `start_fen`), so every position of the game, and with it the repetition rule and Take back, comes from replaying it. `fen` is written for you to read and to query. The six rules are the same script (a YAML anchor) with a different `let: { cmd: … }`, which is how the script knows which button was pressed (buttons cannot carry values).

## Limits

- The two players take turns at the keys: nothing hides one player's thinking from the other, and there is no clock.
- Clicking a square is not possible in a page; moves are typed.
- Scripts run on a computer; I have not tried it on the phone.
- Fivefold and seventy-five-move rules are not separate: three repetitions and a hundred half-moves end the game.

## Files

| File | What |
|---|---|
| `lib.js` | the rules of chess (moves, check, castling, en passant, promotion, notation, game end) |
| `main.js` | what one button press does and how the page is drawn |
| `build.py` | puts them together into `chess.yaml` (`python3 build.py`) |
| `chess.test.js` | plays games through the real automation engine (`node --test chess.test.js`) |
| `perft.mjs` | counts every possible line to a given depth from six known positions and checks the totals (`node perft.mjs`) |
