const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quizStudioNative', {
  listQuizzes: () => ipcRenderer.invoke('quizzes:index'),
  readQuiz: id => ipcRenderer.invoke('quizzes:read', id),
});

// after File → Import Quiz…, refresh whatever view is showing
ipcRenderer.on('quizzes:changed', () => {
  location.hash = '#/';
  location.reload();
});
