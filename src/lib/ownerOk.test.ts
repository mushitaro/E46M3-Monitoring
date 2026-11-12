import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify } from '../../scripts/autonomy-class.mjs';
import { okNumbers, ownerOk } from '../../scripts/owner-ok.mjs';

/**
 * The owner's spoken OK (scripts/owner-ok.mjs): when a `human` pull request may be taken in
 * without the owner opening GitHub. Pinned here: who can say it, what it covers, and what it
 * never covers.
 */
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const table = JSON.parse(readFileSync(path.join(ROOT, '.github', 'autonomy.json'), 'utf-8'));

const HEAD = Date.parse('2026-11-12T08:00:00Z');
const said = (by: string, text: string, at = HEAD + 60_000, id = 'e1') => ({ id, by, at, body: { kind: 'ask', to: 'desk', text } });
const ask = (entries: unknown[], pr = 44, paths = ['src/views/diagnosis/DiagnosisView.tsx']) => ownerOk({ entries, pr, headAt: HEAD, paths, table });

describe('the owner’s spoken OK', () => {
    it('takes in the pull request the owner named, said after its last commit', () => {
        expect(ask([said('chat', 'マージOK #44')])).toEqual({ ok: true, entry: 'e1' });
        expect(ask([said('driver', 'merge ok #45 #44')]).ok).toBe(true);
    });

    it('does not hear an OK the desk wrote, or one with no author', () => {
        expect(ask([said('desk', 'マージOK #44')]).ok).toBe(false);
        expect(ask([{ id: 'x', at: HEAD + 1, body: { text: 'マージOK #44' } }]).ok).toBe(false);
    });

    it('hears only the phrase at the start, and only the numbers on its line', () => {
        expect(okNumbers(said('chat', 'オーナーは #44 のマージOKを出したつもりでいる'))).toEqual([]);
        expect(okNumbers(said('chat', 'マージOK #44\nあわせて #45・#46 も求めている'))).toEqual([44]);
        expect(okNumbers(said('chat', 'マージOKではない #44'))).toEqual([]);
        expect(ask([said('chat', 'マージOK #45')]).ok).toBe(false);
    });

    it('does not carry an OK over to what was pushed after it', () => {
        const r = ask([said('chat', 'マージOK #44', HEAD - 1)]);
        expect(r).toEqual({ ok: false, why: 'the OK for #44 is older than its last commit' });
    });

    it('never releases the rules, the gate, the ledger, the link or the kill list', () => {
        const ok = [said('chat', 'マージOK #44')];
        for (const p of [
            '.github/autonomy.json',
            '.github/workflows/autonomy-merge.yml',
            '.claude/skills/monitoring-loop/SKILL.md',
            'CLAUDE.md',
            'scripts/owner-ok.mjs',
            'scripts/autonomy-class.mjs',
            'src/lib/runGate.ts',
            'src/lib/ledger.ts',
            'src/lib/actuationGate.ts',
            'src/lib/vehicleState.ts',
            'packages/ds2-core/src/link.ts',
            'public/kill-list.json',
            'workers/desk/src/index.ts',
            'functions/_middleware.ts',
        ]) {
            expect(ask(ok, 44, ['docs/PLAN.md', p]).ok, p).toBe(false);
        }
    });

    it('keeps every path it withholds among the ones the table already holds', () => {
        for (const g of table.owner as string[]) {
            const sample = g.replace('**', 'x').replace('*', 'x');
            expect(classify([sample], table).class, g).toBe('human');
        }
    });

    it('says no when it cannot know', () => {
        expect(ownerOk({ entries: [said('chat', 'マージOK #44')], pr: 44, headAt: NaN, paths: ['a'], table }).ok).toBe(false);
        expect(ask([said('chat', 'マージOK #44')], 44, []).ok).toBe(false);
    });
});
