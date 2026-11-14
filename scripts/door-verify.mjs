#!/usr/bin/env node
// door:verify — is functions/_lib/door.ts the platform's canonical copy, byte for byte?
//
// The door client (a v2 ticket for one request, the engine data bundle read in memory, what a
// refusal means) is M's platform's (tsunagi-m-platform gate/server/door.ts), copied into every
// Mainstay server that calls the platform's doors, and never edited here (operator, 2026-11-14:
// m3's WORKS apps read their module data from the engine door too). The canonical copy is found at
// $M_DOOR_CANONICAL, else at ../tsunagi-m-platform/gate/server/door.ts beside the git root. A check
// that passes when its reference is missing is not a check: that is a failure here too.
//
// The rest of this app's gate is still tsunagi-m3's copy (npm run gate:verify) until stage S3 moves
// it; then the platform's gate-verify with --door replaces this script.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
// A worktree's git root is the worktree: look beside the main checkout as well.
const common = path.dirname(path.resolve(root, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim()));
const candidates = [process.env.M_DOOR_CANONICAL, ...[root, common].map((r) => path.resolve(r, '..', 'tsunagi-m-platform', 'gate', 'server', 'door.ts'))].filter(Boolean);
const canonical = candidates.find((p) => fs.existsSync(p));
const copy = path.join(root, 'functions', '_lib', 'door.ts');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

if (!canonical) {
  console.log(`  FAIL  the platform's door.ts was not found (set M_DOOR_CANONICAL to tsunagi-m-platform/gate/server/door.ts)`);
  process.exit(1);
}
if (!fs.existsSync(copy)) {
  console.log('  FAIL  functions/_lib/door.ts is missing');
  process.exit(1);
}
if (read(canonical) !== read(copy)) {
  console.log(`  FAIL  functions/_lib/door.ts differs from ${canonical}. Copy the canonical file; never edit the copy.`);
  process.exit(1);
}
console.log('  ok    functions/_lib/door.ts matches the platform\'s canonical copy');
