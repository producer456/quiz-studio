const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quizStudioNative', {
  listQuizzes: () => ipcRenderer.invoke('quizzes:index'),
  readQuiz: id => ipcRenderer.invoke('quizzes:read', id),
  saveDraft: (quiz, images) => ipcRenderer.invoke('quizzes:saveDraft', { quiz, images }),
  deleteQuiz: id => ipcRenderer.invoke('quizzes:delete', id),
  glossary: () => ipcRenderer.invoke('glossary:get'),
  marcus: {
    models: () => ipcRenderer.invoke('marcus:models'),
    select: id => ipcRenderer.invoke('marcus:select', id),
    fillDefs: terms => ipcRenderer.invoke('marcus:fillDefs', terms),
    writeQuestions: terms => ipcRenderer.invoke('marcus:writeQuestions', terms),
  },
  onProgress: cb => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('gen:progress', listener);
    return () => ipcRenderer.removeListener('gen:progress', listener);
  },
});

// after File → Import Quiz…, refresh whatever view is showing
ipcRenderer.on('quizzes:changed', () => {
  location.hash = '#/';
  location.reload();
});
