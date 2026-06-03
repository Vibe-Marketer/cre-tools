'use strict';

// Shared logic for the bin/*-pp-*.js shims. Each shim resolves its vendored
// native binary and execs it with the caller's args + inherited stdio so
// interactive prompts (and the Chrome auth window) work normally.

const { spawn } = require('node:child_process');
const { resolveExecutable, vendoredBinaryPath } = require('./platform.js');

/**
 * Run a wrapped native binary, forwarding args, stdio, and the exit code.
 * Exits the current process with the child's exit code (or 1 on spawn error).
 * @param {string} logicalName one of platform.BINARY_NAMES
 */
function runShim(logicalName) {
  const { command, vendored } = resolveExecutable(logicalName);
  const args = process.argv.slice(2);

  const child = spawn(command, args, { stdio: 'inherit' });

  child.on('error', (err) => {
    if (err && err.code === 'ENOENT') {
      const expected = vendoredBinaryPath(logicalName);
      process.stderr.write(
        `cre-tools: could not find the "${logicalName}" binary.\n` +
          `  Looked for: ${expected}\n` +
          (vendored
            ? '  The vendored binary is present but failed to launch.\n'
            : '  It was not vendored and is not on your PATH.\n') +
          '  Reinstall to fetch binaries: bun add -g github:Vibe-Marketer/cre-tools\n' +
          '  Or re-run the download step: node ./scripts/postinstall.js\n'
      );
    } else {
      process.stderr.write(
        `cre-tools: failed to launch "${logicalName}" (${command}): ` +
          `${err && err.message ? err.message : String(err)}\n`
      );
    }
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      // Mirror the child's fatal signal as a conventional non-zero exit code.
      process.exit(1);
      return;
    }
    process.exit(code === null ? 1 : code);
  });
}

module.exports = { runShim };
