#!/usr/bin/env node
'use strict';

// postinstall: download the four native binaries for the detected platform from
// the cre-tools GitHub Release into vendor/bin/. Node built-ins only (Node 20+
// for global fetch). Streaming download, HTTP 200 verification, temp-file
// cleanup on failure, idempotent re-runs, and CRE_TOOLS_SKIP_DOWNLOAD escape hatch.

const fs = require('node:fs');
const path = require('node:path');
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
    // response.body is a web ReadableStream; adapt it to a Node stream to pipe.
    await pipeline(Readable.fromWeb(response.body), writeStream);
  } catch (err) {
    await safeUnlink(tmpPath);
    throw new Error(`Failed writing ${url} -> ${destPath}: ${err && err.message ? err.message : String(err)}`);
  }

  // Guard against a "200 with empty body" edge: an empty binary is never valid.
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

async function main() {
  if (process.env.CRE_TOOLS_SKIP_DOWNLOAD === '1') {
    console.log('cre-tools: CRE_TOOLS_SKIP_DOWNLOAD=1 set — skipping binary download.');
    return;
  }

  // Resolve platform tokens early so an unsupported OS/arch fails with a clear message.
  let version;
  let assets;
  try {
    version = readPackageVersion();
    // releaseAssetName() throws on unsupported platform/arch via platform.js.
    assets = BINARY_NAMES.map((name) => ({
      logicalName: name,
      assetName: releaseAssetName(name),
      destPath: vendoredBinaryPath(name),
    }));
  } catch (err) {
    console.error(`cre-tools install error: ${err.message}`);
    process.exit(1);
  }

  if (allBinariesPresent()) {
    console.log('cre-tools: all binaries already present — skipping download (idempotent).');
    console.log('✓ cre-tools installed. Run `cre setup` to log in and connect LoopNet + Reonomy.');
    return;
  }

  try {
    fs.mkdirSync(VENDOR_BIN_DIR, { recursive: true });
  } catch (err) {
    console.error(`cre-tools install error: could not create ${VENDOR_BIN_DIR}: ${err.message}`);
    process.exit(1);
  }

  console.log(`cre-tools: downloading binaries for ${process.platform}/${process.arch} (release v${version})...`);

  for (const asset of assets) {
    if (fileExistsNonEmpty(asset.destPath)) {
      console.log(`  • ${asset.logicalName} already present — skipping.`);
      continue;
    }
    const url = releaseDownloadUrl(version, asset.assetName);
    process.stdout.write(`  ↓ ${asset.assetName} ... `);
    try {
      await downloadBinary(url, asset.destPath);
      console.log('done');
    } catch (err) {
      console.log('FAILED');
      console.error(`\ncre-tools install error: ${err.message}`);
      console.error('  This binary is required. Installation cannot complete.');
      console.error(`  Tried: ${url}`);
      console.error('  If the release/version does not exist yet, set CRE_TOOLS_SKIP_DOWNLOAD=1 to install the wrapper without binaries.');
      process.exit(1);
    }
  }

  console.log('✓ cre-tools installed. Run `cre setup` to log in and connect LoopNet + Reonomy.');
}

main().catch((err) => {
  console.error(`cre-tools install error: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
});
