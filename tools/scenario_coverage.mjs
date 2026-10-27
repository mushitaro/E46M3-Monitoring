#!/usr/bin/env node
// ============================================================================
//  scenario_coverage.mjs — how far MONITORING is from answering its examples
// ----------------------------------------------------------------------------
//  Each example in scenarios/cases.json names the capabilities it needs;
//  scenarios/capabilities.json says which exist (car / built / missing). This
//  prints which examples can be answered now and which capability would unblock
//  the most of them — the measure of "done" in docs/AUTONOMY.md, and the order
//  the autonomous loop picks development work in.
//
//  Run: node tools/scenario_coverage.mjs [--json]
// ============================================================================
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf-8'));
const { cases } = read('scenarios/cases.json');
const caps = read('scenarios/capabilities.json');
delete caps._comment;

const rows = cases.map((c) => {
    const missing = c.needs.filter((n) => caps[n].status === 'missing');
    const unconfirmed = c.needs.filter((n) => caps[n].status === 'built');
    const state = missing.length > 0 ? 'missing' : unconfirmed.length > 0 ? 'built' : 'car';
    return { id: c.id, state, missing, unconfirmed };
});

const blocking = new Map();
for (const r of rows) for (const m of r.missing) blocking.set(m, (blocking.get(m) ?? 0) + 1);
const ranked = [...blocking.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const count = (s) => rows.filter((r) => r.state === s).length;

if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ total: rows.length, car: count('car'), built: count('built'), missing: count('missing'), rows, blocking: ranked }, null, 2));
    process.exit(0);
}

const W = Math.max(...rows.map((r) => r.id.length));
console.log(`examples ${rows.length}   on the car ${count('car')}   built ${count('built')}   blocked ${count('missing')}\n`);
for (const r of rows) {
    const why = r.missing.length > 0 ? r.missing.join(', ') : r.unconfirmed.length > 0 ? `confirm: ${r.unconfirmed.join(', ')}` : '';
    console.log(`${r.id.padEnd(W)}  ${r.state.padEnd(7)}  ${why}`);
}
console.log('\nmissing capability, by examples it blocks');
for (const [k, n] of ranked) console.log(`${String(n).padStart(3)}  ${k.padEnd(26)}  ${caps[k].what}`);
