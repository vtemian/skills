#!/usr/bin/env bash
# Install these skills for Claude Code. It asks which ones you want, then links
# them into ~/.claude/skills.
#
#   curl -fsSL https://raw.githubusercontent.com/vtemian/skills/main/install.sh | bash
#   ./install.sh                 from a clone of this repo
#
# Run without a clone, it clones the repo to ~/.local/share/vtemian-skills first.
# Run it again to update or to add a skill. It never deletes a real folder, and
# asks before it replaces a link that points somewhere else.
#
#   CLAUDE_SKILLS_DIR      where the links go    (default ~/.claude/skills)
#   VTEMIAN_SKILLS_HOME    where the clone goes  (default ~/.local/share/vtemian-skills)
set -euo pipefail

REPO="https://github.com/vtemian/skills.git"
TARGET="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
CLONE="${VTEMIAN_SKILLS_HOME:-$HOME/.local/share/vtemian-skills}"

# The questions are read from the terminal, not stdin, so `curl | bash` works.
if ! [ -t 1 ] || ! { exec 3</dev/tty; } 2>/dev/null; then
  echo "install.sh asks questions, so it needs a terminal." >&2
  echo "Without one, link a skill yourself: ln -s <clone>/skills/<name> $TARGET/<name>" >&2
  exit 2
fi

# Use the clone this script sits in; without one (curl | bash), make or update one.
SELF="${BASH_SOURCE[0]:-}"
if [ -n "$SELF" ] && [ -d "$(dirname "$SELF")/skills" ]; then
  ROOT="$(cd "$(dirname "$SELF")" && pwd)"
else
  command -v git >/dev/null || { echo "git not found" >&2; exit 2; }
  if [ -d "$CLONE/.git" ]; then
    git -C "$CLONE" pull --quiet --ff-only
  else
    git clone --quiet "$REPO" "$CLONE"
  fi
  ROOT="$CLONE"
fi

# One line about a skill: the first line of text in its README.
about() {
  [ -f "$1/README.md" ] || return 0
  awk 'NF && !/^#/ && !/^!\[/ { print; exit }' "$1/README.md"
}

# What is at ~/.claude/skills/<name> now: new, linked, other (a link elsewhere), folder.
state() {
  local link="$TARGET/$1"
  if [ -L "$link" ] && [ "$(readlink "$link")" = "$ROOT/skills/$1" ]; then
    echo linked
  elif [ -L "$link" ]; then
    echo other
  elif [ -e "$link" ]; then
    echo folder
  else
    echo new
  fi
}

NAMES=()
ABOUT=()
PICKED=()
for dir in "$ROOT"/skills/*/; do
  [ -f "$dir/SKILL.md" ] || continue
  name="$(basename "$dir")"
  NAMES+=("$name")
  ABOUT+=("$(about "$dir")")
  # A skill that is already linked needs nothing, so it starts unpicked.
  if [ "$(state "$name")" = linked ]; then PICKED+=(0); else PICKED+=(1); fi
done
COUNT="${#NAMES[@]}"
[ "$COUNT" -gt 0 ] || { echo "no skills found in $ROOT/skills" >&2; exit 1; }

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; PLAIN=$'\033[0m'

draw() {
  local index mark pointer note
  for ((index = 0; index < COUNT; index++)); do
    if [ "${PICKED[$index]}" -eq 1 ]; then mark="${GREEN}[x]${PLAIN}"; else mark="[ ]"; fi
    if [ "$index" -eq "$AT" ]; then pointer=">"; else pointer=" "; fi
    case "$(state "${NAMES[$index]}")" in
      linked) note=" ${DIM}(installed)${PLAIN}" ;;
      other) note=" ${DIM}(another copy is installed)${PLAIN}" ;;
      folder) note=" ${DIM}(a folder with this name exists)${PLAIN}" ;;
      *) note="" ;;
    esac
    printf '\r\033[K %s %s %s%s%s%s\n' "$pointer" "$mark" "$BOLD" "${NAMES[$index]}" "$PLAIN" "$note"
    printf '\r\033[K       %s%s%s\n' "$DIM" "${ABOUT[$index]}" "$PLAIN"
  done
}

restore() { printf '\033[?25h'; }
trap restore EXIT
trap 'restore; echo; exit 130' INT

echo
echo "${BOLD}Which skills do you want?${PLAIN}"
echo "${DIM}up/down move, space picks, a picks all, enter installs, q quits${PLAIN}"
echo
AT=0
printf '\033[?25l'
draw
while true; do
  IFS= read -rsn1 key <&3 || key=q
  if [ "$key" = $'\033' ]; then
    IFS= read -rsn2 -t 1 rest <&3 || rest=""
    key="$key$rest"
  fi
  case "$key" in
    $'\033[A'|k) AT=$(( (AT + COUNT - 1) % COUNT )) ;;
    $'\033[B'|j) AT=$(( (AT + 1) % COUNT )) ;;
    ' ') PICKED[$AT]=$(( 1 - PICKED[$AT] )) ;;
    a) for ((index = 0; index < COUNT; index++)); do PICKED[$index]=1; done ;;
    '') break ;;
    q|$'\033') restore; echo; echo "Nothing installed."; exit 0 ;;
  esac
  printf '\033[%dA' "$((COUNT * 2))"
  draw
done
restore
echo

mkdir -p "$TARGET"
FAILED=0
DONE=()
for ((index = 0; index < COUNT; index++)); do
  [ "${PICKED[$index]}" -eq 1 ] || continue
  name="${NAMES[$index]}"
  source="$ROOT/skills/$name"
  link="$TARGET/$name"
  case "$(state "$name")" in
    linked)
      echo "ok    $name: already installed"
      DONE+=("/$name") ;;
    new)
      ln -s "$source" "$link"
      echo "ok    $name: linked at $link"
      DONE+=("/$name") ;;
    other)
      printf 'ask   %s: %s points to %s. Replace it? [y/N] ' "$name" "$link" "$(readlink "$link")"
      IFS= read -r answer <&3 || answer=""
      if [ "$answer" = y ] || [ "$answer" = Y ]; then
        ln -sfn "$source" "$link"
        echo "ok    $name: link replaced"
        DONE+=("/$name")
      else
        echo "skip  $name: left as it was"
      fi ;;
    folder)
      echo "skip  $name: $link is a real folder; move it away and run this again"
      FAILED=1 ;;
  esac
done

if [ "${#DONE[@]}" -eq 0 ]; then
  echo "Nothing installed."
  exit "$FAILED"
fi

# The skills install without it; it is needed when a skill runs.
command -v node >/dev/null || echo "need  node: https://nodejs.org"

echo "done  start a new Claude Code session to use: ${DONE[*]}"
exit "$FAILED"
