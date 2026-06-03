'use strict';

// Shared binary-download routine for cre-tools.
// Used by scripts/postinstall.js (best-effort prefetch), bin/cre.js, and the
// bin/*-pp-*.js shims (lazy self-heal on first use). Node built-ins only.
//
// Why lazy: bun blocks package postinstall scripts by default ("Blocked 1
// postinstall"), so we cannot rely on postinstall to fetch the native binaries.
// Every entry point that needs a binary calls ensureBinaries() first, which is
// a no-op once the four binaries are present.

const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

const {
  VENDOR_BIN_DIR,
  BINARY_NAMES,
  isWindows,
  vendoredBinaryPath,
  releaseAssetName,
  fileExistsNonEmpty,
  readPackageVersion,
} = require('./platform.js');

const RELEASE_OWNER_REPO = 'Vibe-Marketer/cre-tools';

function releaseDownloadUrl(version, assetName) {
  return `https://github.com/${RELEASE_OWNER_REPO}/releases/download/v${version}/${assetName}`;
}

/**
 * Stream one asset to disk via a temp file, then atomically rename into place.
 * Verifies HTTP 200 before writing a byte. Cleans up the temp file on any failure.
 * @param {string} url
 * @param {string} destPath
 */
async function downloadBinary(url, destPath) {
  let response;
  try {
    response = await fetch(url, { redirect: 'follow' });
  } catch (err) {
    throw new Error(`Network error fetching ${url}: ${err && err.message ? err.message : String(err)}`);
  }

  if (response.status !== 200) {
    throw new Error(
      `Download failed: ${url} returned HTTP ${response.status} ${response.statusText || ''}`.trim()
    );
  }
  if (!response.body) {
    throw new Error(`Download failed: ${url} returned no response body.`);
  }

  const tmpPath = `${destPath}.download-${process.pid}-${Date.now()}.tmp`;
  const writeStream = fs.createWriteStream(tmpPath, { mode: 0o644 });

  try {
    await pipeline(Readable.fromWeb(response.body), writeStream);
  } catch (err) {
    await safeUnlink(tmpPath);
    throw new Error(`Failed writing ${url} -> ${destPath}: ${err && err.message ? err.message : String(err)}`);
  }

  let tmpStat;
  try {
    tmpStat = fs.statSync(tmpPath);
  } catch (err) {
    await safeUnlink(tmpPath);
    throw new Error(`Downloaded file vanished before install: ${tmpPath} (${err.message})`);
  }
  if (tmpStat.size === 0) {
    await safeUnlink(tmpPath);
    throw new Error(`Download produced an empty file from ${url}.`);
  }

  try {
    fs.renameSync(tmpPath, destPath);
  } catch (err) {
    await safeUnlink(tmpPath);
    throw new Error(`Could not move downloaded binary into place (${destPath}): ${err.message}`);
  }

  if (!isWindows()) {
    try {
      fs.chmodSync(destPath, 0o755);
    } catch (err) {
      throw new Error(`Downloaded ${destPath} but could not chmod it executable: ${err.message}`);
    }
  }
}

/**
 * Delete a file, ignoring "not found". Never throws.
 * @param {string} filePath
 */
async function safeUnlink(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // Best-effort cleanup; nothing actionable if it's already gone.
  }
}

function allBinariesPresent() {
  return BINARY_NAMES.every((name) => fileExistsNonEmpty(vendoredBinaryPath(name)));
}

/**
 * Ensure all four native binaries for this platform are vendored, downloading
 * any that are missing. Idempotent: a no-op when everything is already present.
 * Honors CRE_TOOLS_SKIP_DOWNLOAD=1.
 *
 * @param {{ quiet?: boolean }} [opts] quiet suppresses progress chatter; errors
 *   still surface via the thrown exception.
 * @returns {Promise<boolean>} true if all binaries are present afterward.
 * @throws if a required binary cannot be downloaded.
 */
async function ensureBinaries(opts = {}) {
  const quiet = opts.quiet === true;
  const log = (msg) => {
    if (!quiet) console.log(msg);
  };

  if (allBinariesPresent()) {
    return true;
  }

  if (process.env.CRE_TOOLS_SKIP_DOWNLOAD === '1') {
    throw new Error(
      'cre-tools binaries are missing and CRE_TOOLS_SKIP_DOWNLOAD=1 is set, so they cannot be fetched.'
    );
  }

  // Resolve platform tokens (throws on unsupported OS/arch with a clear message).
  const version = readPackageVersion();
  const assets = BINARY_NAMES.map((name) => ({
    logicalName: name,
    assetName: releaseAssetName(name),
    destPath: vendoredBinaryPath(name),
  }));

  fs.mkdirSync(VENDOR_BIN_DIR, { recursive: true });

  log(`cre-tools: fetching tools for ${process.platform}/${process.arch} (release v${version})...`);

  for (const asset of assets) {
    if (fileExistsNonEmpty(asset.destPath)) {
      continue;
    }
    const url = releaseDownloadUrl(version, asset.assetName);
    if (!quiet) process.stdout.write(`  ↓ ${asset.assetName} ... `);
    try {
      await downloadBinary(url, asset.destPath);
      if (!quiet) console.log('done');
    } catch (err) {
      if (!quiet) console.log('FAILED');
      throw new Error(
        `${err.message}\n  Tried: ${url}\n` +
          '  Check your network and that the release exists. ' +
          'Re-run `cre setup` (or any cre command) to retry.'
      );
    }
  }

  return true;
}

module.exports = {
  ensureBinaries,
  allBinariesPresent,
  releaseDownloadUrl,
  RELEASE_OWNER_REPO,
};
