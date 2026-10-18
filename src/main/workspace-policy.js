// Workspace policy: whether this build has one workspace or several. The Semrush package turns on single mode in
// package.json (`studioWorkspace`); STUDIO_WORKSPACE_MODE (single | multi) and STUDIO_WORKSPACE_NAME override it, mainly
// for the browser studio and development. In single mode the studio keeps exactly one workspace of the package's edition,
// shown as `name` (Main); every other workspace is hidden, never deleted (content-workspace.js migrateWorkspacePolicy).
const MODES = ['single', 'multi'];
const EDITIONS = ['semrush', 'general'];

function resolveWorkspacePolicy({ packageConfig = {}, env = process.env } = {}) {
  const cfg = packageConfig && typeof packageConfig.studioWorkspace === 'object' && packageConfig.studioWorkspace ? packageConfig.studioWorkspace : {};
  const fromEnv = String(env?.STUDIO_WORKSPACE_MODE || '').trim().toLowerCase();
  const mode = MODES.includes(fromEnv) ? fromEnv : cfg.mode === 'single' ? 'single' : 'multi';
  const editionId = EDITIONS.includes(cfg.editionId) ? cfg.editionId : packageConfig?.studioDefaultWorkspace === 'general' ? 'general' : 'semrush';
  const id = /^[a-z0-9-]{1,40}$/.test(String(cfg.id || '')) ? cfg.id : editionId;
  const raw = String(env?.STUDIO_WORKSPACE_NAME ?? cfg.name ?? 'Main').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
  return Object.freeze({ mode, id, editionId, name: raw || 'Main' });
}

module.exports = { resolveWorkspacePolicy };
