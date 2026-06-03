#!/usr/bin/env node
'use strict';
// Shim: forwards to the vendored reonomy-pp-cli native binary (self-heals if missing).
require('../scripts/shim.js').runShim('reonomy-pp-cli').catch((err) => {
  process.stderr.write('cre-tools: ' + (err && err.message ? err.message : String(err)) + '\n');
  process.exit(1);
});
