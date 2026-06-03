'use strict';

// Shared platform + path resolution for cre-tools.
// Used by scripts/postinstall.js, bin/cre.js, and the four bin/*-pp-*.js shims.
// Node built-ins only — this package ships with no dependencies and no build step.

const path = require('node:path');
const fs = require('node:fs');

// The package root is the parent of the directory that holds platform.js (scripts/).
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const VENDOR_BIN_DIR = path.join(PACKAGE_ROOT, 'vendor', 'bin');

// The four native binaries this package wraps, by logical name.
const BINARY_NAMES = [
  'loopnet-pp-cli',
  'loopnet-pp-mcp',
  'reonomy-pp-cli',
  'reonomy-pp-mcp',
];

/**
 * Map process.platform to the GitHub Release asset OS token.
 * @returns {'darwin'|'linux'|'windows'}
 * @throws if the platform is unsupported (with the offending token).
 */
function resolveOsToken() {
  switch (process.platform) {
    case 'darwin':
      return 'darwin';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    default:
      throw new Error(
        `Unsupported platform: "${process.platform}". cre-tools supports macOS (darwin), Linux, and Windows (win32).`
      );
  }
}

/**
 * Map process.arch to the GitHub Release asset arch token.
 * @returns {'amd64'|'arm64'}
 * @throws if the arch is unsupported (with the offending token).
 */
function resolveArchToken() {
  switch (process.arch) {
    case 'x64':
      return 'amd64';
    case 'arm64':
      return 'arm64';
    default:
      throw new Error(
        `Unsupported CPU architecture: "${process.arch}". cre-tools supports x64 (amd64) and arm64.`
      );
  }
}

/**
 * True when the current platform appends a .exe suffix to executables.
 */
function isWindows() {
  return process.platform === 'win32';
}

/**
 * The local filename of a vendored binary, including the .exe suffix on Windows.
 * @param {string} logicalName one of BINARY_NAMES
 */
function vendoredFileName(logicalName) {
  return isWindows() ? `${logicalName}.exe` : logicalName;
}

/**
 * Absolute path to a vendored binary inside the package's vendor/bin dir.
 * @param {string} logicalName one of BINARY_NAMES
 */
function vendoredBinaryPath(logicalName) {
  return path.join(VENDOR_BIN_DIR, vendoredFileName(logicalName));
}

/**
 * The canonical GitHub Release asset name for a binary on the current platform.
 * Scheme: <tool>-pp-<kind>_<os>_<arch>[.exe]
 * e.g. loopnet-pp-cli_darwin_arm64, reonomy-pp-mcp_windows_amd64.exe
 * @param {string} logicalName one of BINARY_NAMES (already "<tool>-pp-<kind>")
 */
function releaseAssetName(logicalName) {
  const osToken = resolveOsToken();
  const archToken = resolveArchToken();
  const base = `${logicalName}_${osToken}_${archToken}`;
  return isWindows() ? `${base}.exe` : base;
}

/**
 * Resolve a wrapped native binary for execution: prefer the vendored copy,
 * fall back to the bare name on PATH (so a globally-installed binary still works).
 * @param {string} logicalName one of BINARY_NAMES
 * @returns {{ command: string, vendored: boolean }}
 */
function resolveExecutable(logicalName) {
  const vendored = vendoredBinaryPath(logicalName);
  if (fileExistsNonEmpty(vendored)) {
    return { command: vendored, vendored: true };
  }
  // Fall back to PATH lookup by bare name (.exe added by the OS loader on Windows).
  return { command: vendoredFileName(logicalName), vendored: false };
}

/**
 * True when a file exists and has non-zero size. Never throws.
 * @param {string} filePath
 */
function fileExistsNonEmpty(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

/**
 * Read the package version from package.json. Throws with context on failure.
 */
function readPackageVersion() {
  const pkgPath = path.join(PACKAGE_ROOT, 'package.json');
  let raw;
  try {
    raw = fs.readFileSync(pkgPath, 'utf8');
  } catch (err) {
    throw new Error(`Could not read package.json at ${pkgPath}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`package.json at ${pkgPath} is not valid JSON: ${err.message}`);
  }
  if (!parsed.version || typeof parsed.version !== 'string') {
    throw new Error(`package.json at ${pkgPath} is missing a string "version" field.`);
  }
  return parsed.version;
}

module.exports = {
  PACKAGE_ROOT,
  VENDOR_BIN_DIR,
  BINARY_NAMES,
  resolveOsToken,
  resolveArchToken,
  isWindows,
  vendoredFileName,
  vendoredBinaryPath,
  releaseAssetName,
  resolveExecutable,
  fileExistsNonEmpty,
  readPackageVersion,
};
