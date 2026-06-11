// Parse course-PDF text into {sections: [{title, terms}]}.
// Built for BIO 40A-style TERMS LISTs: section headings followed by bulleted
// terms ("● Sarcomere"), with markers like "O/I/A" after some terms. Also
// tolerates plain lists (one term per line under a heading). Lecture-slide
// noise (agendas, deadlines, PollEv prompts) is filtered out.

const BULLET = /^[\s]*[●•◦○▪‣·*-][\s​]*/;

// lines matching any of these are logistics noise, never terms or headings
const NOISE = [
  /poll\s*ev/i, /office hours?/i, /\bdue\b/i, /deadline/i, /@\s*\d{1,2}(:\d{2})?\s*(am|pm)/i,
  /\bzoom\b/i, /attendance/i, /student id/i, /\bhw\s*\d/i, /\bpw\s*\d/i, /announcement/i,
  /\bquiz (this|on )?(mon|tue|wed|thu|fri)/i, /^agenda/i, /^~?\d{1,2}(:\d{2})?\s*(am|pm)/i,
  /these slides were made/i, /\bsyllabus\b/i, /sign in/i, /^page \d+/i, /^\d+$/,
  /\bweek \d+,? (mon|tues|wednes|thurs|fri)/i, /lecture activity/i, /\bbreak\b/i, /^end$/i,
  /know these/i, /you can find this information/i, /indicate that you also need/i,
];

// trailing markers on a term line: "Sternocleidomastoid O/I/A" → flag
const OIA = /\s+O\s*\/\s*I\s*\/\s*A\s*$/i;

function isNoise(line) {
  return NOISE.some(re => re.test(line));
}

function cleanTerm(raw) {
  let t = raw.replace(/​/g, '').trim();
  t = t.replace(/\*+/g, '');             // "Maxillae***" emphasis markers
  t = t.replace(/\s*\(\d+\)\s*/g, ' ');  // "(2)" bone-count annotations
  t = t.replace(/[.;,:]+$/, '').replace(/\s+/g, ' ').trim();
  return t;
}

// A heading is a shortish non-bullet line, often "Category:" or Title Case,
// that is followed by bullet/term lines.
function looksLikeHeading(line) {
  if (line.length > 60) return false;
  if (/[.?!]$/.test(line)) return false;
  const words = line.replace(/:$/, '').split(/\s+/);
  return words.length <= 6;
}

export function parseTermsText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const sections = [];
  let current = null;
  let pendingHeading = null;

  for (const line of lines) {
    if (isNoise(line)) continue;

    if (BULLET.test(line)) {
      const raw = cleanTerm(line.replace(BULLET, ''));
      if (!raw || raw.length > 80) continue;
      if (pendingHeading || !current) {
        current = { title: pendingHeading || (current ? current.title : 'Terms'), terms: [] };
        // merge with an existing section of the same title (multi-column PDFs)
        const existing = sections.find(s => s.title === current.title);
        if (existing) current = existing; else sections.push(current);
        pendingHeading = null;
      }
      const oia = OIA.test(raw);
      const name = cleanTerm(raw.replace(OIA, ''));
      if (name && !current.terms.some(t => t.name.toLowerCase() === name.toLowerCase())) {
        current.terms.push({ name, oia });
      }
    } else if (looksLikeHeading(line)) {
      pendingHeading = cleanTerm(line.replace(/:$/, ''));
    } else {
      pendingHeading = null; // prose; breaks heading→bullets adjacency
    }
  }
  return { sections: sections.filter(s => s.terms.length > 0) };
}

// Flatten with topic attached
export function allTerms(parsed) {
  return parsed.sections.flatMap(s => s.terms.map(t => ({ ...t, topic: s.title })));
}
