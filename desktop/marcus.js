// Marcus (David's local AI on vr-2) bridge — main process only, so the
// renderer never deals with CORS or the tailnet. Marcus is OPTIONAL: every
// call here fails soft and the Generate UI falls back to built-in logic.
//
// Protocol notes, learned the hard way:
// - auto_memory:false on every call so quiz generation never pollutes
//   Marcus's real memory.
// - NO persona_prompt and NO JSON-shaped asks — both make the 12B attempt
//   tool calls that fail ("Hm, that didn't go through"). Plain delimited
//   text ("term :: definition" lines, Q::/A:: blocks) is what works.
const MARCUS_URL = 'https://vr-2.tailb97fc.ts.net';

async function getJSON(path, opts = {}, timeoutMs = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${MARCUS_URL}/${path}`, { ...opts, signal: ctl.signal });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// {reachable, current, status, models:[{id,name,blurb,...}]}
async function listModels() {
  try {
    const data = await getJSON('api/models');
    return { reachable: true, ...data };
  } catch {
    return { reachable: false, models: [] };
  }
}

// Ask for a model switch, then poll until the server reports ready (or timeout).
async function selectModel(id, emit = () => {}) {
  const before = await getJSON('api/models');
  if (before.current === id && before.status === 'ready') return true;
  emit(`Switching Marcus to ${id}…`);
  await getJSON('api/models/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const s = await getJSON('api/models').catch(() => null);
    if (s && s.current === id && s.status === 'ready') return true;
    if (s && s.error) throw new Error(`model switch failed: ${s.error}`);
  }
  throw new Error(`model switch to ${id} timed out`);
}

// One /api/chat round, SSE collected to final text. Cumulative-text protocol:
// each event's "text" replaces the previous one; {"done": true} ends it.
async function chat(message, timeoutMs = 5 * 60 * 1000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${MARCUS_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: [], auto_memory: false }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`api/chat: HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', latest = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        try {
          const evt = JSON.parse(line.slice(5));
          if (evt.text !== undefined) latest = evt.text;
          if (evt.done) return latest;
        } catch { /* partial line */ }
      }
    }
    return latest;
  } finally {
    clearTimeout(timer);
  }
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Bounded Levenshtein. Kept separate from js/gen/glossary.js's copy on purpose:
// this file is CommonJS in the Electron main process, that one is ESM in the
// renderer — same algorithm, no clean shared module across the boundary.
function editDistance(a, b, max = Infinity) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, row[j]);
    }
    if (rowMin > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

// Marcus misspells terms ("Risorious") — snap an answer back to the term it
// was meant to be when it's close.
function matchTerm(group, answer) {
  const na = norm(answer);
  let best = null;
  for (const t of group) {
    const max = Math.max(2, Math.floor(norm(t.name).length / 5));
    const d = editDistance(na, norm(t.name), max);
    if (d <= max && (!best || d < best.d)) best = { d, t };
  }
  return best?.t || null;
}

// terms: [{name, topic}] → {<name>: <definition>} for every term Marcus answered
async function fillDefinitions(terms, emit = () => {}) {
  const defs = {};
  const groups = chunk(terms, 8);
  for (const [i, group] of groups.entries()) {
    emit(`Asking Marcus for definitions (${i + 1}/${groups.length})…`);
    const msg = `For each anatomy term below, write a one-sentence definition suitable for a community-college A&P student. Reply with ONE LINE PER TERM in exactly this format, nothing else:

term :: definition

Terms:
${group.map(t => `${t.name} (category: ${t.topic})`).join('\n')}`;
    const text = await chat(msg);
    for (const line of text.split('\n')) {
      const m = line.match(/^(.+?)\s*::\s*(.+)$/);
      if (!m) continue;
      const key = norm(m[1].replace(/\(.*?\)/g, ''));
      const target = group.find(t => norm(t.name) === key || norm(t.name).includes(key) || key.includes(norm(t.name)));
      if (target && m[2].trim().length > 10) defs[target.name] = m[2].trim();
    }
  }
  return defs;
}

// terms: [{name, topic, def?}] → full MC questions written by Marcus, parsed
// from Q::/A::/X::/E:: blocks. Invalid blocks are dropped, not repaired.
async function writeQuestions(terms, emit = () => {}) {
  const questions = [];
  const groups = chunk(terms, 5);
  for (const [i, group] of groups.entries()) {
    emit(`Marcus is writing questions (${i + 1}/${groups.length}, ${questions.length} so far)…`);
    const msg = `Write one multiple-choice quiz question for EACH anatomy term below, for a community-college A&P student. Each question must test understanding of its term (its function, location, or definition) without naming the term in the question. The 4 wrong answers must be real anatomical terms of the same kind as the correct answer.

Reply with one block per term in EXACTLY this format, nothing else:

Q:: the question
A:: the correct answer
X:: wrong answer 1
X:: wrong answer 2
X:: wrong answer 3
X:: wrong answer 4
E:: one-sentence explanation of the correct answer
==

Terms:
${group.map(t => `${t.name} (category: ${t.topic})${t.def ? ` — ${t.def}` : ''}`).join('\n')}`;
    let text = '';
    try { text = await chat(msg); } catch (err) { emit(`  chunk failed: ${err.message}`); continue; }
    let blockIdx = 0;
    for (const block of text.split(/^=+\s*$/m)) {
      // the 12B is sloppy with delimiters: "A:", "X ::=", Cyrillic "А:",
      // fullwidth "：" — accept any tag-letter + colon-ish separator
      const tags = { q: [], a: [], x: [], e: [] };
      for (const line of block.split('\n')) {
        const m = line.match(/^\s*([QAXEqaxeАЕае])\s*[:：=]+\s*(.+)$/);
        if (!m) continue;
        const tag = m[1].replace(/[Аа]/, 'a').replace(/[Ее]/, 'e').toLowerCase();
        if (tags[tag]) tags[tag].push(m[2].trim().replace(/^[-•*]\s*/, ''));
      }
      const [q] = tags.q, [e] = tags.e;
      let [a] = tags.a;
      let xs = tags.x;
      if (!q || !a || xs.length < 3) continue;
      const meant = matchTerm(group, a);
      if (meant) a = meant.name; // canonical spelling
      // pad a 3-distractor block from the chunk's other terms
      if (xs.length < 4) {
        const pad = group.map(t => t.name).filter(nm => norm(nm) !== norm(a) && !xs.some(x => norm(x) === norm(nm)));
        xs = xs.concat(pad.slice(0, 4 - xs.length));
      }
      if (xs.length < 4) continue;
      const options = [a, ...xs.slice(0, 4)];
      if (new Set(options.map(norm)).size !== 5) continue;
      // attribute the block to its term: usually the correct answer IS the
      // term; fall back to block order within this chunk
      const topicTerm = meant || group[Math.min(blockIdx, group.length - 1)];
      blockIdx++;
      questions.push({
        type: 'mc',
        topic: topicTerm?.topic || 'General',
        prompt: q,
        options,
        correctIndex: 0,
        ...(e ? { explanation: e } : {}),
      });
    }
  }
  return questions;
}

module.exports = { listModels, selectModel, chat, fillDefinitions, writeQuestions };
