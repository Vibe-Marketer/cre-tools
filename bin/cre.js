#!/usr/bin/env node
'use strict';

// cre — the convenience CLI for the LoopNet + Reonomy CRE toolsets.
// Node built-ins only; no framework; simple arg switch.
// Commands: setup | login | doctor | status | mcp install | --version | help

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const {
  isWindows,
  vendoredFileName,
  resolveExecutable,
  vendoredBinaryPath,
  readPackageVersion,
} = require('../scripts/platform.js');
const { ensureBinaries } = require('../scripts/download.js');

// ---------------------------------------------------------------------------
// Binary execution
// ---------------------------------------------------------------------------

/**
 * Run a wrapped native binary interactively (inherited stdio).
 * @param {string} logicalName one of platform.BINARY_NAMES
 * @param {string[]} args
 * @returns {number} the child's exit code (1 on spawn failure)
 */
function runInteractive(logicalName, args) {
  const { command } = resolveExecutable(logicalName);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      console.error(
        `cre: could not find "${logicalName}".\n` +
          `  Looked for: ${vendoredBinaryPath(logicalName)}\n` +
          '  Reinstall to fetch binaries: bun add -g github:Vibe-Marketer/cre-tools'
      );
    } else {
      console.error(`cre: failed to run "${logicalName}" (${command}): ${result.error.message}`);
    }
    return 1;
  }
  return result.status === null ? 1 : result.status;
}

/**
 * Run a wrapped native binary and capture stdout (for doctor --json).
 * @param {string} logicalName
 * @param {string[]} args
 * @returns {{ ok: boolean, stdout: string, error?: string }}
 */
function runCapture(logicalName, args) {
  const { command } = resolveExecutable(logicalName);
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) {
    const why =
      result.error.code === 'ENOENT'
        ? `binary not found (looked for ${vendoredBinaryPath(logicalName)})`
        : result.error.message;
    return { ok: false, stdout: '', error: why };
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    // Non-zero exit still may carry parseable JSON on stdout; return both.
    return { ok: false, stdout: result.stdout || '', error: `exited with code ${result.status}` };
  }
  return { ok: true, stdout: result.stdout || '' };
}

// ---------------------------------------------------------------------------
// Chrome detection
// ---------------------------------------------------------------------------

/**
 * Detect whether Google Chrome (or Chromium on Linux) is installed.
 * @returns {boolean}
 */
function detectChrome() {
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app',
      path.join(os.homedir(), 'Applications', 'Google Chrome.app'),
    ];
    return candidates.some(pathExists);
  }
  if (process.platform === 'win32') {
    const roots = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA,
    ].filter(Boolean);
    return roots.some((root) =>
      pathExists(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    );
  }
  // Linux (and any other POSIX): look for a chrome/chromium executable on PATH.
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].some(
    isOnPath
  );
}

function pathExists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve an executable on PATH without shelling out a parser. Scans PATH dirs.
 * @param {string} name
 */
function isOnPath(name) {
  const pathEnv = process.env.PATH || '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    if (pathExists(path.join(dir, name))) {
      return true;
    }
  }
  return false;
}

function requireChromeOrExit() {
  if (detectChrome()) {
    return;
  }
  console.error(
    'cre: Google Chrome was not found on this machine.\n' +
      '  Both LoopNet and Reonomy log in by driving a real Chrome window.\n' +
      '  Install Chrome, then re-run: https://www.google.com/chrome'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// JSON config merge (atomic, non-clobbering)
// ---------------------------------------------------------------------------

/**
 * Read a JSON file. Returns { data, malformed }. Missing file -> { data: {} }.
 * Malformed JSON -> backs up to <file>.bak and returns { data: {}, malformed: true }.
 * @param {string} filePath
 */
function readJsonConfig(filePath) {
  if (!pathExists(filePath)) {
    return { data: {}, malformed: false, existed: false };
  }
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Could not read ${filePath}: ${err.message}`);
  }
  if (raw.trim().length === 0) {
    return { data: {}, malformed: false, existed: true };
  }
  try {
    const parsed = JSON.parse(raw);
    // A top-level array or scalar is not a valid settings object; treat as malformed.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('top-level JSON value is not an object');
    }
    return { data: parsed, malformed: false, existed: true };
  } catch (err) {
    const backup = `${filePath}.bak`;
    try {
      fs.copyFileSync(filePath, backup);
      console.log(`  ! ${filePath} was malformed JSON — backed up to ${backup} before writing.`);
    } catch (copyErr) {
      console.log(`  ! ${filePath} was malformed JSON and could not be backed up: ${copyErr.message}`);
    }
    return { data: {}, malformed: true, existed: true };
  }
}

/**
 * Atomically write JSON: write to a temp file in the same dir, then rename.
 * @param {string} filePath
 * @param {object} data
 */
function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.cre-tmp-${process.pid}-${Date.now()}`);
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  try {
    fs.writeFileSync(tmp, serialized, 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore cleanup failure
    }
    throw new Error(`Could not write ${filePath}: ${err.message}`);
  }
}

/**
 * Merge the two MCP server entries into an existing config object without
 * clobbering anything else under mcpServers or elsewhere.
 * @param {object} config
 * @returns {object} the mutated config
 */
function mergeMcpServers(config) {
  if (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
    config.mcpServers = {};
  }
  config.mcpServers.loopnet = { command: vendoredBinaryPath('loopnet-pp-mcp') };
  config.mcpServers.reonomy = { command: vendoredBinaryPath('reonomy-pp-mcp') };
  return config;
}

function claudeCodeSettingsPath() {
  // Same location on every OS: <home>/.claude/settings.json
  return path.join(os.homedir(), '.claude', 'settings.json');
}

/**
 * Resolve the Claude Desktop config path for this OS, or null if unsupported.
 */
function claudeDesktopConfigPath() {
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json'
    );
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) {
      return null;
    }
    return path.join(appData, 'Claude', 'claude_desktop_config.json');
  }
  // Linux: best-effort standard XDG-ish location.
  return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

/**
 * Merge MCP entries into both Claude Code settings and (if present) Claude Desktop.
 * Returns the list of files that were updated.
 * @returns {string[]}
 */
function installMcpServers() {
  const updated = [];

  // Claude Code — always create/merge (its dir is safe to create).
  const codePath = claudeCodeSettingsPath();
  const code = readJsonConfig(codePath);
  writeJsonAtomic(codePath, mergeMcpServers(code.data));
  console.log(`  ✓ Claude Code settings updated: ${codePath}`);
  updated.push(codePath);

  // Claude Desktop — only if the config file's parent dir already exists.
  const desktopPath = claudeDesktopConfigPath();
  if (!desktopPath) {
    console.log('  · Claude Desktop config path is unknown on this OS — skipping.');
  } else if (!pathExists(path.dirname(desktopPath))) {
    console.log(`  · Claude Desktop not detected (${path.dirname(desktopPath)} absent) — skipping.`);
  } else {
    const desktop = readJsonConfig(desktopPath);
    writeJsonAtomic(desktopPath, mergeMcpServers(desktop.data));
    console.log(`  ✓ Claude Desktop config updated: ${desktopPath}`);
    updated.push(desktopPath);
  }

  if (updated.length > 0) {
    console.log('  Restart Claude (Code and/or Desktop) to load the new MCP servers.');
  }
  return updated;
}

// ---------------------------------------------------------------------------
// doctor parsing
// ---------------------------------------------------------------------------

/**
 * Run "<tool> doctor --json", parse defensively, and report a connected/failed line.
 * @param {string} logicalName one of the *-pp-cli logical names
 * @param {string} label human label, e.g. "LoopNet"
 * @returns {{ connected: boolean, detail: string }}
 */
function checkDoctor(logicalName, label) {
  const captured = runCapture(logicalName, ['doctor', '--json']);
  if (!captured.stdout || captured.stdout.trim().length === 0) {
    return {
      connected: false,
      detail: captured.error
        ? `${label}: could not run doctor (${captured.error})`
        : `${label}: doctor produced no output`,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(captured.stdout);
  } catch {
    return {
      connected: false,
      detail: `${label}: doctor output was not valid JSON — run \`${vendoredFileName(logicalName)} doctor\` directly to see the raw status`,
    };
  }

  const authed = extractAuthState(parsed);
  if (authed === true) {
    return { connected: true, detail: `${label} connected` };
  }
  if (authed === false) {
    return {
      connected: false,
      detail: `${label}: not authenticated — run \`cre login\``,
    };
  }
  // Shape we didn't recognize — surface it rather than guess.
  return {
    connected: false,
    detail: `${label}: doctor returned an unrecognized status shape — run \`${vendoredFileName(logicalName)} doctor\` to inspect`,
  };
}

/**
 * Pull an auth/connectivity boolean out of a doctor JSON payload defensively.
 * Returns true/false when confident, or null when the shape is unknown.
 * @param {any} payload
 * @returns {boolean|null}
 */
function extractAuthState(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  // The shipped Go doctors emit a string "auth" field, e.g.:
  //   loopnet:  "auth": "not required"
  //   reonomy:  "auth": "configured"   (also "auth_source", "credentials")
  // Treat these string states as authoritative when present.
  if (typeof payload.auth === 'string') {
    const a = payload.auth.toLowerCase();
    if (['not required', 'configured', 'present', 'ok', 'valid', 'authenticated'].includes(a)) {
      return true;
    }
    if (
      ['missing', 'not configured', 'expired', 'unauthorized', 'unauthenticated', 'invalid', 'required'].includes(a)
    ) {
      return false;
    }
  }

  // Reonomy's fresh-machine doctor can report missing auth through env_vars:
  // "ERROR missing required: REONOMY_TOKEN".
  if (typeof payload.env_vars === 'string') {
    const e = payload.env_vars.toLowerCase();
    if (e.includes('missing required') || e.includes('missing')) {
      return false;
    }
  }

  // "credentials": "present (...)" — Reonomy reports presence here too.
  if (typeof payload.credentials === 'string') {
    const c = payload.credentials.toLowerCase();
    if (c.startsWith('present')) {
      return true;
    }
    if (c.startsWith('missing') || c.startsWith('none')) {
      return false;
    }
  }

  // Boolean field names a future doctor build might emit.
  const truthyKeys = ['authenticated', 'authed', 'logged_in', 'loggedIn', 'ok', 'connected'];
  for (const key of truthyKeys) {
    if (typeof payload[key] === 'boolean') {
      return payload[key];
    }
  }

  // Nested under an object container (forward-compat for a restructured doctor).
  if (payload.status && typeof payload.status === 'object') {
    const nested = extractAuthState(payload.status);
    if (nested !== null) {
      return nested;
    }
  }

  // A string "status" like "ok"/"connected"/"authenticated".
  if (typeof payload.status === 'string') {
    const s = payload.status.toLowerCase();
    if (['ok', 'connected', 'authenticated', 'healthy'].includes(s)) {
      return true;
    }
    if (['unauthenticated', 'unauthorized', 'expired', 'error', 'failed'].includes(s)) {
      return false;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function commandLogin() {
  console.log('Opening Chrome for LoopNet — log in normally; it captures automatically.');
  const loopnetCode = runInteractive('loopnet-pp-cli', ['auth', 'login']);
  if (loopnetCode !== 0) {
    console.error(`cre: LoopNet login exited with code ${loopnetCode}.`);
  }
  console.log('Opening Chrome for Reonomy — log in normally; it captures automatically.');
  const reonomyCode = runInteractive('reonomy-pp-cli', ['auth', 'login']);
  if (reonomyCode !== 0) {
    console.error(`cre: Reonomy login exited with code ${reonomyCode}.`);
  }
  return loopnetCode === 0 && reonomyCode === 0 ? 0 : 1;
}

function commandDoctor() {
  const loopnet = checkDoctor('loopnet-pp-cli', 'LoopNet');
  const reonomy = checkDoctor('reonomy-pp-cli', 'Reonomy');
  console.log('CRE tools status');
  console.log('────────────────');
  console.log(`  ${loopnet.connected ? '✓' : '✗'} ${loopnet.detail}`);
  console.log(`  ${reonomy.connected ? '✓' : '✗'} ${reonomy.detail}`);
  return loopnet.connected && reonomy.connected ? 0 : 1;
}

function commandSetup() {
  // (a) Chrome
  requireChromeOrExit();

  // (b) Logins
  console.log('\n== Step 1/3: Logging in ==');
  commandLogin();

  // (c) MCP wiring
  console.log('\n== Step 2/3: Wiring MCP servers ==');
  try {
    installMcpServers();
  } catch (err) {
    console.error(`cre: MCP wiring failed: ${err.message}`);
  }

  // (d) Doctors
  console.log('\n== Step 3/3: Verifying connections ==');
  const code = commandDoctor();
  if (code === 0) {
    console.log('\n✓ Setup complete — LoopNet and Reonomy are connected.');
  } else {
    console.log(
      '\n! Setup finished, but at least one service is not connected.\n' +
        '  Re-run `cre login` (Reonomy tokens expire in 1–24h) and then `cre doctor`.'
    );
  }
  return code;
}

function commandMcpInstall() {
  console.log('Wiring MCP servers into Claude...');
  try {
    const updated = installMcpServers();
    return updated.length > 0 ? 0 : 1;
  } catch (err) {
    console.error(`cre: MCP wiring failed: ${err.message}`);
    return 1;
  }
}

function printVersion() {
  try {
    console.log(readPackageVersion());
  } catch (err) {
    console.error(`cre: could not read version: ${err.message}`);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`cre — LoopNet + Reonomy CRE tools

Usage:
  cre setup          Verify Chrome, log into both services, wire MCP, verify
  cre login          Re-run both logins (use when a token expires)
  cre doctor         Show combined connection status
  cre status         Alias for doctor
  cre mcp install    Wire MCP servers into Claude Code + Claude Desktop
  cre --version      Print the installed version
  cre help           Show this help

Notes:
  • Requires Google Chrome installed (login drives a real Chrome window).
  • Each service needs your own paid LoopNet + Reonomy account.
  • Reonomy tokens expire in 1–24h — re-run \`cre login\` to refresh.`);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Fetch the native binaries on first use. Commands that drive the binaries call
 * this before running so a bun-blocked postinstall still self-heals. Exits with
 * an actionable message if the download can't complete.
 */
async function ensureBinariesOrExit() {
  try {
    await ensureBinaries();
  } catch (err) {
    console.error(`cre: ${err && err.message ? err.message : String(err)}`);
    process.exit(1);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  switch (cmd) {
    case 'setup':
      // Chrome check first (fast fail), then fetch binaries, then run.
      requireChromeOrExit();
      await ensureBinariesOrExit();
      process.exit(commandSetup());
      break;
    case 'login':
      await ensureBinariesOrExit();
      process.exit(commandLogin());
      break;
    case 'doctor':
    case 'status':
      await ensureBinariesOrExit();
      process.exit(commandDoctor());
      break;
    case 'mcp':
      if (argv[1] === 'install') {
        // mcp install references vendored binary paths — ensure they exist.
        await ensureBinariesOrExit();
        process.exit(commandMcpInstall());
      }
      console.error(`cre: unknown mcp subcommand "${argv[1] || ''}". Did you mean \`cre mcp install\`?`);
      process.exit(1);
      break;
    case '--version':
    case '-v':
      printVersion();
      process.exit(0);
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      process.exit(0);
      break;
    default:
      console.error(`cre: unknown command "${cmd}".\n`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`cre: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
});
