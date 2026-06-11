// Homepage: lists every quiz from quizzes/index.json (built by tools/publish.sh).
// In the desktop app, window.quizStudioNative (from the Electron preload)
// replaces fetch with filesystem reads of bundled + imported quizzes.

import { isStale } from './app.js';

const native = typeof window !== 'undefined' ? window.quizStudioNative : null;

export async function fetchQuizIndex() {
  if (native) return native.listQuizzes();
  const res = await fetch('quizzes/index.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Couldn't load the quiz list (${res.status}). Run tools/publish.sh to build quizzes/index.json.`);
  return res.json();
}

export async function fetchQuiz(id) {
  if (native) {
    const { quiz, base } = await native.readQuiz(id);
    quiz.__base = base;
    return quiz;
  }
  const res = await fetch(`quizzes/${id}/quiz.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Couldn't load quiz "${id}" (${res.status}).`);
  return res.json();
}

// URL for a file that lives inside a quiz's folder (e.g. its images).
export function quizAsset(quiz, relPath) {
  return quiz.__base ? `${quiz.__base}/${relPath}` : `quizzes/${quiz.id}/${relPath}`;
}

export async function renderCatalog(view, token) {
  const index = await fetchQuizIndex();
  if (token !== undefined && isStale(token)) return;
  const byCourse = {};
  for (const q of index.quizzes) (byCourse[q.course || 'Other'] ||= []).push(q);

  const el = document.createElement('div');
  el.className = 'catalog';
  el.innerHTML = `<h1>Pick a quiz</h1>`;
  for (const [course, quizzes] of Object.entries(byCourse)) {
    const section = document.createElement('section');
    section.innerHTML = `<h2>${esc(course)}</h2>`;
    const grid = document.createElement('div');
    grid.className = 'quiz-grid';
    for (const q of quizzes) {
      const a = document.createElement('a');
      a.className = 'card quiz-card';
      a.href = `#/quiz/${encodeURIComponent(q.id)}`;
      a.innerHTML = `
        <h3>${esc(q.title)}</h3>
        <p>${esc(q.description || '')}</p>
        <div class="meta">
          <span>${q.questionCount} questions</span>
          ${q.hasPins ? '<span class="tag">image ID</span>' : ''}
          ${q.created ? `<span>${esc(q.created)}</span>` : ''}
        </div>`;
      grid.appendChild(a);
    }
    section.appendChild(grid);
    el.appendChild(section);
  }
  if (!index.quizzes.length) {
    el.innerHTML += `<div class="card"><p>No quizzes yet. Make one with <code>tools/make-quiz.sh</code> or in <a href="#/author">teacher mode</a>.</p></div>`;
  }
  view.appendChild(el);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
