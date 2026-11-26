#!/usr/bin/env bash
# Turn an explanation written in markdown into one page and open it in the browser.
#
#   page.sh <explanation.md>
#
# 1. check-diagrams.sh draws every ```mermaid block (exit 1 when one does not draw)
# 2. render.mjs writes <explanation>.html: the text, the drawn diagrams with their
#    numbered notes, and the margin notes, all in one stylesheet (page.css)
# 3. the page opens (set NO_OPEN=1 to only build it)
#
# The page is one file with nothing loaded from the network.

set -uo pipefail

HERE="$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")" && pwd)"

if [ $# -ne 1 ] || [ ! -f "$1" ]; then
  echo "usage: page.sh <explanation.md>" >&2
  exit 2
fi

DOC="$1"
PAGE="${DOC%.md}.html"

"$HERE/check-diagrams.sh" "$DOC" || exit $?

MMDC_REAL="$(realpath "$(command -v mmdc)")"
node "$HERE/render.mjs" "$DOC" "${DOC%.md}.diagrams" "$PAGE" "$MMDC_REAL" || exit $?

echo "page  $PAGE"

# Look at the page the way the reader will: draw it in WebKit, check that every card sits
# on its own box, and save a picture of the whole page for the author to read.
LOOK="${DOC%.md}.png"
SNAP="${XDG_CACHE_HOME:-$HOME/.cache}/wtf/snap"
BAD=0
if command -v swiftc >/dev/null; then
  if [ ! -x "$SNAP" ] || [ "$HERE/snap.swift" -nt "$SNAP" ]; then
    mkdir -p "$(dirname "$SNAP")"
    swiftc -O "$HERE/snap.swift" -o "$SNAP" 2> "$SNAP.log" || { echo "warn  the WebKit check did not build: $SNAP.log"; SNAP=""; }
  fi
  if [ -n "$SNAP" ]; then
    rm -f "$LOOK"
    "$SNAP" "$(realpath "$PAGE")" "$(realpath "$(dirname "$LOOK")")/$(basename "$LOOK")" | sed 's/^/look  /' || true
    [ "${PIPESTATUS[0]}" -eq 0 ] || BAD=1
    [ -f "$LOOK" ] && echo "look  $LOOK"
  fi
else
  echo "warn  no swiftc: the page was not checked in WebKit; look at it in a browser yourself"
fi

[ -n "${NO_OPEN:-}" ] || open "$PAGE" 2>/dev/null || true
exit "$BAD"
