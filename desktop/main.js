// Quiz Studio desktop shell. Loads the same static site, but quiz data comes
// from the filesystem: quizzes bundled with the app plus any the user imports
// (stored under userData/quizzes, surviving app updates).
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { pathToFileURL } = require('url');
const extractZip = require('extract-zip');

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

  // automated UI verification: --screenshot=/path.png [--route="#/..."] captures and quits
  const shotArg = process.argv.find(a => a.startsWith('--screenshot='));
  if (shotArg) {
    const routeArg = process.argv.find(a => a.startsWith('--route='));
    win.webContents.once('did-finish-load', async () => {
      if (routeArg) {
        await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(routeArg.split('=')[1])}`);
      }
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(shotArg.split('=')[1], img.toPNG());
        app.quit();
      }, 1200);
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
