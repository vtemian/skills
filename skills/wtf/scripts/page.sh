#!/usr/bin/env bash
# Turn an explanation written in markdown into one page and open it in the browser.
#
#   page.sh <explanation.md>
#
# 1. render.mjs writes <explanation>.html: the text, every ```mermaid block with its
#    numbered notes, the margin notes, one stylesheet (page.css) and Mermaid itself.
#    The page draws its diagrams when it opens.
# 2. the page is opened in WebKit (snap.swift) to see that every diagram draws and
#    every card sits on its own box, and a picture of the whole page is saved.
#    With no swiftc, a headless Chrome checks only that the diagrams draw (drawn.mjs).
# 3. the page opens (set NO_OPEN=1 to only build it)
#
# The page is one file with nothing loaded from the network. All it needs is node.
# Exits 0 when all is well, 1 on a layout finding, 3 when a diagram does not draw
# (the page is then not opened).

set -uo pipefail

HERE="$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")" && pwd)"

if [ $# -ne 1 ] || [ ! -f "$1" ]; then
  echo "usage: page.sh <explanation.md>" >&2
  exit 2
fi
command -v node >/dev/null || { echo "node not found: https://nodejs.org" >&2; exit 2; }

DOC="$1"
PAGE="${DOC%.md}.html"

node "$HERE/render.mjs" "$DOC" "$PAGE" || exit $?
echo "page  $PAGE"

LOOK="${DOC%.md}.png"
SNAP="${XDG_CACHE_HOME:-$HOME/.cache}/wtf/snap"
BAD=0
if [ "$(uname)" = Darwin ] && command -v swiftc >/dev/null; then
  if [ ! -x "$SNAP" ] || [ "$HERE/snap.swift" -nt "$SNAP" ]; then
    mkdir -p "$(dirname "$SNAP")"
    swiftc -O "$HERE/snap.swift" -o "$SNAP" 2> "$SNAP.log" || { echo "warn  the WebKit check did not build: $SNAP.log"; SNAP=""; }
  fi
else
  SNAP=""
fi

if [ -n "$SNAP" ]; then
  rm -f "$LOOK"
  "$SNAP" "$(realpath "$PAGE")" "$(realpath "$(dirname "$LOOK")")/$(basename "$LOOK")"
  BAD=$?
  [ -f "$LOOK" ] && echo "look  $LOOK"
else
  node "$HERE/drawn.mjs" "$PAGE"
  BAD=$?
  [ "$BAD" -ne 4 ] || BAD=0
fi

if [ "$BAD" -eq 3 ]; then
  echo "fix the failing blocks in $DOC and run again" >&2
  exit 3
fi

[ -n "${NO_OPEN:-}" ] || open "$PAGE" 2>/dev/null || true
exit "$BAD"
