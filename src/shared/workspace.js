const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

function ensureWorkspace(root, projectId = 'default') {
  const workspaceDir = path.join(root, projectId);
  fs.mkdirSync(workspaceDir, { recursive: true });

  if (!fs.existsSync(path.join(workspaceDir, '.git'))) {
    try {
      // windowsHide: on Windows, without it git opens a console window over the app.
      childProcess.execFileSync('git', ['init'], { cwd: workspaceDir, stdio: 'ignore', windowsHide: true });
    } catch (_) {
      // ponytail: Codex can still run with --skip-git-repo-check later if git is unavailable.
    }
  }

  return workspaceDir;
}

// Letters, digits, dots, dashes and underscores, never starting or ending in a dot or dash (so never '.' or '..'). A
// Windows device name (CON, NUL, COM1…, with or without an extension), which Explorer can't open or delete, gets a
// leading underscore.
function safeFilename(value) {
  const base = String(value || 'file').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 80).replace(/^[-.]+|[-.]+$/g, '') || 'file';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(base) ? `_${base}` : base;
}

function isPathInside(root, filePath) {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

module.exports = {
  ensureWorkspace,
  isPathInside,
  safeFilename,
};
