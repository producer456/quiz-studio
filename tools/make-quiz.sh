#!/usr/bin/env bash
# Generate a quiz from PDF lecture slides / textbook chapters.
#
#   tools/make-quiz.sh <quiz-id> "<title>" [-n COUNT] [-c "Course"] <pdf> [pdf...]
#
# What it does:
#   1. extracts images from the PDFs into quizzes/<id>/images/ (pin-question candidates)
#   2. runs Claude headless with the schema + question-writing rules to produce
#      ~COUNT multiple-choice questions from the PDFs' content
#   3. validates the result; on failure sends the errors back to Claude once for repair
#   4. drops quizzes/<id>/quiz.json ready for tools/publish.sh
#
# Pin questions are authored afterwards in the site's teacher mode (#/author),
# which offers the extracted images.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COUNT=150
COURSE="BIO 40A"

usage() { sed -n '2,16p' "$0"; exit 1; }

[ $# -ge 3 ] || usage
QUIZ_ID="$1"; TITLE="$2"; shift 2

while [ $# -gt 0 ]; do
  case "$1" in
    -n) COUNT="$2"; shift 2 ;;
    -c) COURSE="$2"; shift 2 ;;
    *) break ;;
  esac
done

PDFS=("$@")
[ ${#PDFS[@]} -ge 1 ] || usage
for p in "${PDFS[@]}"; do
  [ -f "$p" ] || { echo "no such file: $p" >&2; exit 1; }
done
[[ "$QUIZ_ID" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "quiz id must be lowercase-with-hyphens" >&2; exit 1; }

QUIZ_DIR="$ROOT/quizzes/$QUIZ_ID"
[ -e "$QUIZ_DIR/quiz.json" ] && { echo "$QUIZ_DIR/quiz.json already exists — pick a new id or delete it first" >&2; exit 1; }
mkdir -p "$QUIZ_DIR/images"

# --- 1. extract candidate images for pin questions -------------------------
echo "==> extracting images from ${#PDFS[@]} PDF(s)..."
i=0
for p in "${PDFS[@]}"; do
  i=$((i + 1))
  pdfimages -png -j "$p" "$QUIZ_DIR/images/src${i}" 2>/dev/null || true
done
# drop tiny extractions (icons, bullets, rules)
find "$QUIZ_DIR/images" -type f -size -20k -delete 2>/dev/null || true
IMG_COUNT=$(find "$QUIZ_DIR/images" -type f | wc -l | tr -d ' ')
echo "    kept $IMG_COUNT image(s) in quizzes/$QUIZ_ID/images/ (pin candidates for teacher mode)"

# --- 2. generate questions with Claude --------------------------------------
ABS_PDFS=""
for p in "${PDFS[@]}"; do
  ABS_PDFS+="  - $(cd "$(dirname "$p")" && pwd)/$(basename "$p")"$'\n'
done

TODAY=$(date +%Y-%m-%d)
PROMPT="You are generating a study quiz for an anatomy & physiology student.

Read these PDFs (lecture slides / textbook chapters):
$ABS_PDFS
Write approximately $COUNT multiple-choice questions covering their content,
following every rule in $ROOT/tools/question-rules.md (read it first).

Output: a single JSON object conforming to the schema at $ROOT/tools/schema.json, with:
- id: \"$QUIZ_ID\"
- title: \"$TITLE\"
- course: \"$COURSE\"
- description: one sentence saying what the quiz covers
- created: \"$TODAY\"
- optionCount: 5
- questions: the generated questions, each type \"mc\" with exactly 5 options,
  a correctIndex, a topic, and an explanation. Use ids q001, q002, ...

Print ONLY the JSON object — no markdown fences, no commentary."

OUT="$QUIZ_DIR/quiz.json"
echo "==> asking Claude for ~$COUNT questions (this takes a few minutes)..."
claude -p "$PROMPT" --output-format text > "$OUT"

# strip accidental code fences if any slipped through
python3 - "$OUT" <<'PYEOF'
import re, sys
from pathlib import Path
p = Path(sys.argv[1]); t = p.read_text().strip()
m = re.search(r'\{.*\}', t, re.S)
if m and m.group(0) != t:
    p.write_text(m.group(0) + "\n")
PYEOF

# --- 3. validate, one repair round if needed --------------------------------
echo "==> validating..."
if ! ERRORS=$(python3 "$ROOT/tools/validate.py" "$OUT" --quiz-dir "$QUIZ_DIR" 2>&1); then
  echo "$ERRORS"
  echo "==> asking Claude to repair..."
  claude -p "This quiz JSON file has validation problems. Fix the file in place: $OUT

Problems:
$ERRORS

Schema: $ROOT/tools/schema.json. Rules: $ROOT/tools/question-rules.md.
Keep all valid questions as they are; only fix the problems." \
    --permission-mode acceptEdits --allowedTools "Read,Edit,Write" >/dev/null
  python3 "$ROOT/tools/validate.py" "$OUT" --quiz-dir "$QUIZ_DIR"
fi

# record extracted images as pin-editor candidates
python3 - "$OUT" "$QUIZ_DIR" <<'PYEOF'
import json, sys
from pathlib import Path
out, qdir = Path(sys.argv[1]), Path(sys.argv[2])
quiz = json.loads(out.read_text())
imgs = sorted(f"images/{f.name}" for f in (qdir / "images").iterdir() if f.is_file())
if imgs:
    quiz["imageCandidates"] = imgs
    out.write_text(json.dumps(quiz, indent=2) + "\n")
    print(f"    listed {len(imgs)} image candidate(s) for the pin editor")
PYEOF

N=$(python3 -c "import json;print(len(json.load(open('$OUT'))['questions']))")
echo ""
echo "✓ quizzes/$QUIZ_ID/quiz.json — $N questions"
echo "  preview locally:  python3 -m http.server -d $ROOT 8000   →  http://localhost:8000/#/quiz/$QUIZ_ID"
echo "  add pin questions: open #/author, edit '$TITLE'"
echo "  publish:           tools/publish.sh \"add $QUIZ_ID\""
