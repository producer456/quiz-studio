// Generate view (#/generate) — desktop app only. Upload course PDFs/images,
// the software builds the quiz itself: pdf.js extracts text + page images
// locally, the terms parser + bundled OpenStax glossary + templates write the
// questions. Marcus (David's local AI) is an optional, chooseable engine.
import { parseTermsText, allTerms } from './gen/parse-terms.js';
import { generateQuestions } from './gen/templates.js';
import { esc } from './catalog.js';
import { setContext } from './app.js';

const native = typeof window !== 'undefined' ? window.quizStudioNative : null;

let pdfjs = null;
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  // legacy build: Electron 33's Chromium lacks Uint8Array.toHex, which the
  // modern pdf.js v6 build assumes
  pdfjs = await import('../node_modules/pdfjs-dist/legacy/build/pdf.min.mjs');
  // module workers over file:// are flaky — pdf.js falls back to its fake
  // worker automatically; that's fine at our document sizes
  pdfjs.GlobalWorkerOptions.workerSrc =
    new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href;
  return pdfjs;
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export async function renderGenerate(view) {
  if (!native) {
    view.innerHTML = `<div class="card"><h1>Generate</h1><p>Quiz generation runs in the Quiz Studio desktop app (it reads your PDFs locally). On the website, use <a href="#/author">teacher mode</a> to author by hand.</p></div>`;
    return;
  }
  setContext('Generate a quiz');

  view.innerHTML = `
    <div class="card">
      <h1>Generate a quiz</h1>
      <p class="meta">Drop in lecture slides, terms lists, or textbook chapters. Everything runs on this computer.</p>
      <div class="form-grid">
        <label>Title <input id="g-title" placeholder="Week 8 — Muscles"></label>
        <label>Quiz ID <input id="g-id" placeholder="week8-muscles"></label>
        <label>Course <input id="g-course" value="BIO 40A"></label>
      </div>
      <label style="margin-top:12px">Source files (PDFs and/or images)
        <input type="file" id="g-files" multiple accept=".pdf,image/*">
      </label>
      <h2>Question engine</h2>
      <div class="engine-row">
        <label class="engine-opt"><input type="radio" name="g-engine" value="builtin" checked>
          <span><strong>Built-in</strong> — offline &amp; instant: matches your terms against the bundled OpenStax A&amp;P glossary (CC&nbsp;BY) and writes definition, identification, and category questions</span></label>
        <label class="engine-opt" id="g-marcus-opt"><input type="radio" name="g-engine" value="marcus" disabled>
          <span><strong>Marcus</strong> — <span id="g-marcus-status">checking…</span></span></label>
      </div>
      <div id="g-marcus-model-row" hidden>
        <label>Marcus model <select id="g-marcus-model"></select></label>
      </div>
      <label class="engine-opt" id="g-filldefs-row" hidden><input type="checkbox" id="g-filldefs" checked>
        <span>Use Marcus to write definitions for terms the glossary doesn't know</span></label>
      <div class="btn-row"><button class="btn primary" id="g-run" disabled>Read files</button></div>
    </div>
    <div id="g-stage2"></div>
    <div class="card" id="g-log-card" hidden><h2>Progress</h2><pre id="g-log" class="gen-log"></pre></div>`;

  const $ = sel => view.querySelector(sel);
  const log = msg => {
    $('#g-log-card').hidden = false;
    $('#g-log').textContent += msg + '\n';
    $('#g-log').scrollTop = $('#g-log').scrollHeight;
  };
  const offProgress = native.onProgress(log);

  // Marcus availability + model picker (live from /api/models)
  native.marcus.models().then(info => {
    const status = $('#g-marcus-status');
    if (!info.reachable) {
      status.textContent = 'not reachable (needs David’s tailnet) — built-in mode only';
      return;
    }
    status.innerHTML = 'AI question writing on your own server (slower, varied phrasing)';
    $('#g-marcus-opt input').disabled = false;
    $('#g-filldefs-row').hidden = false;
    const sel = $('#g-marcus-model');
    sel.innerHTML = info.models
      .map(m => `<option value="${esc(m.id)}" ${m.id === info.current ? 'selected' : ''}>${esc(m.name)} — ${esc(m.blurb || '')}</option>`)
      .join('');
    view.querySelectorAll('[name=g-engine]').forEach(r =>
      r.addEventListener('change', () => { $('#g-marcus-model-row').hidden = $('input[name=g-engine]:checked').value !== 'marcus'; }));
  });

  $('#g-title').addEventListener('input', e => { if (!$('#g-id').dataset.touched) $('#g-id').value = slug(e.target.value); });
  $('#g-id').addEventListener('input', e => { e.target.dataset.touched = '1'; e.target.value = slug(e.target.value) || e.target.value.toLowerCase(); });
  $('#g-files').addEventListener('change', () => { $('#g-run').disabled = !$('#g-files').files.length; });

  $('#g-run').addEventListener('click', async () => {
    const files = [...$('#g-files').files];
    const title = $('#g-title').value.trim() || files[0].name.replace(/\.[^.]+$/, '');
    const id = $('#g-id').value.trim() || slug(title);
    if (!id) return alert('Set a quiz ID.');
    $('#g-run').disabled = true;
    try {
      await readFiles(view, { files, title, id, course: $('#g-course').value.trim(), log });
    } catch (err) {
      log(`ERROR: ${err.message}`);
      $('#g-run').disabled = false;
    }
  });

  // stash cleanup so navigating away stops progress events
  view.addEventListener('view:teardown', offProgress, { once: true });
}

// --- stage 1: read PDFs/images locally --------------------------------------

async function readFiles(view, ctx) {
  const { files, log } = ctx;
  let text = '';
  const pageImages = []; // {name, blob, thumbUrl, pdfRef:{file, pageNum}}

  for (const file of files) {
    if (/\.pdf$/i.test(file.name)) {
      log(`Reading ${file.name}…`);
      const lib = await loadPdfjs();
      const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        // group items into lines by their y position
        const rows = new Map();
        for (const item of content.items) {
          if (!item.str?.trim()) continue;
          const y = Math.round(item.transform[5] / 4) * 4;
          (rows.get(y) || rows.set(y, []).get(y)).push({ x: item.transform[4], str: item.str });
        }
        const lines = [...rows.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([, items]) => items.sort((a, b) => a.x - b.x).map(i => i.str).join(' ').trim());
        text += lines.join('\n') + '\n';

        // low-res thumbnail for the image picker; full render happens on save
        const thumb = await renderPage(page, 0.35);
        pageImages.push({
          name: `${slug(file.name.replace(/\.pdf$/i, ''))}-p${String(p).padStart(2, '0')}.png`,
          thumbUrl: thumb, page, pageNum: p, file: file.name,
        });
      }
      log(`  ${doc.numPages} page(s).`);
    } else {
      const url = URL.createObjectURL(file);
      pageImages.push({ name: file.name.toLowerCase().replace(/[^a-z0-9._-]/g, '_'), thumbUrl: url, blob: file, file: file.name });
    }
  }

  const parsed = parseTermsText(text);
  const terms = allTerms(parsed);
  log(`Found ${terms.length} terms in ${parsed.sections.length} sections: ${parsed.sections.map(s => s.title).join(' · ')}`);
  renderStage2(view, { ...ctx, terms, pageImages });
}

async function renderPage(page, scale) {
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width; canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  return canvas.toDataURL('image/png');
}

// --- stage 2: confirm terms + pick figure images, then generate -------------

function renderStage2(view, ctx) {
  const { terms, pageImages, log } = ctx;
  const stage = view.querySelector('#g-stage2');
  stage.innerHTML = `
    <div class="card">
      <h2>${terms.length} terms found — uncheck any that aren't study material</h2>
      <div class="term-grid">
        ${terms.map((t, i) => `<label class="term-chip"><input type="checkbox" data-term="${i}" checked> ${esc(t.name)} <span class="meta">${esc(t.topic)}</span></label>`).join('')}
      </div>
      ${pageImages.length ? `
      <h2>Keep figure images for pin questions? (tap pins on them later in teacher mode)</h2>
      <div class="page-grid">
        ${pageImages.map((im, i) => `<label class="page-pick"><input type="checkbox" data-img="${i}"><img src="${im.thumbUrl}" alt=""><span class="meta">${esc(im.file)}${im.pageNum ? ` p${im.pageNum}` : ''}</span></label>`).join('')}
      </div>` : ''}
      <div class="btn-row"><button class="btn primary" id="g-generate">Generate quiz</button></div>
    </div>`;

  stage.querySelector('#g-generate').addEventListener('click', async () => {
    stage.querySelector('#g-generate').disabled = true;
    const keepTerms = terms.filter((_, i) => stage.querySelector(`[data-term="${i}"]`).checked);
    const keepImages = pageImages.filter((_, i) => stage.querySelector(`[data-img="${i}"]`)?.checked);
    try {
      await generate(view, { ...ctx, terms: keepTerms, keepImages });
    } catch (err) {
      log(`ERROR: ${err.message}`);
      stage.querySelector('#g-generate').disabled = false;
    }
  });
}

async function generate(view, ctx) {
  const { terms, keepImages, title, id, course, log } = ctx;
  const engine = view.querySelector('input[name=g-engine]:checked').value;
  let questions = [];
  let unmatched = [];

  if (engine === 'marcus') {
    const model = view.querySelector('#g-marcus-model').value;
    await native.marcus.select(model);
    log(`Marcus (${model}) is writing one question per term — ${terms.length} terms…`);
    questions = await native.marcus.writeQuestions(terms);
    questions.forEach((q, i) => { q.id = `q${String(i + 1).padStart(3, '0')}`; });
    const covered = new Set(questions.map(q => q.options[q.correctIndex].toLowerCase()));
    unmatched = terms.filter(t => !covered.has(t.name.toLowerCase()));
    log(`Marcus wrote ${questions.length} questions (${unmatched.length} terms got none — rerun later or add by hand).`);
  } else {
    log('Matching terms against the OpenStax glossary…');
    const glossary = await native.glossary();
    let result = generateQuestions(terms, glossary);
    if (result.unmatched.length && view.querySelector('#g-filldefs')?.checked && !view.querySelector('#g-marcus-opt input').disabled) {
      log(`${result.unmatched.length} term(s) not in the glossary — asking Marcus for definitions…`);
      try {
        const defs = await native.marcus.fillDefs(result.unmatched.map(t => ({ name: t.name, topic: t.topic })));
        const withDefs = terms.map(t => (defs[t.name] ? { ...t, def: defs[t.name] } : t));
        result = generateQuestions(withDefs, glossary);
        log(`Marcus defined ${Object.keys(defs).length} of them.`);
      } catch (err) {
        log(`Marcus unavailable for definitions (${err.message}) — those terms stay manual.`);
      }
    }
    questions = result.questions;
    unmatched = result.unmatched;
    log(`Built ${questions.length} questions; ${unmatched.length} term(s) need a manual definition.`);
  }

  // full-res renders of kept figure pages
  const images = [];
  for (const im of keepImages) {
    let base64;
    if (im.blob) {
      base64 = btoa(String.fromCharCode(...new Uint8Array(await im.blob.arrayBuffer())));
    } else {
      const dataUrl = await renderPage(im.page, 1.6);
      base64 = dataUrl.split(',')[1];
    }
    images.push({ name: im.name, base64 });
  }

  const quiz = {
    id, title, course,
    description: `${questions.length} questions generated from ${ctx.files.length} file(s).`,
    created: new Date().toISOString().slice(0, 10),
    optionCount: 5,
    ...(images.length ? { imageCandidates: images.map(i => `images/${i.name}`) } : {}),
    questions,
  };
  await native.saveDraft(quiz, images);
  log('Saved.');

  const stage = view.querySelector('#g-stage2');
  stage.innerHTML = `
    <div class="card">
      <h1>“${esc(title)}” is ready — ${questions.length} questions</h1>
      ${unmatched.length ? `<p>${unmatched.length} term(s) had no definition source and got no questions: <em>${esc(unmatched.map(t => t.name).join(', '))}</em>. Add them in teacher mode.</p>` : ''}
      ${images.length ? `<p>${images.length} figure image(s) saved for pin questions — place pins in teacher mode.</p>` : ''}
      <div class="btn-row">
        <a class="btn primary" href="#/quiz/${encodeURIComponent(id)}">Take it now</a>
        <a class="btn" href="#/author?edit=${encodeURIComponent(id)}">Review in teacher mode</a>
      </div>
    </div>`;
}
