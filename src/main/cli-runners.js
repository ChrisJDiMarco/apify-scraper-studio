'use strict';
// The two subscription connections, Claude Code and Codex, as text runners with the same contract as the API runners:
// run({ schema, prompt, model, effort, maxBudgetUsd, timeoutMs, workspaceDir, outputPath, jobId, onDelta }) →
// { output, receipt, stdout, stderr }. Behavior is what index.js did before Model routing, plus Codex's model and
// reasoning level and Claude Code's realtime answer (stream-json) when someone is watching it arrive. Electron-free:
// index.js injects spawnCli (its spawnCodex: no saved key reaches a CLI, a job id registers the process for Cancel).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildClaudeCommand, parseClaudeResult, modelMatches, readClaudeCost, claudeStreamText, DEFAULT_CLAUDE_MODEL } = require('../shared/claude-runner');
const { buildCodexCommand } = require('../shared/codex-runner');

const CODEX_COST_BASIS = 'Codex reports no cost; it uses your ChatGPT plan or the key Codex signed in with';

// A quick, free CLI call for status checks (version, sign-in): resolves { code, stdout, stderr }, or { missing: true } when
// the command isn't installed. Never throws.
function createCliProbe({ spawn, env = () => ({ ...process.env }), timeoutMs = 10000 }) {
  return (command, args, options = {}) => new Promise((resolve) => {
    let child; let stdout = ''; let stderr = ''; let settled = false;
    const done = (result) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
    try { child = spawn(command, args, { env: env(), cwd: options.cwd }); } catch (error) { resolve({ missing: error?.code === 'ENOENT', code: null, stdout: '', stderr: String(error?.message || error) }); return; }
    const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch (_) { /* gone */ } done({ code: null, stdout, stderr, timedOut: true }); }, options.timeoutMs || timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => done({ missing: error?.code === 'ENOENT', code: null, stdout, stderr: stderr || String(error?.message || error) }));
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

// Splits streamed stdout into lines and hands each event line's answer text to onDelta.
function lineReader(onLine) {
  let buffer = '';
  return (chunk) => {
    buffer += String(chunk);
    let cut;
    while ((cut = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, cut).trim(); buffer = buffer.slice(cut + 1); if (line) onLine(line); }
  };
}

// cliInfo() (optional, async) → { streaming: boolean } for the installed Claude Code (ai-routes detectClaudeCli).
function createClaudeCliRunner({ spawnCli, writeJson, cliInfo = async () => ({}) }) {
  async function run({ schema, prompt, cachePrefix = '', model, effort, maxBudgetUsd = 1, timeoutMs, workspaceDir, outputPath, jobId, onDelta }) {
    const requestedModel = model || DEFAULT_CLAUDE_MODEL;
    const text = cachePrefix ? cachePrefix + prompt : prompt;
    let stream = false;
    if (typeof onDelta === 'function') { try { stream = Boolean((await cliInfo())?.streaming); } catch (_) { stream = false; } }
    const invocation = buildClaudeCommand({ model: requestedModel, maxBudgetUsd, schema, prompt: text, effort, stream });
    const onStdout = stream ? lineReader((line) => { const piece = claudeStreamText(line); if (piece) { try { onDelta(piece); } catch (_) { /* courtesy */ } } }) : undefined;
    let result;
    try { result = await spawnCli(invocation.command, invocation.args, workspaceDir, { jobId, stdin: invocation.stdin, providerLabel: 'Claude', ...(timeoutMs ? { timeoutMs } : {}), keepStdoutOnError: true, ...(onStdout ? { onStdout } : {}) }); }
    catch (error) { if (error.stdout) { const costUsd = readClaudeCost(error.stdout); try { parseClaudeResult(error.stdout); } catch (detail) { detail.costUsd = costUsd; throw detail; } error.costUsd = costUsd; } throw error; }
    const parsed = parseClaudeResult(result.stdout);
    if (!modelMatches(requestedModel, parsed.actualModels)) throw Object.assign(new Error(`Claude returned an unverified or different model (${parsed.actualModels.join(', ') || 'not reported'}). No fallback answer was saved.`), { code: 'AI_MODEL_MISMATCH', costUsd: parsed.costUsd });
    if (outputPath) writeJson(outputPath, parsed.output);
    return { ...result, output: parsed.output, receipt: { provider: 'claude', requestedModel, actualModel: parsed.actualModel, actualModels: parsed.actualModels, effort: effort || '', costUsd: parsed.costUsd, usage: parsed.usage, durationMs: parsed.durationMs, costBasis: 'CLI-reported list cost; subscription billing may differ' } };
  }
  return { run };
}

// Codex is a shell agent, and the studio's data folder holds every person's Ask AI conversations and memory. So it runs
// in an empty private folder outside the data folder, gets the prompt on stdin (no prompt file is written anywhere), has
// its tools off and a read-only sandbox (codex-runner.js), and its answer is copied to outputPath here.
// support() → codexExecSupport flags; ignoreUserConfig() → skip the CLI's own config; wrapper(text) → the Codex framing;
// efforts(model) → the reasoning levels Codex lists for a model (null when unknown).
function createCodexRunner({ spawnCli, writeJson, support = async () => ({}), ignoreUserConfig = () => false, wrapper = (text) => text, efforts = () => null, tmpdir = os.tmpdir }) {
  async function run({ schema, prompt, cachePrefix = '', model = '', effort = '', timeoutMs, outputPath, jobId }) {
    const text = cachePrefix ? cachePrefix + prompt : prompt;
    const levels = efforts(model);
    const chosen = effort && (!Array.isArray(levels) || levels.includes(effort)) ? effort : '';
    const effortNote = effort && !chosen ? `${model || 'This Codex model'} doesn’t offer ${effort} reasoning, so it ran at its default.` : '';
    const isolated = fs.mkdtempSync(path.join(tmpdir(), 'studio-codex-'));
    try {
      const schemaPath = path.join(isolated, 'output.schema.json'); const answerPath = path.join(isolated, 'answer.json');
      fs.writeFileSync(schemaPath, JSON.stringify(schema), { mode: 0o600 });
      const invocation = buildCodexCommand({ workspaceDir: isolated, schemaPath, outputPath: answerPath, isolated: true, support: await support(), ignoreUserConfig: ignoreUserConfig(), model, effort: chosen });
      const result = await spawnCli(invocation.command, invocation.args, isolated, { jobId, stdin: `${wrapper('the text below')}\n\n${text}`, providerLabel: 'Codex', ...(timeoutMs ? { timeoutMs } : {}) });
      const raw = fs.existsSync(answerPath) ? fs.readFileSync(answerPath, 'utf8') : '';
      let output = null; try { output = raw ? JSON.parse(raw) : null; } catch (_) { output = null; }
      if (outputPath) { if (output !== null) writeJson(outputPath, output); else if (raw) fs.writeFileSync(outputPath, raw); } // kept for the receipt
      return { ...result, output, receipt: { provider: 'codex', requestedModel: model || 'CLI configuration', actualModel: '', costUsd: null, ...(chosen ? { effort: chosen } : {}), ...(effortNote ? { effortNote } : {}), ...(codexUsage(result.stdout) ? { usage: codexUsage(result.stdout) } : {}), costBasis: CODEX_COST_BASIS } };
    } finally { fs.rmSync(isolated, { recursive: true, force: true }); }
  }
  return { run };
}
// Token counts from Codex's --json events, when it reports them (no cost; still unmetered).
function codexUsage(stdout) {
  let usage = null;
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line.includes('usage') && !line.includes('token')) continue;
    let event; try { event = JSON.parse(line); } catch (_) { continue; }
    const found = event?.usage || event?.msg?.usage || event?.payload?.usage || event?.info?.total_token_usage || event?.msg?.info?.total_token_usage;
    if (found && typeof found === 'object') usage = { input_tokens: Number(found.input_tokens) || 0, output_tokens: Number(found.output_tokens) || 0, ...(Number.isFinite(found.cached_input_tokens) ? { cached_input_tokens: found.cached_input_tokens } : {}), ...(Number.isFinite(found.reasoning_output_tokens) ? { reasoning_output_tokens: found.reasoning_output_tokens } : {}) };
  }
  return usage && (usage.input_tokens || usage.output_tokens) ? usage : null;
}

module.exports = { createCliProbe, createClaudeCliRunner, createCodexRunner, codexUsage, lineReader, CODEX_COST_BASIS };
