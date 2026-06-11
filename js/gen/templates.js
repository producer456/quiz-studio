// Pure-logic question generation: terms (from the course PDF) + the bundled
// OpenStax glossary in, quiz questions out. No AI, no network.
import { normTerm, lookup, siblingDefs } from './glossary.js';

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pick = (arr, n) => shuffle(arr).slice(0, n);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// terms: [{name, topic, def?, chapter?}] — def comes from the glossary match
// or was typed/Marcus-filled in the Generate UI.
// Returns {questions, unmatched} — unmatched terms had no definition source.
export function generateQuestions(terms, glossary, opts = {}) {
  const optionCount = opts.optionCount || 5;
  const styles = opts.styles || ['termToDef', 'defToTerm', 'notInCategory'];

  // resolve definitions
  const resolved = [];
  const unmatched = [];
  for (const t of terms) {
    if (t.def) { resolved.push({ ...t }); continue; }
    const hit = glossary ? lookup(glossary, t.name) : null;
    if (hit) resolved.push({ ...t, def: hit.def, chapter: hit.chapter });
    else unmatched.push(t);
  }

  const byTopic = {};
  for (const t of resolved) (byTopic[t.topic] ||= []).push(t);
  const allNorms = new Set(resolved.map(t => normTerm(t.name)));

  const questions = [];
  let n = 0;
  const qid = () => `q${String(++n).padStart(3, '0')}`;

  for (const t of resolved) {
    const topicSiblings = byTopic[t.topic].filter(o => o !== t && normTerm(o.name) !== normTerm(t.name));
    const otherTerms = resolved.filter(o => o.topic !== t.topic && normTerm(o.name) !== normTerm(t.name));

    // 1. definition → term: distractors are sibling terms from the same section
    if (styles.includes('defToTerm')) {
      let distractors = pick(topicSiblings.map(o => o.name), optionCount - 1);
      if (distractors.length < optionCount - 1) {
        distractors = distractors.concat(
          pick(otherTerms.map(o => o.name), optionCount - 1 - distractors.length));
      }
      if (distractors.length === optionCount - 1) {
        questions.push({
          id: qid(), type: 'mc', topic: t.topic,
          prompt: `Which term matches this description: “${cap(t.def)}”?`,
          options: [t.name, ...distractors], correctIndex: 0,
          explanation: `${cap(t.name)}: ${t.def}.`,
        });
      }
    }

    // 2. term → definition: distractor definitions from siblings, then same-chapter glossary
    if (styles.includes('termToDef')) {
      let defs = pick(topicSiblings.filter(o => o.def).map(o => o.def), optionCount - 1);
      if (defs.length < optionCount - 1 && glossary && t.chapter) {
        defs = defs.concat(
          siblingDefs(glossary, t.chapter, allNorms, optionCount - 1 - defs.length).map(e => e.d));
      }
      if (defs.length < optionCount - 1) {
        defs = defs.concat(pick(otherTerms.filter(o => o.def).map(o => o.def), optionCount - 1 - defs.length));
      }
      defs = [...new Set(defs)].slice(0, optionCount - 1);
      if (defs.length === optionCount - 1) {
        questions.push({
          id: qid(), type: 'mc', topic: t.topic,
          prompt: `Which best describes the ${t.name}?`,
          options: [cap(t.def), ...defs.map(cap)], correctIndex: 0,
          explanation: `${cap(t.name)}: ${t.def}.`,
        });
      }
    }
  }

  // 3. category membership: "Which of these is NOT a <category>?" — the odd
  // one out comes from a different section of the same terms list.
  if (styles.includes('notInCategory')) {
    const topics = Object.keys(byTopic).filter(k => byTopic[k].length >= optionCount - 1);
    for (const topic of topics) {
      const others = resolved.filter(o => o.topic !== topic);
      if (!others.length) continue;
      for (const odd of pick(others, Math.min(2, others.length))) {
        const members = pick(byTopic[topic].map(o => o.name), optionCount - 1);
        questions.push({
          id: qid(), type: 'mc', topic,
          prompt: `Which of these is NOT one of the ${topic.toLowerCase()}?`,
          options: [odd.name, ...members], correctIndex: 0,
          explanation: `${cap(odd.name)} belongs to “${odd.topic}”, not “${topic}”.`,
        });
      }
    }
  }

  return { questions, unmatched };
}
