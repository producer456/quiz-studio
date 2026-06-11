#!/usr/bin/env python3
"""Validate a quiz.json against the rules the player engine relies on.
Usage: validate.py <quiz.json> [--quiz-dir DIR]
Exits 0 if valid; prints each problem and exits 1 otherwise."""
import json
import re
import sys
from pathlib import Path


def validate(path, quiz_dir=None):
    problems = []
    try:
        quiz = json.loads(Path(path).read_text())
    except Exception as e:
        return [f"not valid JSON: {e}"]

    for field in ("id", "title", "questions"):
        if field not in quiz:
            problems.append(f"missing top-level '{field}'")
    if problems:
        return problems

    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", quiz["id"]):
        problems.append(f"id '{quiz['id']}' must be lowercase letters/digits/hyphens")

    opt_count = quiz.get("optionCount", 5)
    if not isinstance(opt_count, int) or not 2 <= opt_count <= 8:
        problems.append(f"optionCount {opt_count} out of range 2-8")

    ids = set()
    pin_answers = sum(1 for q in quiz["questions"] if q.get("type") == "pin")
    for i, q in enumerate(quiz["questions"]):
        where = f"questions[{i}] (id={q.get('id', '?')})"
        qid = q.get("id")
        if not qid:
            problems.append(f"{where}: missing id")
        elif qid in ids:
            problems.append(f"{where}: duplicate id")
        ids.add(qid)

        if not q.get("topic"):
            problems.append(f"{where}: missing topic (needed for the weak-area report)")

        qtype = q.get("type")
        if qtype == "mc":
            opts = q.get("options")
            if not isinstance(opts, list) or len(opts) < 2:
                problems.append(f"{where}: mc needs an options list with 2+ entries")
            elif len(set(o.strip().lower() for o in opts)) != len(opts):
                problems.append(f"{where}: duplicate options")
            elif len(opts) != opt_count:
                problems.append(f"{where}: has {len(opts)} options, quiz optionCount is {opt_count}")
            ci = q.get("correctIndex")
            if not isinstance(ci, int) or not opts or not 0 <= ci < len(opts):
                problems.append(f"{where}: correctIndex {ci} not a valid index into options")
            if not q.get("prompt"):
                problems.append(f"{where}: mc needs a prompt")
        elif qtype == "pin":
            pin = q.get("pin") or {}
            if not (isinstance(pin.get("x"), (int, float)) and 0 <= pin["x"] <= 1
                    and isinstance(pin.get("y"), (int, float)) and 0 <= pin["y"] <= 1):
                problems.append(f"{where}: pin needs x,y in 0-1")
            if not q.get("answer"):
                problems.append(f"{where}: pin needs an answer label")
            if not q.get("image"):
                problems.append(f"{where}: pin needs an image path")
            elif quiz_dir:
                img = Path(quiz_dir) / q["image"]
                if not img.exists():
                    problems.append(f"{where}: image not found: {img}")
            # a pin question needs somewhere to draw distractors from
            if pin_answers < opt_count and not q.get("distractorPool"):
                problems.append(
                    f"{where}: only {pin_answers} pin answers in quiz but {opt_count} choices needed — "
                    f"add a distractorPool or more pins")
        else:
            problems.append(f"{where}: type must be 'mc' or 'pin', got {qtype!r}")

    return problems


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    quiz_dir = None
    if "--quiz-dir" in sys.argv:
        quiz_dir = sys.argv[sys.argv.index("--quiz-dir") + 1]
    probs = validate(sys.argv[1], quiz_dir)
    if probs:
        print(f"INVALID — {len(probs)} problem(s):")
        for p in probs:
            print(f"  • {p}")
        sys.exit(1)
    print("valid")
