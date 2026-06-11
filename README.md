# Quiz Studio

One site, all the study quizzes: https://producer456.github.io/quiz-studio/
Desktop apps (Mac/PC, fully offline): see [Releases](https://github.com/producer456/quiz-studio/releases).

Every quiz lives in `quizzes/<id>/` as a `quiz.json` (+ `images/`). The player
engine is generic — drop in a new folder, publish, done. Both question types
share the same flow: take the test → see a weak-area report by topic →
**retake just the questions you missed, looping until you've gotten every one
right**.

## Question types

- **`mc`** — classic multiple choice
- **`pin`** — an image with a pre-placed pin; identify the marked structure
  from 5 choices. Distractors are assembled automatically from the other pins
  on the same image, then same-topic, then the rest of the quiz.

Schema: `tools/schema.json`.

## Generating a quiz (desktop app)

**⚡ Generate** in the app's teacher mode: drop in lecture PDFs, terms lists,
or images. Everything runs locally — no cloud AI:

- **Built-in engine** — instant and offline. Parses the terms-list structure
  (section headings → topics, bullets → terms), matches terms against the
  bundled **OpenStax Anatomy & Physiology 2e glossary** (3,000+ terms,
  CC BY 4.0, openstax.org), and writes definition / identification / category
  questions with same-category distractors.
- **Marcus engine** — optional AI question writing on David's local server
  (tailnet only), model selectable live from the server's list. Also available
  as a fallback to write definitions for terms the glossary doesn't know.
- PDF pages can be kept as figure images; tap pins on them in teacher mode
  (your taps are the answer key — no AI guessing at anatomy).

Generated quizzes land in your app library immediately and open in teacher
mode for review — that's the editing layer for anything the generator got
wrong (click any question to fix it, tap to move pins).

## Sharing & publishing

- **To classmates' apps:** export a quiz zip (teacher mode → Download) or
  `tools/pack-quiz.sh <id>`, send it however; they use File → Import Quiz….
- **To the website:** unzip into `quizzes/` here, then
  `tools/publish.sh "add week 8"` (validates everything, rebuilds the index,
  pushes; live in ~1 min).
- Preview locally: `python3 -m http.server -d . 8000`

## Building the desktop apps

```bash
npm install
npx electron-builder --mac --win   # → dist/
```

## Heads-up on images

The site is public. Lab-packet scans are the usual gray area; prefer
CC-licensed figures (Wikimedia, OpenStax) where possible.
