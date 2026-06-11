// Matching course terms against the bundled OpenStax A&P glossary.
// The glossary is {entries: {<normalized term>: {t: display term, d: definition, c: chapter}}}.

export function normTerm(s) {
  return String(s)
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')        // "(TSH)" parentheticals
    .replace(/[‘’']/g, "'")
    .replace(/[^a-z0-9' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singular(w) {
  if (/ae$/.test(w)) return w.replace(/ae$/, 'a');               // maxillae → maxilla
  if (/[^aeiou]ies$/.test(w)) return w.replace(/ies$/, 'y');     // cavities → cavity
  if (/(ses|xes|zes|ches|shes)$/.test(w)) return w.replace(/es$/, '');
  if (/[^aeiou]i$/.test(w) && w.length > 4) return w.replace(/i$/, 'us'); // radii → radius
  if (/s$/.test(w) && !/ss$/.test(w)) return w.replace(/s$/, '');
  return w;
}

function baseVariants(term) {
  const n = normTerm(term);
  const out = new Set([n]);
  // singularize last word: "t-tubules" → "t-tubule"
  const words = n.split(' ');
  const sing = [...words.slice(0, -1), singular(words[words.length - 1])].join(' ');
  out.add(sing);
  out.add(n.replace(/-/g, ' '));
  out.add(sing.replace(/-/g, ' '));
  // strip leading anatomy direction words for a looser fallback
  const stripped = n.replace(/^(left|right)\s+/, '');
  out.add(stripped);
  return [...out];
}

function variants(term) {
  // slash alternatives: "supraorbital foramen/notch" → try "supraorbital
  // foramen" and "supraorbital notch"; "dens/odontoid process" → both sides
  const out = new Set(baseVariants(term));
  if (term.includes('/')) {
    const [head, ...alts] = term.split('/').map(s => s.trim());
    const headWords = head.split(/\s+/);
    const prefix = headWords.slice(0, -1).join(' ');
    for (const v of baseVariants(head)) out.add(v);
    for (const alt of alts) {
      for (const v of baseVariants(alt)) out.add(v);
      if (prefix && !alt.includes(' ')) {
        for (const v of baseVariants(`${prefix} ${alt}`)) out.add(v); // "supraorbital notch"
      }
    }
  }
  return [...out].filter(Boolean);
}

// bounded edit distance for typo tolerance ("lamboid" → "lambdoid")
function editDistance(a, b, max) {
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

// returns {term, def, chapter} or null
export function lookup(glossary, term) {
  for (const v of variants(term)) {
    const hit = glossary.entries[v];
    if (hit) return { term: hit.t, def: hit.d, chapter: hit.c };
  }
  // fuzzy fallback: tolerate 1-2 typos on reasonably long terms
  const q = variants(term)[0];
  if (q.length >= 6) {
    const max = q.length >= 10 ? 2 : 1;
    let best = null;
    for (const [k, v] of Object.entries(glossary.entries)) {
      if (k[0] !== q[0]) continue; // cheap prefilter
      const d = editDistance(q, k, max);
      if (d <= max && (!best || d < best.d)) best = { d, v };
      if (best && best.d === 1 && max === 1) break;
    }
    if (best) return { term: best.v.t, def: best.v.d, chapter: best.v.c, fuzzy: true };
  }
  return null;
}

// Pull N glossary definitions from the same chapter (or anywhere as fallback)
// to use as distractor definitions, excluding given normalized terms.
export function siblingDefs(glossary, chapter, excludeNorms, n) {
  const all = Object.entries(glossary.entries);
  const same = all.filter(([k, v]) => v.c === chapter && !excludeNorms.has(k));
  const pool = same.length >= n ? same : all.filter(([k]) => !excludeNorms.has(k));
  const picked = [];
  const used = new Set();
  while (picked.length < n && used.size < pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    if (used.has(i)) continue;
    used.add(i);
    picked.push(pool[i][1]);
  }
  return picked;
}
