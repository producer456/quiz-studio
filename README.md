# Quiz Studio

One site, all the study quizzes: https://producer456.github.io/quiz-studio/

Every quiz lives in `quizzes/<id>/` as a `quiz.json` (+ `images/`). The player
engine is generic — drop in a new folder, publish, done. Both question types
share the same flow: take the test → see a weak-area report by topic →
**retake just the questions you missed, looping until you've gotten every one
right**.

## Question types

- **`mc`** — classic multiple choice (the 150-question lecture/textbook banks)
- **`pin`** — an image with a pre-placed pin; identify the marked structure
  from 5 choices. Distractors are assembled automatically from the other pins
  on the same image, then same-topic, then the rest of the quiz.

Schema: `tools/schema.json`.

## Making a quiz from PDFs

```bash
tools/make-quiz.sh week6-endocrine "Week 6 — Endocrine" lecture6.pdf chapter17.pdf
# options: -n 100 (question count, default 150) · -c "BIO 41" (course)
```

This extracts the PDFs' images as pin candidates, has Claude write the MC
question bank (rules in `tools/question-rules.md`), validates it, and drops
`quizzes/week6-endocrine/quiz.json`.

## Pin questions / teacher mode

Open the site's `#/author` page (✎ in the footer — works in Safari on the
iPad). Pick a PDF-extracted image or upload one, tap each structure, name it.
Export downloads a zip of the quiz folder; unzip into `quizzes/` here.

## Preview + publish

```bash
python3 -m http.server -d . 8000     # http://localhost:8000
tools/publish.sh "add week 6"        # validates everything, rebuilds the index, pushes
```

GitHub Pages serves `main` directly; live ~1 minute after push.

## Heads-up on images

The site is public. Lab-packet scans are the usual gray area; for anything
beyond that, prefer CC-licensed figures (Wikimedia, OpenStax) over
personal-use-only sources.
