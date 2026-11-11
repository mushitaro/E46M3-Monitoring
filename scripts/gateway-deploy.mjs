#!/usr/bin/env node
// Deploy the engine gateway (workers/engine-gateway, Pages project `tsunagi-engine-gateway`): M's door
// for Mainstays, apart from the WORKS build (operator, 2026-11-12; docs/ENGINE.md §7).
//
//   npm run gateway:deploy              copy the data, then `wrangler pages deploy`
//   npm run gateway:deploy -- --dry     copy and check only; deploys nothing
//
// The engine's data is the same private copy the WORKS build serves (public/ecu-data, from
// E46M3-Monitoring-data; THIRD-PARTY-NOTICES.md §3). It is copied into the gateway's output at deploy
// and never committed (.gitignore). The gateway serves a file only to a store's ticket for that name;
// in advanced mode no request reaches a static file except through its code.
//
// The operator runs this; nothing here runs in CI.

import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'public', 'ecu-data');
const GATEWAY = join(ROOT, 'workers', 'engine-gateway');
const OUT = join(GATEWAY, 'pages', 'ecu-data');
/** What the gateway serves; nothing else is copied. Same names as workers/engine-gateway/src/engineData.ts. */
const FILE = /^(?:[a-z0-9_]+\.(?:jobs|telegrams)\.json|index\.json|variants\.json|fault-layouts\.json)$/;

if (!existsSync(join(SOURCE, 'index.json')) || !existsSync(join(SOURCE, 'fault-layouts.json'))) {
  console.error('public/ecu-data is missing or incomplete (index.json, fault-layouts.json): pull E46M3-Monitoring-data first.');
  process.exit(2);
}
rmSync(OUT, { recursive: true, force: true });
const files = readdirSync(SOURCE).filter((f) => FILE.test(f));
for (const f of files) cpSync(join(SOURCE, f), join(OUT, f));
console.log(`copied ${files.length} engine data file(s) into workers/engine-gateway/pages/ecu-data`);

if (process.argv.includes('--dry')) process.exit(0);
const r = spawnSync('npx', ['wrangler', 'pages', 'deploy', 'pages', '--project-name', 'tsunagi-engine-gateway', '--branch', 'main'], {
  cwd: GATEWAY,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 1);
