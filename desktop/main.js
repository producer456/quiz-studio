// Quiz Studio desktop shell. Loads the same static site, but quiz data comes
// from the filesystem: quizzes bundled with the app plus any the user imports
// (stored under userData/quizzes, surviving app updates).
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { pathToFileURL } = require('url');
const extractZip = require('extract-zip');
const marcus = require('./marcus.js');

const SITE_URL = 'https://producer456.github.io/quiz-studio/';

function bundledQuizzesDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'quizzes')
    : path.join(__dirname, '..', 'quizzes');
}
function importedQuizzesDir() {
  return path.join(app.getPath('userData'), 'quizzes');
}

async function readQuizDirs() {
  // imported quizzes win on id clash so a re-shared fixed quiz replaces the bundled one
  const found = new Map();
  for (const root of [bundledQuizzesDir(), importedQuizzesDir()]) {
    let entries = [];
    try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name);
      try {
        const quiz = JSON.parse(await fsp.readFile(path.join(dir, 'quiz.json'), 'utf8'));
        if (quiz.id === e.name) found.set(quiz.id, { quiz, dir });
      } catch { /* not a quiz folder */ }
    }
  }
  return found;
}

ipcMain.handle('quizzes:index', async () => {
  const found = await readQuizDirs();
  const quizzes = [...found.values()].map(({ quiz }) => ({
    id: quiz.id,
    title: quiz.title || quiz.id,
    course: quiz.course || '',
    description: quiz.description || '',
    created: quiz.created || '',
    questionCount: (quiz.questions || []).length,
    hasPins: (quiz.questions || []).some(q => q.type === 'pin'),
  }));
  quizzes.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  return { quizzes };
});

ipcMain.handle('quizzes:read', async (_e, id) => {
  const found = await readQuizDirs();
  const hit = found.get(id);
  if (!hit) throw new Error(`No quiz "${id}"`);
  return { quiz: hit.quiz, base: pathToFileURL(hit.dir).href };
});

// Save a quiz (from the Generate flow or teacher-mode edits) into the user's
// quiz folder. images: [{name, base64}] land in <id>/images/. When the quiz
// previously lived elsewhere (bundled copy being edited), its images are
// carried over so file references keep resolving.
ipcMain.handle('quizzes:saveDraft', async (_e, { quiz, images }) => {
  if (!quiz?.id || !/^[a-z0-9][a-z0-9-]*$/.test(quiz.id)) throw new Error('quiz needs a valid id');
  const dir = path.join(importedQuizzesDir(), quiz.id);
  const prior = (await readQuizDirs()).get(quiz.id);
  await fsp.mkdir(path.join(dir, 'images'), { recursive: true });
  if (prior && prior.dir !== dir && fs.existsSync(path.join(prior.dir, 'images'))) {
    await fsp.cp(path.join(prior.dir, 'images'), path.join(dir, 'images'), { recursive: true, force: false }).catch(() => {});
  }
  await fsp.writeFile(path.join(dir, 'quiz.json'), JSON.stringify(quiz, null, 2) + '\n');
  for (const img of images || []) {
    const safe = path.basename(img.name);
    await fsp.writeFile(path.join(dir, 'images', safe), Buffer.from(img.base64, 'base64'));
  }
  return { saved: true, dir };
});

ipcMain.handle('quizzes:delete', async (_e, id) => {
  const dir = path.join(importedQuizzesDir(), path.basename(id));
  await fsp.rm(dir, { recursive: true, force: true });
  return { deleted: true };
});

ipcMain.handle('glossary:get', async () => {
  return JSON.parse(await fsp.readFile(path.join(__dirname, 'glossary.json'), 'utf8'));
});

// --- Marcus (optional AI assist) -------------------------------------------
const genEmit = e => msg => e.sender.send('gen:progress', msg);
ipcMain.handle('marcus:models', () => marcus.listModels());
ipcMain.handle('marcus:select', (e, id) => marcus.selectModel(id, genEmit(e)));
ipcMain.handle('marcus:fillDefs', (e, terms) => marcus.fillDefinitions(terms, genEmit(e)));
ipcMain.handle('marcus:writeQuestions', (e, terms) => marcus.writeQuestions(terms, genEmit(e)));

async function importQuizZips(win) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import quiz',
    filters: [{ name: 'Quiz zip', extensions: ['zip'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (canceled || !filePaths.length) return;

  const results = [];
  for (const zipPath of filePaths) {
    const tmp = await fsp.mkdtemp(path.join(app.getPath('temp'), 'quiz-import-'));
    try {
      await extractZip(zipPath, { dir: tmp });
      // accept <id>/quiz.json at the zip root, or quiz.json directly at root
      const candidates = [];
      for (const e of await fsp.readdir(tmp, { withFileTypes: true })) {
        if (e.isDirectory() && fs.existsSync(path.join(tmp, e.name, 'quiz.json'))) {
          candidates.push(path.join(tmp, e.name));
        }
      }
      if (!candidates.length && fs.existsSync(path.join(tmp, 'quiz.json'))) candidates.push(tmp);
      if (!candidates.length) throw new Error('no quiz.json inside the zip');

      for (const src of candidates) {
        const quiz = JSON.parse(await fsp.readFile(path.join(src, 'quiz.json'), 'utf8'));
        if (!quiz.id || !Array.isArray(quiz.questions)) throw new Error('quiz.json missing id/questions');
        const dest = path.join(importedQuizzesDir(), quiz.id);
        await fsp.rm(dest, { recursive: true, force: true });
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.cp(src, dest, { recursive: true });
        results.push(`✓ ${quiz.title || quiz.id} (${quiz.questions.length} questions)`);
      }
    } catch (err) {
      results.push(`✗ ${path.basename(zipPath)}: ${err.message}`);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  }
  await dialog.showMessageBox(win, { message: 'Import finished', detail: results.join('\n') });
  win.webContents.send('quizzes:changed');
}

function buildMenu(win) {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Import Quiz…', accelerator: 'CmdOrCtrl+I', click: () => importQuizZips(win) },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: 'Help',
      submenu: [{ label: 'Quiz Studio website', click: () => shell.openExternal(SITE_URL) }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 820,
    backgroundColor: '#0f1419',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  buildMenu(win);
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // automated UI verification:
  //   --screenshot=/path.png [--route="#/..."]  capture a view and quit
  //   --exec=/path.js                           run a script in the page, wait
  //                                             for window.__testDone, then
  //                                             screenshot (if asked) and quit
  const argval = name => {
    const a = process.argv.find(x => x.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3) : null;
  };
  const shotPath = argval('screenshot');
  const execPath = argval('exec');
  if (shotPath || execPath) {
    win.webContents.once('did-finish-load', async () => {
      const route = argval('route');
      if (route) await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(route)}`);
      await new Promise(r => setTimeout(r, 1200));
      if (execPath) {
        await win.webContents.executeJavaScript(fs.readFileSync(execPath, 'utf8')).catch(e => console.error('exec error:', e.message));
        const deadline = Date.now() + 12 * 60 * 1000;
        while (Date.now() < deadline) {
          const done = await win.webContents.executeJavaScript('window.__testDone || null').catch(() => null);
          if (done) { console.log('E2E:', typeof done === 'string' ? done : JSON.stringify(done)); break; }
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      if (shotPath) {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(shotPath, img.toPNG());
      }
      app.quit();
    });
  }
  return win;
}

app.whenReady().then(() => {
  fs.mkdirSync(importedQuizzesDir(), { recursive: true });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
