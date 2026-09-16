const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function ensureWorkspace(root, projectId = 'default') {
  const workspaceDir = path.join(root, projectId);
  fs.mkdirSync(workspaceDir, { recursive: true });

  if (!fs.existsSync(path.join(workspaceDir, '.git'))) {
    try {
      execFileSync('git', ['init'], { cwd: workspaceDir, stdio: 'ignore' });
    } catch (_) {
      // ponytail: Codex can still run with --skip-git-repo-check later if git is unavailable.
    }
  }

  return workspaceDir;
}

function safeFilename(value) {
  return String(value || 'file').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) || 'file';
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
