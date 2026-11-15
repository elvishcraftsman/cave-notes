# Asks a UCI chess engine for a move and prints it (like e7e5, or e7e8q for a promotion). Used by the "Engine move" rules.
#
# It reads, from the environment:  CN_FEN    the position
#                                  CN_LEVEL  1 to 8 (default 5): how strongly the engine plays
#                                  CN_ELO    optional: a rating (1320 to 3190) to play at instead of the level
# Stockfish is the engine named below. Any engine that speaks UCI (Fairy-Stockfish, Lc0 with a Maia network, ...) can take its
# place: change the first line (this is a command the app asked you to approve, so it asks again when you change it).
engine=stockfish
command -v "$engine" >/dev/null 2>&1 || { echo "The chess engine \"$engine\" is not installed (or not on the PATH)." >&2; exit 127; }

fen=$(printf '%s' "$CN_FEN" | tr -d '\r\n')
[ -n "$fen" ] || { echo "There is no position to play from." >&2; exit 2; }

# the level: how strongly the engine plays (Stockfish's "Skill Level", 0 to 20) and how long it may think (milliseconds)
case "${CN_LEVEL:-5}" in
  1) skill=0;  ms=50 ;;
  2) skill=3;  ms=100 ;;
  3) skill=6;  ms=200 ;;
  4) skill=9;  ms=400 ;;
  6) skill=15; ms=1500 ;;
  7) skill=18; ms=3000 ;;
  8) skill=20; ms=5000 ;;
  *) skill=12; ms=800 ;;
esac
case "$CN_ELO" in '' | *[!0-9]*) elo= ;; *) elo=$CN_ELO ;; esac

work=$(mktemp -d) || exit 1
trap 'rm -rf "$work"' EXIT
mkfifo "$work/in"

# The engine reads its orders from a pipe that stays open until it has answered (an engine told "go" and then left alone quits
# at once, and gives a poor move). The first "bestmove" it prints is kept.
# (A shell loop reads the engine's lines as they come; some versions of awk wait for more before they look at any.)
{
  "$engine" < "$work/in" 2>/dev/null | while IFS= read -r line; do
    case "$line" in
      "bestmove "*)
        set -- $line
        printf '%s\n' "$2" > "$work/out"
        break
        ;;
    esac
  done
} &
reader=$!
{
  printf 'uci\nsetoption name Skill Level value %s\n' "$skill"
  [ -n "$elo" ] && printf 'setoption name UCI_LimitStrength value true\nsetoption name UCI_Elo value %s\n' "$elo"
  printf 'isready\nposition fen %s\ngo movetime %s\n' "$fen" "$ms"
  waited=0
  limit=$((ms / 100 + 100))
  while [ ! -s "$work/out" ] && [ "$waited" -lt "$limit" ]; do
    sleep 0.1
    waited=$((waited + 1))
  done
  printf 'quit\n'
} > "$work/in"
wait "$reader" 2>/dev/null
move=$(cat "$work/out")
case "$move" in [a-h][1-8][a-h][1-8] | [a-h][1-8][a-h][1-8][qrbn]) printf '%s\n' "$move" ;; *) echo "The engine did not give a move (it said: ${move:-nothing})." >&2; exit 3 ;; esac
