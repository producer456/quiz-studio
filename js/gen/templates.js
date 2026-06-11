// Pure-logic question generation: terms (from the course PDF) + the bundled
// OpenStax glossary in, quiz questions out. No AI, no network.
import { normTerm, lookup, siblingDefs } from './glossary.js';
import { shuffle } from '../engine.js';
import { questionId } from '../util.js';

const pick = (arr, n) => shuffle(arr).slice(0, n);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const normDef = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

// Draw `n` distractors from prioritized pools, skipping anything that
// normalizes equal to an excluded value or to one already chosen — so the
// correct answer can never reappear as a distractor and no two options match.
// Returns the array of n, or null if the pools can't supply that many.
function uniquePick(pools, n, exclude, norm) {
  const seen = new Set(exclude.map(norm));
  const out = [];
  for (const pool of pools) {
    for (const cand of shuffle(pool)) {
      if (out.length >= n) break;
      const k = norm(cand);
      if (!cand || seen.has(k)) continue;
      seen.add(k);
      out.push(cand);
    }
  }
  return out.length === n ? out : null;
}

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
  const qid = () => questionId(++n);

  for (const t of resolved) {
    const topicSiblings = byTopic[t.topic].filter(o => o !== t && normTerm(o.name) !== normTerm(t.name));
    const otherTerms = resolved.filter(o => o.topic !== t.topic && normTerm(o.name) !== normTerm(t.name));

    // 1. definition → term: distractors are sibling terms from the same section
    if (styles.includes('defToTerm')) {
      const distractors = uniquePick([
        topicSiblings.map(o => o.name),
        otherTerms.map(o => o.name),
      ], optionCount - 1, [t.name], normTerm);
      if (distractors) {
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
      const glossaryDefs = glossary && t.chapter
        ? siblingDefs(glossary, t.chapter, allNorms, optionCount).map(e => e.d) : [];
      // dedupe distractor defs against each other AND against the correct def
      const defs = uniquePick([
        topicSiblings.filter(o => o.def).map(o => o.def),
        glossaryDefs,
        otherTerms.filter(o => o.def).map(o => o.def),
      ], optionCount - 1, [t.def], normDef);
      if (defs) {
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
      const topicNames = new Set(byTopic[topic].map(o => normTerm(o.name)));
      // odd term must not share a name with any category member
      const others = resolved.filter(o => o.topic !== topic && !topicNames.has(normTerm(o.name)));
      if (!others.length) continue;
      for (const odd of pick(others, Math.min(2, others.length))) {
        const members = uniquePick([byTopic[topic].map(o => o.name)], optionCount - 1, [odd.name], normTerm);
        if (!members) continue;
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
