#!/usr/bin/env bash
# Validate every quiz, rebuild the catalog index, commit, and push to GitHub Pages.
#   tools/publish.sh ["commit message"]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MSG="${1:-update quizzes}"

echo "==> validating all quizzes..."
FAIL=0
for q in quizzes/*/quiz.json; do
  [ -e "$q" ] || continue
  if ! python3 tools/validate.py "$q" --quiz-dir "$(dirname "$q")" >/dev/null 2>&1; then
    echo "--- $q ---"
    python3 tools/validate.py "$q" --quiz-dir "$(dirname "$q")" || true
    FAIL=1
  fi
done
[ $FAIL -eq 0 ] || { echo "fix the problems above, then re-run" >&2; exit 1; }

echo "==> rebuilding quizzes/index.json..."
python3 tools/build_index.py

git add -A
if git diff --cached --quiet; then
  echo "nothing new to publish"
  exit 0
fi
git commit -m "$MSG"
git push origin main
echo ""
echo "✓ pushed — live in ~1 min at https://producer456.github.io/quiz-studio/"
