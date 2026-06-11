// Pure quiz logic: rounds, distractors, grading, mastery loop, weak-area report.
// No DOM access — player.js renders, this decides.

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build the option list for a question, reshuffled per ask.
// MC questions carry their own options; pin questions get distractors
// sampled from (in order): distractorPool, other pins on the same image,
// other pin answers in the same topic, all pin answers in the quiz.
export function buildOptions(quiz, q) {
  const count = quiz.optionCount || 5;
  if (q.type === 'mc') {
    return shuffle(q.options.map((text, i) => ({ text, correct: i === q.correctIndex })));
  }
  const pools = [
    q.distractorPool || [],
    quiz.questions.filter(o => o.type === 'pin' && o.image === q.image && o.id !== q.id).map(o => o.answer),
    quiz.questions.filter(o => o.type === 'pin' && o.topic === q.topic && o.id !== q.id).map(o => o.answer),
    quiz.questions.filter(o => o.type === 'pin' && o.id !== q.id).map(o => o.answer),
  ];
  const picked = [];
  const seen = new Set([norm(q.answer)]);
  for (const pool of pools) {
    for (const cand of shuffle(pool)) {
      if (picked.length >= count - 1) break;
      if (!cand || seen.has(norm(cand))) continue;
      seen.add(norm(cand));
      picked.push(cand);
    }
  }
  return shuffle([{ text: q.answer, correct: true }, ...picked.map(text => ({ text, correct: false }))]);
}

function norm(s) { return String(s).trim().toLowerCase(); }

// A session walks rounds until every question has been answered correctly.
// Round 1 = all questions; round N = questions missed in round N-1.
export function newSession(quiz, mode) {
  return {
    quizId: quiz.id,
    mode, // 'practice' (feedback per question) | 'test' (feedback at round end)
    round: 1,
    queue: shuffle(quiz.questions.map(q => q.id)),
    pos: 0,
    missed: [],            // ids missed this round
    mastered: [],          // ids answered correctly in any round
    firstTry: {},          // id -> true/false, set on first encounter only
    roundResults: [],      // this round: {id, pickedText, correct}
    finishedRounds: [],    // archive of past roundResults
  };
}

export function currentQuestion(quiz, s) {
  const id = s.queue[s.pos];
  return quiz.questions.find(q => q.id === id) || null;
}

export function recordAnswer(s, q, picked) {
  const correct = !!picked.correct;
  if (!(q.id in s.firstTry)) s.firstTry[q.id] = correct;
  if (correct) s.mastered.push(q.id); else s.missed.push(q.id);
  s.roundResults.push({ id: q.id, pickedText: picked.text, correct });
  s.pos++;
}

export function roundDone(s) { return s.pos >= s.queue.length; }
export function sessionDone(s) { return roundDone(s) && s.missed.length === 0; }

export function nextRound(s) {
  s.finishedRounds.push({ round: s.round, results: s.roundResults });
  s.round++;
  s.queue = shuffle(s.missed);
  s.missed = [];
  s.roundResults = [];
  s.pos = 0;
}

// Weak-area report across the whole session, grouped by topic.
// firstTry drives the "study this" ranking; mastered tracks the loop.
export function topicReport(quiz, s) {
  const topics = {};
  for (const q of quiz.questions) {
    const t = q.topic || 'General';
    topics[t] ||= { topic: t, total: 0, firstTryCorrect: 0, mastered: 0 };
    topics[t].total++;
    if (s.firstTry[q.id]) topics[t].firstTryCorrect++;
    if (s.mastered.includes(q.id)) topics[t].mastered++;
  }
  return Object.values(topics)
    .map(t => ({ ...t, missRate: 1 - t.firstTryCorrect / t.total }))
    .sort((a, b) => b.missRate - a.missRate);
}

export function roundScore(s) {
  const total = s.roundResults.length;
  const correct = s.roundResults.filter(r => r.correct).length;
  return { correct, total, pct: total ? Math.round((correct / total) * 100) : 0 };
}

// --- persistence ---------------------------------------------------------

const KEY = id => `quiz-studio:${id}:session`;

export function saveSession(s) {
  try { localStorage.setItem(KEY(s.quizId), JSON.stringify(s)); } catch {}
}
export function loadSession(quizId) {
  try {
    const raw = localStorage.getItem(KEY(quizId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export function clearSession(quizId) {
  try { localStorage.removeItem(KEY(quizId)); } catch {}
}
