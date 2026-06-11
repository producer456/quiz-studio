#!/usr/bin/env python3
"""Scan quizzes/*/quiz.json and write quizzes/index.json for the catalog page."""
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
quizzes_dir = root / "quizzes"
entries = []
bad = 0

for quiz_file in sorted(quizzes_dir.glob("*/quiz.json")):
    try:
        quiz = json.loads(quiz_file.read_text())
    except Exception as e:
        print(f"SKIPPING {quiz_file}: {e}", file=sys.stderr)
        bad += 1
        continue
    folder = quiz_file.parent.name
    if quiz.get("id") != folder:
        print(f"SKIPPING {quiz_file}: id '{quiz.get('id')}' != folder '{folder}'", file=sys.stderr)
        bad += 1
        continue
    entries.append({
        "id": quiz["id"],
        "title": quiz.get("title", quiz["id"]),
        "course": quiz.get("course", ""),
        "description": quiz.get("description", ""),
        "created": quiz.get("created", ""),
        "questionCount": len(quiz.get("questions", [])),
        "hasPins": any(q.get("type") == "pin" for q in quiz.get("questions", [])),
    })

entries.sort(key=lambda e: e.get("created", ""), reverse=True)
out = quizzes_dir / "index.json"
out.write_text(json.dumps({"quizzes": entries}, indent=2) + "\n")
print(f"wrote {out} with {len(entries)} quiz(es)" + (f", {bad} skipped (see warnings above)" if bad else ""))
# don't fail the build: publish.sh's validate gate already catches id/folder
# mismatches before we get here, and exiting non-zero under `set -e` would
# abort after index.json was rewritten but before the commit
sys.exit(0)
