import { renderCatalog } from './catalog.js';
import { renderPlayer } from './player.js';
import { renderAuthor } from './author.js';
import { renderGenerate } from './generate.js';

const view = document.getElementById('view');
const topbarContext = document.getElementById('topbar-context');

export function setContext(text) { topbarContext.textContent = text || ''; }

async function route() {
  const hash = location.hash || '#/';
  let [, path, arg] = hash.match(/^#\/([^/]*)\/?(.*)$/) || [];
  let query = '';
  if (path && path.includes('?')) [path, query] = [path.slice(0, path.indexOf('?')), path.slice(path.indexOf('?') + 1)];
  view.dispatchEvent(new Event('view:teardown'));
  view.innerHTML = '';
  setContext('');
  window.scrollTo(0, 0);
  try {
    if (path === 'quiz' && arg) await renderPlayer(view, decodeURIComponent(arg));
    else if (path === 'author') await renderAuthor(view, new URLSearchParams(query));
    else if (path === 'generate') await renderGenerate(view);
    else await renderCatalog(view);
  } catch (err) {
    view.innerHTML = `<div class="card error"><h2>Something broke</h2><p>${err.message}</p><p><a href="#/">Back to all quizzes</a></p></div>`;
    console.error(err);
  }
}

window.addEventListener('hashchange', route);
route();
