# Chess for Cave Notes

A complete game of chess, played in a page, for two players or against the computer. The page holds the position and the moves; button rules (automations) play them, and a plugin sets everything up. It is an example of what pages, attributes, buttons and `run_js` can do together.

## Install

1. Copy `drop-in/.cave-notes/plugins/chess.yaml` into your workspace's `.cave-notes/plugins` folder (make the folder if there is none), or use **Plugins ▸ All plugins… ▸ Add from file…** and pick it. It is the only file you need: it is a plugin with an icon and a description, and it adds the rules of the game itself, after asking you, the first time you use it.
2. In **Preferences ▸ Sync and automation ▸ Automations**, turn on **Let automations run JavaScript** and, to play the computer, **Let automations run shell commands**. The first time you press a button the app shows the script (or the command) and asks you to approve it.
3. **Plugins ▸ New chess game** makes a game page under the page you are on. (Or copy `drop-in/Chess.md` into the workspace, and press **New game** in it.)

The rules it adds are in `.cave-notes/plugins/chess-game.yaml`. **Plugins ▸ Remove chess automations** takes them away again.

## Playing the computer

Chess can be played against a chess engine, a program that thinks about moves. Cave Notes does not contain one: you install one, and the rules ask it for its moves.

1. Install **Stockfish**, the best-known free engine. It is in most distributions (`sudo dnf install stockfish`, `sudo apt install stockfish`, or `brew install stockfish`); on an immutable system such as Silverblue, install it where the app runs, or put the `stockfish` program in a folder on your `PATH`.
2. **Plugins ▸ Check the chess engine** says whether it is found and which version.
3. In the game page, set **engine** to `white`, `black` or `both`, and **level** to a number from 1 to 8. (The *New chess game* plugin asks for both.)
   - `black` (or `white`): the computer plays that side and answers each move you make by itself. You play the other.
   - `both`: the computer plays both sides, one move per press of **Engine move**.
   - `none` (the default): two people play. **Engine move** still asks the computer for one move for the side to move, for a hint or for a first move.
4. The first time, the app shows the command it is about to run and asks you to approve it (it is the file `engine.sh`, copied into the rule; read it if you like).

### The levels

| Level | Stockfish's Skill Level | Thinks for | About |
|---|---|---|---|
| 1 | 0 | 0.05 s | a beginner who often blunders |
| 2 | 3 | 0.1 s | |
| 3 | 6 | 0.2 s | a casual player |
| 4 | 9 | 0.4 s | |
| 5 | 12 | 0.8 s | a club player (the default) |
| 6 | 15 | 1.5 s | |
| 7 | 18 | 3 s | a strong player |
| 8 | 20 | 5 s | full strength: a human cannot win |

For a particular rating, add **elo:** to the page (a number from 1320 to 3190, for example `elo: 1600`). The engine then plays at about that strength and the level only sets how long it thinks. Newer versions of Stockfish are needed for `elo`.

### How it is connected

The rule **Engine move** (and **the engine answers**, which starts by itself when `engine_turn` becomes true) does two things in order: a `run_shell` step that runs `engine.sh`, and the same `run_js` step the other buttons use. The page's position (`fen`), `level` and `elo` reach the script as environment variables, never pasted into the command text. The script talks UCI, the language almost every chess engine speaks: it sends the position and `go movetime …`, reads the engine's `bestmove`, and prints just that move (like `e7e5`, or `e7e8q` for a promotion). The game script reads it from `shell.stdout`, checks that it is a legal move (it says so if not), and plays it like a move you typed.

Two details that cost time to find: the engine must be kept waiting on an open pipe until it has answered (an engine whose input ends stops at once and gives its first idea), and the script reads the engine's lines with the shell, because `awk` may hold its input back.

### Another engine, or a gentler one

Any engine that speaks UCI works: change `engine=stockfish` at the top of the command in `chess-game.yaml` (and in `engine.sh`, and in the check plugin) to its name, or its path. The app asks you to approve the changed command again. Two good ones:

- **Fairy-Stockfish**: the same, and it can play chess variants.
- **Lc0** with a **Maia** network: an engine made to play like a human of a given rating (`engine=lc0` with `--weights` in the command), the most natural opponent for a player who is learning. It needs more setup than Stockfish.

On a computer that syncs the page with another, the rule runs on **one** of them (`runs: once`), so the engine is not asked twice. The computer that runs it needs the engine.

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
- Scripts and the engine run on a computer; the Android app cannot run JavaScript rules or shell commands, so chess does not run there.
- The computer opponent needs an engine installed (see above). It plays from the position only, so it does not avoid a draw by repetition on purpose.
- Fivefold and seventy-five-move rules are not separate: three repetitions and a hundred half-moves end the game.

## Files

| File | What |
|---|---|
| `lib.js` | the rules of chess (moves, check, castling, en passant, promotion, notation, game end) |
| `main.js` | what one button press does and how the page is drawn (including playing the engine's move) |
| `engine.sh` | asks a UCI engine (Stockfish) for a move, at the level the page says |
| `build.py` | puts them together into `chess-game.yaml` and `chess.yaml`, and the `drop-in` folder (`python3 build.py`) |
| `chess.test.js` | plays games through the real automation engine (`node --test chess.test.js`); with Stockfish on the `PATH` it also plays real engine moves |
| `perft.mjs` | counts every possible line to a given depth from six known positions and checks the totals (`node perft.mjs`) |
