# Question-writing rules for generated quizzes

These rules are injected into the prompt `make-quiz.sh` sends to Claude.

## Coverage
- Spread questions evenly across the source material — every major section of
  every input PDF should be represented. Do not cluster on the first chapters.
- Tag every question with a `topic` that names the study area the way a
  student would say it (e.g. "Heart — Conduction System", "Tissues — Epithelial").
  Use 8–20 distinct topics for a 150-question bank; the weak-area report
  groups by these.

## Question quality
- Test understanding, not trivia: prefer "which of these would happen if…",
  "a patient presents with…", "which structure does X" over "what page said…".
- One unambiguously correct answer per question. If two options could be
  argued, rewrite.
- No "all of the above" / "none of the above" / "A and C".
- Keep prompts self-contained — never reference "the slide", "the figure
  above", or "as discussed in lecture".

## Distractors
- Every distractor must be a real term from the same source material — never
  invented words.
- Same category as the answer: if the answer is a bone, all distractors are
  bones; if a hormone, all hormones; if a process, all processes.
- Same grain of specificity and similar length as the correct answer, so the
  right choice doesn't stand out by format.
- Prefer the classic confusions (e.g. osteoblast/osteoclast/osteocyte,
  flexion/extension, T3/T4/TSH).

## Explanations
- One or two sentences per question in `explanation`: why the right answer is
  right, and—when there's a classic confusion—why the tempting distractor is wrong.
