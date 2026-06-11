// Teacher mode (#/author): build or edit a quiz in the browser, export a
// ready-to-publish zip (quiz folder with quiz.json + images).
import { fetchQuizIndex, fetchQuiz, esc } from './catalog.js';
import { buildZip } from './zip.js';
import { setContext } from './app.js';

// Working state for the quiz being authored. Uploaded images live in memory
// as {name -> Uint8Array}; images on an already-published quiz stay remote.
let draft = null;
let uploadedImages = {};

function blankDraft() {
  return {
    id: '', title: '', course: 'BIO 40A', description: '',
    created: new Date().toISOString().slice(0, 10),
    optionCount: 5, questions: [],
  };
}

export async function renderAuthor(view) {
  setContext('Teacher mode');
  if (!draft) {
    let published = [];
    try { published = (await fetchQuizIndex()).quizzes; } catch {}
    view.innerHTML = `
      <div class="card start-card">
        <h1>Teacher mode</h1>
        <div class="btn-row"><button class="btn primary" id="new">New quiz</button></div>
        <h2>Or edit a published quiz</h2>
        <div class="author-list">
          ${published.map(q => `<button class="btn option" data-edit="${esc(q.id)}">${esc(q.title)}</button>`).join('') || '<p class="meta">none yet</p>'}
        </div>
        <h2>Or load a quiz.json from disk</h2>
        <input type="file" id="load-json" accept=".json">
      </div>`;
    view.querySelector('#new').addEventListener('click', () => { draft = blankDraft(); uploadedImages = {}; renderAuthor(view); });
    view.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', async () => {
      draft = await fetchQuiz(b.dataset.edit);
      uploadedImages = {};
      renderAuthor(view);
    }));
    view.querySelector('#load-json').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      draft = JSON.parse(await file.text());
      uploadedImages = {};
      renderAuthor(view);
    });
    return;
  }
  renderEditor(view);
}

function renderEditor(view) {
  const mcCount = draft.questions.filter(q => q.type === 'mc').length;
  const pinCount = draft.questions.filter(q => q.type === 'pin').length;
  view.innerHTML = `
    <div class="card">
      <h1>Quiz setup</h1>
      <div class="form-grid">
        <label>ID (folder name) <input id="f-id" value="${esc(draft.id)}" placeholder="week6-endocrine" pattern="[a-z0-9-]+"></label>
        <label>Title <input id="f-title" value="${esc(draft.title)}" placeholder="Week 6 — Endocrine"></label>
        <label>Course <input id="f-course" value="${esc(draft.course || '')}"></label>
        <label>Description <input id="f-desc" value="${esc(draft.description || '')}"></label>
        <label>Choices per question <input id="f-optcount" type="number" min="2" max="8" value="${draft.optionCount || 5}"></label>
      </div>
    </div>
    <div class="card">
      <h1>Questions <span class="meta">(${mcCount} multiple choice, ${pinCount} pin)</span></h1>
      <div id="q-list" class="author-list"></div>
      <div class="btn-row">
        <button class="btn" id="add-mc">+ Multiple choice</button>
        <button class="btn" id="add-pin">+ Pin questions (image)</button>
      </div>
    </div>
    <div class="card">
      <div class="btn-row">
        <button class="btn primary" id="export">Download quiz folder (.zip)</button>
        <button class="btn" id="export-json">Download quiz.json only</button>
        <button class="btn danger" id="discard">Discard draft</button>
      </div>
      <p class="meta">Unzip into <code>quizzes/</code> in the repo, then run <code>tools/publish.sh</code>.</p>
    </div>
    <div id="modal-slot"></div>`;

  const bind = (id, key, transform = v => v) =>
    view.querySelector(id).addEventListener('input', e => { draft[key] = transform(e.target.value); });
  bind('#f-id', 'id', v => v.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
  bind('#f-title', 'title');
  bind('#f-course', 'course');
  bind('#f-desc', 'description');
  bind('#f-optcount', 'optionCount', v => parseInt(v, 10) || 5);

  const list = view.querySelector('#q-list');
  draft.questions.forEach((q, i) => {
    const row = document.createElement('div');
    row.className = 'q-row';
    row.innerHTML = `
      <span class="tag">${q.type}</span>
      <span class="q-row-text">${esc(q.type === 'pin' ? `${q.answer} — ${q.image}` : q.prompt)}</span>
      <span class="meta">${esc(q.topic || '')}</span>
      <button class="btn small" data-del="${i}">✕</button>`;
    row.querySelector('[data-del]').addEventListener('click', () => {
      draft.questions.splice(i, 1);
      renderEditor(view);
    });
    list.appendChild(row);
  });

  view.querySelector('#add-mc').addEventListener('click', () => mcModal(view));
  view.querySelector('#add-pin').addEventListener('click', () => pinModal(view));
  view.querySelector('#discard').addEventListener('click', () => {
    if (confirm('Throw away this draft?')) { draft = null; uploadedImages = {}; renderAuthor(view); }
  });
  view.querySelector('#export-json').addEventListener('click', () => {
    download(`quiz.json`, new Blob([draftJson()], { type: 'application/json' }));
  });
  view.querySelector('#export').addEventListener('click', async () => {
    if (!draft.id) return alert('Set an ID first — it becomes the folder name.');
    const enc = new TextEncoder();
    const files = [{ path: `${draft.id}/quiz.json`, data: enc.encode(draftJson()) }];
    for (const [name, data] of Object.entries(uploadedImages)) {
      files.push({ path: `${draft.id}/images/${name}`, data });
    }
    download(`${draft.id}.zip`, buildZip(files));
  });
}

function draftJson() {
  return JSON.stringify(draft, null, 2);
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function nextId() {
  let n = draft.questions.length + 1;
  while (draft.questions.some(q => q.id === `q${String(n).padStart(3, '0')}`)) n++;
  return `q${String(n).padStart(3, '0')}`;
}

// --- multiple choice form -------------------------------------------------

function mcModal(view) {
  const slot = view.querySelector('#modal-slot');
  const count = draft.optionCount || 5;
  slot.innerHTML = `
    <div class="modal-backdrop"><div class="card modal">
      <h2>New multiple-choice question</h2>
      <label>Topic <input id="m-topic" placeholder="Endocrine — Pituitary"></label>
      <label>Question <textarea id="m-prompt" rows="2"></textarea></label>
      <label>Correct answer <input id="m-correct"></label>
      ${Array.from({ length: count - 1 }, (_, i) => `<label>Distractor ${i + 1} <input class="m-distractor"></label>`).join('')}
      <label>Explanation (optional) <input id="m-explain"></label>
      <div class="btn-row">
        <button class="btn primary" id="m-save">Add question</button>
        <button class="btn" id="m-cancel">Cancel</button>
      </div>
    </div></div>`;
  slot.querySelector('#m-cancel').addEventListener('click', () => (slot.innerHTML = ''));
  slot.querySelector('#m-save').addEventListener('click', () => {
    const correct = slot.querySelector('#m-correct').value.trim();
    const distractors = [...slot.querySelectorAll('.m-distractor')].map(i => i.value.trim()).filter(Boolean);
    const prompt = slot.querySelector('#m-prompt').value.trim();
    if (!prompt || !correct || distractors.length < 1) return alert('Need a question, a correct answer, and at least one distractor.');
    const options = [correct, ...distractors];
    draft.questions.push({
      id: nextId(), type: 'mc',
      topic: slot.querySelector('#m-topic').value.trim() || 'General',
      prompt, options, correctIndex: 0,
      ...(slot.querySelector('#m-explain').value.trim() ? { explanation: slot.querySelector('#m-explain').value.trim() } : {}),
    });
    slot.innerHTML = '';
    renderEditor(view);
  });
}

// --- pin editor -------------------------------------------------------------

function pinModal(view) {
  const slot = view.querySelector('#modal-slot');
  const candidates = draft.imageCandidates || [];
  slot.innerHTML = `
    <div class="modal-backdrop"><div class="card modal modal-wide">
      <h2>Pin questions</h2>
      <p class="meta">Pick an image, then tap each structure and name it. Every pin becomes a question.</p>
      <div class="btn-row">
        <input type="file" id="p-upload" accept="image/*">
        ${candidates.length ? `<select id="p-candidate"><option value="">…or a PDF-extracted image</option>${candidates.map(c => `<option>${esc(c)}</option>`).join('')}</select>` : ''}
      </div>
      <label>Topic for these pins <input id="p-topic" placeholder="Skull"></label>
      <div class="pin-figure author-figure" id="p-figure" hidden>
        <img id="p-img" draggable="false">
      </div>
      <div id="p-pins" class="author-list"></div>
      <div class="btn-row">
        <button class="btn primary" id="p-save">Add ${0} pins</button>
        <button class="btn" id="p-cancel">Cancel</button>
      </div>
    </div></div>`;

  let imagePath = null; // path stored in quiz.json
  const pins = [];      // {x, y, label}
  const figure = slot.querySelector('#p-figure');
  const img = slot.querySelector('#p-img');

  slot.querySelector('#p-upload').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const safe = file.name.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
    uploadedImages[safe] = new Uint8Array(await file.arrayBuffer());
    imagePath = `images/${safe}`;
    img.src = URL.createObjectURL(file);
    figure.hidden = false;
  });
  slot.querySelector('#p-candidate')?.addEventListener('change', e => {
    if (!e.target.value) return;
    imagePath = e.target.value;
    img.src = `quizzes/${draft.id}/${imagePath}`;
    figure.hidden = false;
  });

  figure.addEventListener('click', e => {
    if (e.target.closest('.pin-marker')) return;
    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    const label = window.prompt('Structure name for this pin:');
    if (!label || !label.trim()) return;
    pins.push({ x: +x.toFixed(4), y: +y.toFixed(4), label: label.trim() });
    redraw();
  });

  function redraw() {
    figure.querySelectorAll('.pin-marker').forEach(m => m.remove());
    pins.forEach((p, i) => {
      const m = document.createElement('div');
      m.className = 'pin-marker author-pin';
      m.style.left = `${p.x * 100}%`;
      m.style.top = `${p.y * 100}%`;
      m.innerHTML = `<div class="pin-dot"></div><span class="pin-num">${i + 1}</span>`;
      figure.appendChild(m);
    });
    const list = slot.querySelector('#p-pins');
    list.innerHTML = pins.map((p, i) => `
      <div class="q-row"><span class="tag">${i + 1}</span>
        <span class="q-row-text">${esc(p.label)}</span>
        <button class="btn small" data-pdel="${i}">✕</button></div>`).join('');
    list.querySelectorAll('[data-pdel]').forEach(b =>
      b.addEventListener('click', () => { pins.splice(+b.dataset.pdel, 1); redraw(); }));
    slot.querySelector('#p-save').textContent = `Add ${pins.length} pin${pins.length === 1 ? '' : 's'}`;
  }

  slot.querySelector('#p-cancel').addEventListener('click', () => (slot.innerHTML = ''));
  slot.querySelector('#p-save').addEventListener('click', () => {
    if (!imagePath || !pins.length) return alert('Pick an image and place at least one pin.');
    const topic = slot.querySelector('#p-topic').value.trim() || 'General';
    for (const p of pins) {
      draft.questions.push({
        id: nextId(), type: 'pin', topic,
        image: imagePath, pin: { x: p.x, y: p.y }, answer: p.label,
      });
    }
    slot.innerHTML = '';
    renderEditor(view);
  });
}
