// Quiz validation — JS mirror of tools/validate.py, run at every boundary
// that creates or accepts a quiz (teacher-mode save/export, Generate, desktop
// zip import). publish.sh still runs the python version for the website repo.

export function validateQuiz(quiz) {
  const problems = [];
  if (!quiz || typeof quiz !== 'object') return ['not a quiz object'];
  if (!quiz.id || !/^[a-z0-9][a-z0-9-]*$/.test(quiz.id)) problems.push(`id "${quiz.id}" must be lowercase letters/digits/hyphens (and start with a letter or digit)`);
  if (!quiz.title) problems.push('missing title');
  if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    problems.push('quiz has no questions');
    return problems;
  }
  const optCount = quiz.optionCount ?? 5;
  if (!Number.isInteger(optCount) || optCount < 2 || optCount > 8) problems.push(`optionCount ${optCount} out of range 2-8`);

  const ids = new Set();
  const pinAnswers = quiz.questions.filter(q => q.type === 'pin').length;
  quiz.questions.forEach((q, i) => {
    const where = `question ${i + 1} (${q.id || '?'})`;
    if (!q.id || ids.has(q.id)) problems.push(`${where}: missing or duplicate id`);
    ids.add(q.id);
    if (!q.topic) problems.push(`${where}: missing topic (needed for the weak-area report)`);
    if (q.type === 'mc') {
      if (!q.prompt) problems.push(`${where}: missing question text`);
      if (!Array.isArray(q.options) || q.options.length !== optCount) {
        problems.push(`${where}: has ${q.options?.length ?? 0} options, quiz needs ${optCount}`);
      } else if (new Set(q.options.map(o => String(o).trim().toLowerCase())).size !== q.options.length) {
        problems.push(`${where}: duplicate options`);
      }
      if (!Number.isInteger(q.correctIndex) || !q.options || q.correctIndex < 0 || q.correctIndex >= q.options.length) {
        problems.push(`${where}: correctIndex ${q.correctIndex} is not a valid option index`);
      }
    } else if (q.type === 'pin') {
      if (!q.answer) problems.push(`${where}: pin needs a structure name`);
      if (!q.image || /["'<>]/.test(q.image)) problems.push(`${where}: bad image path`);
      const p = q.pin || {};
      if (!(typeof p.x === 'number' && typeof p.y === 'number' && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) {
        problems.push(`${where}: pin x/y must be numbers in 0-1`);
      }
      if (pinAnswers < optCount && !(Array.isArray(q.distractorPool) && q.distractorPool.length)) {
        problems.push(`${where}: only ${pinAnswers} pin answers in the quiz but ${optCount} choices needed — add a distractorPool or more pins`);
      }
    } else {
      problems.push(`${where}: type must be "mc" or "pin", got "${q.type}"`);
    }
  });
  return problems;
}
