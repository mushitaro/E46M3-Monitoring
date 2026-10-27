#!/usr/bin/env node
// ============================================================================
//  autonomy-class.mjs — may this change merge without a person?
// ----------------------------------------------------------------------------
//  Reads .github/autonomy.json and the changed paths, one per line on stdin
//  (or as arguments), and says `auto` or `human`, with the paths that made it
//  human. The table decides, not the agent that wrote the change
//  (docs/AUTONOMY.md §5).
//
//  git diff --name-only origin/main...HEAD | node scripts/autonomy-class.mjs
// ============================================================================
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** `**` any path (including none), `*` any name within one folder, everything else literal. */
export function globToRegExp(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
            re += '.*';
            i++;
            if (glob[i + 1] === '/') i++;
        } else if (c === '*') re += '[^/]*';
        else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${re}$`);
}

/** The class of a change: `auto` only when every path is auto and none is human. */
export function classify(paths, table) {
    const auto = table.auto.map(globToRegExp);
    const human = table.human.map(globToRegExp);
    const held = paths.filter((p) => human.some((r) => r.test(p)) || !auto.some((r) => r.test(p)));
    return { class: paths.length > 0 && held.length === 0 ? 'auto' : 'human', held };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const table = JSON.parse(readFileSync(path.join(root, '.github', 'autonomy.json'), 'utf-8'));
    const args = process.argv.slice(2);
    const paths = (args.length ? args : readFileSync(0, 'utf-8').split('\n')).map((s) => s.trim()).filter(Boolean);
    const r = classify(paths, table);
    console.log(r.class);
    for (const p of r.held) console.error(`human: ${p}`);
}
