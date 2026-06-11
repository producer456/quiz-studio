#!/usr/bin/env bash
# Zip a quiz folder for sharing with desktop-app users (File → Import Quiz…).
#   tools/pack-quiz.sh <quiz-id>   → dist/<quiz-id>.zip
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ID="${1:?usage: tools/pack-quiz.sh <quiz-id>}"
[ -f "$ROOT/quizzes/$ID/quiz.json" ] || { echo "no quiz at quizzes/$ID" >&2; exit 1; }
mkdir -p "$ROOT/dist"
rm -f "$ROOT/dist/$ID.zip"
(cd "$ROOT/quizzes" && zip -qr "$ROOT/dist/$ID.zip" "$ID" -x "*.DS_Store")
echo "✓ dist/$ID.zip — AirDrop/share it; classmates use File → Import Quiz… in the app"
