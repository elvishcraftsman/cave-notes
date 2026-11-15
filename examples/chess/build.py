"""Builds the two files of the chess example from lib.js, main.js, engine.sh and Chess.md:

  chess-game.yaml  the rules of the game (what the plugin installs): the six buttons, the engine's move and its automatic answer
  chess.yaml       the plugin file: "New chess game", "Check the chess engine" and "Remove chess automations". This is the only file
                   a person puts in .cave-notes/plugins (the folder is made for it, if there is none).
"""
lib = open('lib.js').read().rstrip() + '\n'
main = open('main.js').read()
code = lib + '\n' + main
page = open('Chess.md').read().rstrip() + '\n'
engine_sh = open('engine.sh').read().rstrip() + '\n'


def ind(s, n):
    return ''.join((' ' * n + l if l.strip() else l) for l in s.splitlines(True))


RULES = [
    ('chess-play', 'play', 'Play a move', {
        'board': ('info', '${this.status}'),
        'last': ('info', '${this.message}'),
        'move': ('text', 'Your move (like e4, Nf3, O-O or e7e8=Q)'),
    }),
    ('chess-engine', 'engine', 'Engine move', {}),
    ('chess-new', 'new', 'New game', {'sure': ('info', 'Start a new game? The moves played so far are erased.')}),
    ('chess-undo', 'undo', 'Take back the last move', {}),
    ('chess-flip', 'flip', 'Flip the board', {}),
    ('chess-resign', 'resign', 'Resign', {'sure': ('info', 'Does the player to move (${this.turn}) resign?')}),
    ('chess-draw', 'draw', 'Draw', {'sure': ('info', 'Do both players agree to a draw?')}),
]

ENV = '          env: { CN_FEN: "${this.fen}", CN_LEVEL: "${this.level}", CN_ELO: "${this.elo}" }'


def shell_action(first):
    """The step that asks the engine for a move (engine.sh): its answer is the output of the command, for the script after it."""
    lines = ['      - &chessshell' if first else '      - *chessshell']
    if first:
        lines[0] = '      - &chessshell'
        lines += ['        run_shell:', '          timeout: 90s', ENV, '          # a failure is handled here, so the next step still runs and tells the player (the engine may not be installed)', '          on_failure: { log: "The chess engine did not answer (${shell.code}): ${shell.stderr}" }', '          command: |', ind(engine_sh, 12).rstrip('\n')]
    return lines


game = ['# The rules of the chess game. Installed by the "New chess game" plugin (chess.yaml); delete this file to take them away.', 'rules:']
for i, (rid, cmd, name, ask) in enumerate(RULES):
    game += [f'  - id: {rid}', f'    name: "Chess: {name}"', '    icon: chess-knight', '    where: kind:chess', '    on: button', '    runs: everywhere', f'    let: {{ cmd: "{cmd}" }}']
    if ask:
        game.append('    ask:')
        for k, (typ, label) in ask.items():
            game.append(f'      {k}: {{ type: {typ}, label: "{label}" }}')
    if i == 0:
        game += ['    do:', '      - &chessjs', '        run_js:', '          timeout: 5000', '          code: |', ind(code, 14).rstrip('\n')]
    elif cmd == 'engine':
        game += ['    do:'] + shell_action(True) + ['      - *chessjs']
    else:
        game += ['    do:', '      - *chessjs']
# the engine answers by itself when it plays the side that is to move (the script sets engine_turn). It starts on the change of
# that property, not on a match: a match is remembered for ten minutes, so a quick game would be answered only once in a while.
game += [
    '  - id: chess-engine-reply',
    '    name: "Chess: the engine answers"',
    '    where: kind:chess',
    '    on: { change: engine_turn, to: true }',
    '    runs: once',
    '    let: { cmd: "engine" }',
    '    do:',
    '      - *chessshell',
    '      - *chessjs',
]
game_text = '\n'.join(game) + '\n'
open('chess-game.yaml', 'w').write(game_text)

plugin = f'''# Chess for Cave Notes: the plugin (the only file to put in .cave-notes/plugins).
# \"New chess game\" (Plugins menu) adds the rules of the game the first time it is used, after asking you, and then makes a
# game page under the page you are on. \"Check the chess engine\" says whether a computer opponent is installed. \"Remove chess
# automations\" takes the rules away again. See README.md.
rules:
  - id: chess-new-game
    name: New chess game
    icon: chess-knight
    description: |
      Starts a game of chess in a page under the page you are on: a board you can see, the moves in standard notation, and buttons
      to play a move, take one back, flip the board, resign or agree a draw.

      Play a friend by taking turns at the keys, or play the computer: choose which side it plays and how strong it is (1 gentle, 8 full strength).
      The computer is a chess engine you install yourself (Stockfish); \"Check the chess engine\" says whether it is found.

      The first time, the rules of the game are added to this workspace's plugins folder, after asking you. Chess needs a computer, not a phone.
    on: {{ plugin: \"New chess game\" }}
    ask:
      name:  {{ type: text, label: \"Name of the game\", default: \"Chess game\" }}
      white: {{ type: text, label: \"White\", default: \"White\" }}
      black: {{ type: text, label: \"Black\", default: \"Black\" }}
      engine: {{ type: select, label: \"The computer plays\", options: [none, white, black, both], default: none }}
      level: {{ type: select, label: \"Its level (1 gentle, 8 full strength)\", options: [\"1\", \"2\", \"3\", \"4\", \"5\", \"6\", \"7\", \"8\"], default: \"5\" }}
    do:
      - install_automations:
          file: chess-game.yaml
          owner: chess
          content: |
{ind(game_text, 12).rstrip(chr(10))}
      - create_page:
          name: \"${{ask.name}}\"
          in: \"${{this.path}}\"
          properties: {{ white: \"${{ask.white}}\", black: \"${{ask.black}}\", engine: \"${{ask.engine}}\", level: \"${{ask.level}}\" }}
          content: |
{ind(page, 12).rstrip(chr(10))}

  - id: chess-engine-check
    name: Check the chess engine
    icon: cpu
    description: |
      Looks for the chess engine (Stockfish) on this computer and says what it found.

      The games use it for the computer's moves. Install it with your package manager (for example `sudo dnf install stockfish`, or `sudo apt install stockfish`); any engine that speaks UCI can be used by changing the engine's name in the rules.
    runs: everywhere
    on: {{ plugin: \"Check the chess engine\" }}
    do:
      - run_shell:
          timeout: 20s
          command: |
            engine=stockfish
            command -v \"$engine\" >/dev/null 2>&1 || {{ echo \"$engine is not installed (or not on the PATH)\" >&2; exit 127; }}
            printf 'uci\\nquit\\n' | \"$engine\" | while IFS= read -r line; do case \"$line\" in \"id name \"*) printf '%s\\n' \"${{line#id name }}\"; break ;; esac; done
          on_success: {{ notify: \"Chess engine found: ${{shell.stdout}}\" }}
          on_failure: {{ notify: \"No chess engine: ${{shell.stderr}}\" }}

  - id: chess-remove
    name: Remove chess automations
    icon: eraser
    description: Takes away the rules of the chess game. The game pages stay, but their buttons stop working until the rules are put back (by New chess game).
    on: {{ plugin: \"Remove chess automations\" }}
    ask:
      sure: {{ type: info, label: \"Take away the rules of the chess game? The game pages stay, but their buttons stop working until the rules are put back (by New chess game).\" }}
    do:
      - install_automations:
          file: chess-game.yaml
          owner: chess
          remove: true
'''
open('chess.yaml', 'w').write(plugin)
print(len(code.splitlines()), 'lines of code')

# the files to copy into a workspace: the plugin goes in .cave-notes/plugins, and a starting page beside your notes
import os, shutil
os.makedirs('drop-in/.cave-notes/plugins', exist_ok=True)
shutil.copyfile('chess.yaml', 'drop-in/.cave-notes/plugins/chess.yaml')
if os.path.exists('drop-in/.cave-notes/chess.yaml'):
    os.remove('drop-in/.cave-notes/chess.yaml')  # where an earlier version put it
shutil.copyfile('Chess.md', 'drop-in/Chess.md')
