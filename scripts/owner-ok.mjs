#!/usr/bin/env node
// ============================================================================
//  owner-ok.mjs — has the owner said this pull request may be taken in?
// ----------------------------------------------------------------------------
//  The owner drives; a review on GitHub is not something a driver can do. What
//  the owner can do is say so, and the assistant in the car writes it into the
//  investigation's record. This reads that record (as `npm run desk -- pull`
//  left it) and the table, and says `merge` or `wait: <why>`. The loop takes a
//  `human` pull request in only when this says `merge`; it does not weigh the
//  words itself (docs/AUTONOMY.md §5).
//
//  It says `merge` only when all of these hold:
//    - an entry that the desk did not write (the desk's token can only write
//      as `desk`, so the loop cannot write one) starts with `マージOK` or
//      `MERGE OK` and names this pull request by number (`#44`);
//    - that entry is newer than the last commit of the pull request: an OK is
//      for what stood when it was said, not for what was pushed after;
//    - no changed path is in the table's `owner` list — the rules themselves,
//      and what decides what reaches the car, stay with the owner's own hand.
//
//  npm run desk -- pull <record>
//  git diff --name-only origin/main...<sha> | node scripts/owner-ok.mjs <record> <pr> <last commit, ISO 8601>
// ============================================================================
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { globToRegExp } from './autonomy-class.mjs';

const OK = /^\s*(?:マージ\s*OK|MERGE\s*OK)(?=[\s#、。:：]|$)/i;

/** The pull request numbers an entry says OK to: none unless its text opens with the phrase. */
export function okNumbers(entry) {
    if (!entry || entry.by === 'desk' || typeof entry.by !== 'string') return [];
    const text = entry.body?.text;
    if (typeof text !== 'string' || !OK.test(text)) return [];
    // Only the first line: what follows is the assistant's account of it, which may name other pull requests.
    return [...text.split('\n')[0].matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
}

/** `{ ok: true, entry }` or `{ ok: false, why }`. `headAt` is the pull request's last commit, in ms. */
export function ownerOk({ entries, pr, headAt, paths, table }) {
    if (!Number.isInteger(pr) || pr < 1) return { ok: false, why: 'no pull request number' };
    if (!Number.isFinite(headAt)) return { ok: false, why: 'the time of the last commit is not known' };
    if (!paths || paths.length === 0) return { ok: false, why: 'no changed paths' };
    const own = (table.owner ?? []).map(globToRegExp);
    const held = paths.filter((p) => own.some((r) => r.test(p)));
    if (held.length > 0) return { ok: false, why: `only the owner's own hand takes these in: ${held.join(', ')}` };
    const said = (entries ?? []).filter((e) => okNumbers(e).includes(pr));
    if (said.length === 0) return { ok: false, why: `no entry says マージOK #${pr}` };
    const fresh = said.filter((e) => Number.isFinite(e.at) && e.at > headAt);
    if (fresh.length === 0) return { ok: false, why: `the OK for #${pr} is older than its last commit` };
    return { ok: true, entry: fresh[fresh.length - 1].id };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
    const [record, prArg, headIso] = process.argv.slice(2);
    if (!record || !prArg || !headIso) {
        console.error('usage: <changed paths on stdin> | owner-ok.mjs <record> <pr> <last commit, ISO 8601>');
        process.exit(1);
    }
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const table = JSON.parse(readFileSync(path.join(root, '.github', 'autonomy.json'), 'utf-8'));
    const pulled = JSON.parse(readFileSync(path.join('desk-work', record, 'investigation.json'), 'utf-8'));
    const paths = readFileSync(0, 'utf-8').split('\n').map((s) => s.trim()).filter(Boolean);
    const r = ownerOk({ entries: pulled.entries, pr: Number(prArg), headAt: Date.parse(headIso), paths, table });
    console.log(r.ok ? `merge (entry ${r.entry})` : `wait: ${r.why}`);
    process.exit(r.ok ? 0 : 2);
}
