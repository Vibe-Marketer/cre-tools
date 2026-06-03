#!/usr/bin/env node
'use strict';

// postinstall: best-effort prefetch of the native binaries.
//
// IMPORTANT: this must never hard-fail the install. Under bun, postinstall is
// blocked entirely by default, so the binaries download lazily on first `cre`
// run instead (see scripts/download.js → ensureBinaries, called from bin/cre.js
// and the shims). Under npm, a transient network failure here should not brick
// the install either — we just note it and let first-use fetch them.

const { ensureBinaries } = require('./download.js');

ensureBinaries()
  .then(() => {
    console.log('✓ cre-tools ready. Run `cre setup` to log in and connect LoopNet + Reonomy.');
  })
  .catch((err) => {
    console.log(`cre-tools: binaries will download on first run (${err && err.message ? err.message.split('\n')[0] : 'deferred'}).`);
    console.log('  Next: run `cre setup` to fetch tools, log in, and connect LoopNet + Reonomy.');
    // Exit 0 on purpose — do not fail the package install.
  });
