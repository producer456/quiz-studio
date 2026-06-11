import { renderCatalog } from './catalog.js';
import { renderPlayer } from './player.js';
import { renderAuthor } from './author.js';

const view = document.getElementById('view');
const topbarContext = document.getElementById('topbar-context');

export function setContext(text) { topbarContext.textContent = text || ''; }

async function route() {
  const hash = location.hash || '#/';
  const [, path, arg] = hash.match(/^#\/([^/]*)\/?(.*)$/) || [];
  view.innerHTML = '';
  setContext('');
  window.scrollTo(0, 0);
  try {
    if (path === 'quiz' && arg) await renderPlayer(view, decodeURIComponent(arg));
    else if (path === 'author') await renderAuthor(view);
    else await renderCatalog(view);
  } catch (err) {
    view.innerHTML = `<div class="card error"><h2>Something broke</h2><p>${err.message}</p><p><a href="#/">Back to all quizzes</a></p></div>`;
    console.error(err);
  }
}

window.addEventListener('hashchange', route);
route();
