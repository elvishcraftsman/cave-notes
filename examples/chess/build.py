"""Builds the two files of the chess example from lib.js, main.js and Chess.md:

  chess-game.yaml  the six rules of the game (what the plugin installs)
  chess.yaml       the plugin file: "New chess game" and "Remove chess automations". This is the only file a person puts in .cave-notes.
"""
lib = open('lib.js').read().rstrip() + '\n'
main = open('main.js').read()
code = lib + '\n' + main
page = open('Chess.md').read().rstrip() + '\n'


def ind(s, n):
    return ''.join((' ' * n + l if l.strip() else l) for l in s.splitlines(True))


RULES = [
    ('chess-play', 'play', 'Play a move', {
        'board': ('info', '${this.status}'),
        'last': ('info', '${this.message}'),
        'move': ('text', 'Your move (like e4, Nf3, O-O or e7e8=Q)'),
    }),
    ('chess-new', 'new', 'New game', {'sure': ('info', 'Start a new game? The moves played so far are erased.')}),
    ('chess-undo', 'undo', 'Take back the last move', {}),
    ('chess-flip', 'flip', 'Flip the board', {}),
    ('chess-resign', 'resign', 'Resign', {'sure': ('info', 'Does the player to move (${this.turn}) resign?')}),
    ('chess-draw', 'draw', 'Draw', {'sure': ('info', 'Do both players agree to a draw?')}),
]

game = ['# The six rules of the chess game. Installed by the "New chess game" plugin (chess.yaml); delete this file to take them away.', 'rules:']
for i, (rid, cmd, name, ask) in enumerate(RULES):
    game += [f'  - id: {rid}', f'    name: "Chess: {name}"', '    where: kind:chess', '    on: button', '    runs: everywhere', f'    let: {{ cmd: "{cmd}" }}']
    if ask:
        game.append('    ask:')
        for k, (typ, label) in ask.items():
            game.append(f'      {k}: {{ type: {typ}, label: "{label}" }}')
    if i == 0:
        game += ['    do: &chess', '      - run_js:', '          timeout: 5000', '          code: |', ind(code, 12).rstrip('\n')]
    else:
        game.append('    do: *chess')
game_text = '\n'.join(game) + '\n'
open('chess-game.yaml', 'w').write(game_text)

plugin = f'''# Chess for Cave Notes: the plugin (the only file to put in .cave-notes).
# "New chess game" (Plugins menu) adds the rules of the game the first time it is used, after asking you, and then makes a
# game page under the page you are on. "Remove chess automations" takes the rules away again. See README.md.
rules:
  - id: chess-new-game
    name: New chess game
    on: {{ plugin: "New chess game" }}
    ask:
      name:  {{ type: text, label: "Name of the game", default: "Chess game" }}
      white: {{ type: text, label: "White", default: "White" }}
      black: {{ type: text, label: "Black", default: "Black" }}
    do:
      - install_automations:
          file: chess-game.yaml
          owner: chess
          content: |
{ind(game_text, 12).rstrip(chr(10))}
      - create_page:
          name: "${{ask.name}}"
          in: "${{this.path}}"
          properties: {{ white: "${{ask.white}}", black: "${{ask.black}}" }}
          content: |
{ind(page, 12).rstrip(chr(10))}

  - id: chess-remove
    name: Remove chess automations
    on: {{ plugin: "Remove chess automations" }}
    ask:
      sure: {{ type: info, label: "Take away the rules of the chess game? The game pages stay, but their buttons stop working until the rules are put back (by New chess game)." }}
    do:
      - install_automations:
          file: chess-game.yaml
          owner: chess
          remove: true
'''
open('chess.yaml', 'w').write(plugin)
print(len(code.splitlines()), 'lines of code')
