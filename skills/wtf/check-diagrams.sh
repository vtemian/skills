#!/usr/bin/env bash
# Parse every ```mermaid block in a markdown file with the real mermaid parser,
# so a diagram that will not draw is caught before the person sees it.
#
#   check-diagrams.sh <explanation.md>
#
# Diagrams are written to <explanation>.diagrams/ beside the file as NN.mmd and NN.svg,
# drawn with the page's colours (mermaid.json). page.sh builds the page from them.
# Exit 0 when every block draws, 1 when any does not (the parser's message is printed).
#
# What it cannot check is whether a diagram is TRUE or readable. That is yours.

set -uo pipefail

HERE="$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")" && pwd)"

if [ $# -ne 1 ]; then
  echo "usage: check-diagrams.sh <explanation.md>" >&2
  exit 2
fi

DOC="$1"
[ -f "$DOC" ] || { echo "no such file: $DOC" >&2; exit 2; }
command -v mmdc >/dev/null || { echo "mmdc not found: npm i -g @mermaid-js/mermaid-cli" >&2; exit 2; }

OUT="${DOC%.md}.diagrams"
rm -rf "$OUT"
mkdir -p "$OUT"

awk -v out="$OUT" '
  /^```mermaid *$/  { inside = 1; n++; file = sprintf("%s/%02d.mmd", out, n); next }
  /^``` *$/         { if (inside) { inside = 0; close(file) } ; next }
  inside            { print > file }
' "$DOC"

COUNT=$(find "$OUT" -name '*.mmd' | wc -l | tr -d ' ')
if [ "$COUNT" -eq 0 ]; then
  echo "no mermaid blocks in $DOC"
  exit 0
fi

# mmdc draws in a browser. Use its own if it has one, else one already on the machine.
PUPPETEER=()
if ! ls "$HOME"/.cache/puppeteer/*/ >/dev/null 2>&1; then
  for BROWSER in "${PUPPETEER_EXECUTABLE_PATH:-}" \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
    "$(command -v google-chrome chromium chromium-browser 2>/dev/null | head -1)"; do
    if [ -n "$BROWSER" ] && [ -x "$BROWSER" ]; then
      printf '{"executablePath": "%s", "args": ["--no-sandbox"]}\n' "$BROWSER" > "$OUT/puppeteer.json"
      PUPPETEER=(-p "$OUT/puppeteer.json")
      break
    fi
  done
  if [ ${#PUPPETEER[@]} -eq 0 ]; then
    echo "mmdc has no browser: npx puppeteer browsers install chrome-headless-shell" >&2
    exit 2
  fi
fi

# A flowchart is drawn from NN.cards.mmd (cards.mjs); when that fails the plain NN.mmd is
# drawn too, so the message printed is about the text the author wrote.
draw() {
  local MMD="$1" N
  N=$(basename "$MMD" .mmd)
  node "$HERE/cards.mjs" "$MMD" "$OUT/$N.cards.mmd" "$OUT/$N.json" 2> "$OUT/$N.log" || return
  if render "$OUT/$N.cards.mmd" "$OUT/$N.svg" "$N" > "$OUT/$N.log" 2>&1 && [ -s "$OUT/$N.svg" ]; then
    rm -f "$OUT/$N.log"
  else
    render "$MMD" "$OUT/$N.plain.svg" "$N" > "$OUT/$N.log" 2>&1 || true
    [ -s "$OUT/$N.log" ] || echo "the diagram draws as plain Mermaid but not as cards" > "$OUT/$N.log"
  fi
}

render() {
  mmdc -q ${PUPPETEER[@]+"${PUPPETEER[@]}"} -c "$HERE/mermaid.json" -i "$1" -o "$2" -I "diagram-$3" -b transparent
}

for MMD in "$OUT"/[0-9][0-9].mmd; do draw "$MMD" & done
wait

FAILED=0
for MMD in "$OUT"/[0-9][0-9].mmd; do
  N=$(basename "$MMD" .mmd)
  if [ -f "$OUT/$N.log" ]; then
    FAILED=1
    echo "FAIL  $N  $(head -1 "$MMD")"
    grep -vE '^[[:space:]]*at |mermaid-cli-intercept|^$' "$OUT/$N.log" | head -8 | sed 's/^/      /'
  else
    echo "ok    $N  $(head -1 "$MMD")"
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo "fix the failing blocks in $DOC and run again" >&2
  exit 1
fi
