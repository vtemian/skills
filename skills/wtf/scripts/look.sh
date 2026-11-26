#!/bin/bash
# First look at a project for the wtf skill: tree, docs, history.
# Usage: look.sh [project dir]. Read only. Always exits 0: a missing
# file or a non-git folder is a fact to report, not a failure.
cd "${1:-.}" 2>/dev/null || { echo "no such directory: $1"; exit 0; }

echo "== files"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git ls-files | head -200
  echo "== untracked"
  git ls-files --others --exclude-standard | head -40
else
  find . -maxdepth 3 -type f -not -path '*/node_modules/*' -not -path '*/.*' | head -200
fi

echo "== docs"
find . -maxdepth 3 -type f \( -name 'CLAUDE.md' \
  -o -iname 'README*' -o -iname 'NOTES*.md' \) \
  -not -path '*/node_modules/*' -not -path '*/.git/*' -exec wc -l {} + 2>/dev/null

echo "== recent commits"
git log --oneline -15 2>/dev/null || echo "(not a git repository)"
exit 0
