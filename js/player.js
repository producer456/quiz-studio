import * as E from './engine.js';
import { fetchQuiz, quizAsset, esc } from './catalog.js';
import { setContext } from './app.js';

export async function renderPlayer(view, quizArg) {
  // #/quiz/<id>?mode=test|practice auto-starts — shareable direct links
  const [quizId, query] = quizArg.split('?');
  const quiz = await fetchQuiz(quizId);
  setContext(quiz.title);

  const mode = new URLSearchParams(query || '').get('mode');
  if (mode === 'test' || mode === 'practice') {
    const s = E.newSession(quiz, mode);
    E.saveSession(s);
    return renderQuestion(view, quiz, s);
  }

  const saved = E.loadSession(quizId);
  if (saved && !E.sessionDone(saved)) {
    renderResumeChoice(view, quiz, saved);
  } else {
    renderStart(view, quiz);
  }
}

function renderStart(view, quiz) {
  view.innerHTML = `
    <div class="card start-card">
      <h1>${esc(quiz.title)}</h1>
      <p>${esc(quiz.description || '')}</p>
      <p class="meta">${quiz.questions.length} questions · miss any and you'll retake just those until you've gotten every one right</p>
      <div class="btn-row">
        <button class="btn primary" data-mode="test">Test me</button>
        <button class="btn" data-mode="practice">Practice (instant feedback)</button>
      </div>
    </div>`;
  view.querySelectorAll('[data-mode]').forEach(btn =>
    btn.addEventListener('click', () => {
      const s = E.newSession(quiz, btn.dataset.mode);
      E.saveSession(s);
      renderQuestion(view, quiz, s);
    }));
}

function renderResumeChoice(view, quiz, saved) {
  const done = saved.mastered.length;
  view.innerHTML = `
    <div class="card start-card">
      <h1>${esc(quiz.title)}</h1>
      <p>You have a session in progress — round ${saved.round}, ${done}/${quiz.questions.length} mastered.</p>
      <div class="btn-row">
        <button class="btn primary" id="resume">Keep going</button>
        <button class="btn" id="restart">Start over</button>
      </div>
    </div>`;
  view.querySelector('#resume').addEventListener('click', () => {
    if (E.roundDone(saved)) renderRoundResults(view, quiz, saved);
    else renderQuestion(view, quiz, saved);
  });
  view.querySelector('#restart').addEventListener('click', () => {
    E.clearSession(quiz.id);
    renderStart(view, quiz);
  });
}

function renderQuestion(view, quiz, s) {
  const q = E.currentQuestion(quiz, s);
  if (!q) return renderRoundResults(view, quiz, s);
  const options = E.buildOptions(quiz, q);

  view.innerHTML = `
    <div class="progress-bar"><div class="progress-fill" style="width:${(s.pos / s.queue.length) * 100}%"></div></div>
    <div class="q-meta">Round ${s.round} · Question ${s.pos + 1} of ${s.queue.length}${s.round > 1 ? ' (missed last round)' : ''}</div>
    <div class="card q-card">
      ${q.type === 'pin' ? pinFigure(quiz, q) : ''}
      <h2 class="prompt">${esc(q.prompt || (q.type === 'pin' ? 'What structure is marked?' : ''))}</h2>
      <div class="options"></div>
      <div class="feedback" hidden></div>
      <div class="btn-row"><button class="btn primary" id="next" hidden>Next</button></div>
    </div>`;

  if (q.type === 'pin') placePinMarker(view);

  const optionsEl = view.querySelector('.options');
  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'btn option';
    btn.textContent = opt.text;
    btn.addEventListener('click', () => answer(opt, btn));
    optionsEl.appendChild(btn);
  });

  function answer(opt, btn) {
    E.recordAnswer(s, q, opt);
    E.saveSession(s);
    optionsEl.querySelectorAll('button').forEach(b => (b.disabled = true));
    if (s.mode === 'practice') {
      btn.classList.add(opt.correct ? 'correct' : 'incorrect');
      if (!opt.correct) {
        const right = [...optionsEl.children].find(b => b.textContent === correctText(q, options));
        right?.classList.add('correct');
      }
      const fb = view.querySelector('.feedback');
      fb.hidden = false;
      fb.className = `feedback ${opt.correct ? 'good' : 'bad'}`;
      fb.innerHTML = `${opt.correct ? 'Correct.' : `Not quite — it's <strong>${esc(correctText(q, options))}</strong>.`}${q.explanation ? `<p>${esc(q.explanation)}</p>` : ''}`;
      view.querySelector('#next').hidden = false;
      view.querySelector('#next').addEventListener('click', () => advance());
    } else {
      advance();
    }
  }

  function advance() {
    if (E.roundDone(s)) renderRoundResults(view, quiz, s);
    else renderQuestion(view, quiz, s);
  }
}

function correctText(q, options) {
  return options.find(o => o.correct).text;
}

function pinFigure(quiz, q) {
  return `
    <div class="pin-figure" data-x="${q.pin.x}" data-y="${q.pin.y}">
      <img src="${quizAsset(quiz, q.image)}" alt="identify the marked structure" draggable="false">
      <div class="pin-marker" hidden><div class="pin-ring"></div><div class="pin-dot"></div></div>
    </div>`;
}

function placePinMarker(view) {
  const fig = view.querySelector('.pin-figure');
  const img = fig.querySelector('img');
  const marker = fig.querySelector('.pin-marker');
  const place = () => {
    marker.style.left = `${parseFloat(fig.dataset.x) * 100}%`;
    marker.style.top = `${parseFloat(fig.dataset.y) * 100}%`;
    marker.hidden = false;
  };
  if (img.complete) place(); else img.addEventListener('load', place);
}

function renderRoundResults(view, quiz, s) {
  const score = E.roundScore(s);
  const done = E.sessionDone(s);
  const report = E.topicReport(quiz, s);

  let html = `
    <div class="card results-card">
      <h1>${done ? '💯 All questions mastered!' : `Round ${s.round}: ${score.correct}/${score.total} (${score.pct}%)`}</h1>`;

  if (done && s.round > 1) {
    html += `<p>It took ${s.round} rounds — the report below shows where the first-try misses were.</p>`;
  }

  html += `<h2>Where to focus</h2><div class="report">`;
  for (const t of report) {
    const pct = Math.round((t.firstTryCorrect / t.total) * 100);
    const grade = t.missRate >= 0.5 ? 'weak' : t.missRate > 0.15 ? 'mid' : 'strong';
    html += `
      <div class="report-row">
        <span class="report-topic">${esc(t.topic)}</span>
        <div class="report-bar"><div class="report-fill ${grade}" style="width:${pct}%"></div></div>
        <span class="report-num">${t.firstTryCorrect}/${t.total} first try</span>
      </div>`;
  }
  html += `</div>`;

  const missedNow = s.missed.length;
  html += `<div class="btn-row">`;
  if (!done) {
    html += `<button class="btn primary" id="retake">Retake the ${missedNow} you missed</button>`;
  } else {
    html += `<button class="btn primary" id="again">Take it again</button>`;
  }
  html += `<a class="btn" href="#/">All quizzes</a></div></div>`;

  view.innerHTML = html;

  view.querySelector('#retake')?.addEventListener('click', () => {
    E.nextRound(s);
    E.saveSession(s);
    renderQuestion(view, quiz, s);
  });
  view.querySelector('#again')?.addEventListener('click', () => {
    E.clearSession(quiz.id);
    const ns = E.newSession(quiz, s.mode);
    E.saveSession(ns);
    renderQuestion(view, quiz, ns);
  });
  if (done) E.clearSession(quiz.id);
}
