import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEST_ID, tid, type TestId } from './testIds';

const SRC = path.resolve(import.meta.dirname, '..');

function* walk(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) yield* walk(p);
        else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts')) yield p;
    }
}

/** Which declared hooks the app actually reaches for, and any raw literals. */
function scanSource(): { used: Set<string>; literals: string[] } {
    const used = new Set<string>();
    const literals: string[] = [];
    for (const file of walk(SRC)) {
        if (file.endsWith(path.join('lib', 'testIds.ts'))) continue;
        const text = readFileSync(file, 'utf-8');
        for (const m of text.matchAll(/TEST_ID\.([A-Za-z0-9_]+)/g)) used.add(m[1]);
        // A hook spelled straight onto an element bypasses the record entirely,
        // which is the thing the record exists to prevent.
        for (const m of text.matchAll(/data-test="([^"{][^"]*)"/g)) {
            literals.push(`${path.relative(SRC, file)}: ${m[1]}`);
        }
    }
    return { used, literals };
}

describe('the test-hook record', () => {
    it('has no duplicate values — two names for one hook is one hook', () => {
        const values = Object.values(TEST_ID);
        expect(new Set(values).size).toBe(values.length);
    });

    it('uses kebab-case strings, the shape the suites select on', () => {
        for (const v of Object.values(TEST_ID)) expect(v).toMatch(/^[a-z][a-z0-9-]*$/);
    });

    it('declares nothing the app does not use', () => {
        // A hook listed but never rendered claims a surface the app does not
        // have, and a suite waiting on it waits forever.
        const { used } = scanSource();
        expect(Object.keys(TEST_ID).filter((k) => !used.has(k)).sort()).toEqual([]);
    });

    it('has no hook spelled straight onto an element', () => {
        // The record is only a contract if it is the only way to write one. A
        // raw data-test="..." is a hook a suite can select while nothing types
        // it, so a later rename breaks that suite silently — the exact failure
        // this file exists to prevent.
        expect(scanSource().literals).toEqual([]);
    });

    it('has hooks at all', () => {
        // Both checks above pass trivially against an empty app.
        expect(Object.keys(TEST_ID).length).toBeGreaterThan(0);
        expect(scanSource().used.size).toBeGreaterThan(0);
    });
});

describe('tid()', () => {
    it('produces the attribute a suite selects on', () => {
        expect(tid(TEST_ID.gateRun)).toEqual({ 'data-test': 'gate-run' });
    });

    it('only accepts a declared hook', () => {
        // @ts-expect-error a string that is not a declared hook must not compile
        const bad: { 'data-test': TestId } = tid('gate-runn');
        expect(bad).toBeTruthy();
    });
});
