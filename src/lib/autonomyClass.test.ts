import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify, globToRegExp } from '../../scripts/autonomy-class.mjs';

/**
 * The table that decides which changes merge without a person (.github/autonomy.json). What is
 * pinned here is the part that must never drift: the gate, the ledger, the link, the executor,
 * the bridge's tool list, the guide's preamble and the table itself are always a person's.
 */
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const table = JSON.parse(readFileSync(path.join(ROOT, '.github', 'autonomy.json'), 'utf-8'));
const cls = (...paths: string[]) => classify(paths, table).class;

describe('the autonomy class', () => {
    it('lets wording, examples, the guide’s topics and docs merge by themselves', () => {
        expect(cls('docs/AUTONOMY.md', 'scenarios/cases.json', 'public/guide/faults.md', 'src/lib/i18n/ja.ts')).toBe('auto');
    });

    it('holds anything that decides what reaches the car, or what the assistant may do', () => {
        for (const p of [
            'src/lib/runGate.ts',
            'src/lib/ledger.ts',
            'src/hooks/useDs2Link.ts',
            'packages/ds2-core/src/link.ts',
            'src/lib/probe/executor.ts',
            'src/lib/bridge/tools.ts',
            'src/lib/bridge/handlers.ts',
            'src/hooks/useMonitoringFacade.ts',
            'public/kill-list.json',
            'public/guide/index.md',
            'functions/api/bridge/socket.ts',
            '.github/autonomy.json',
            '.claude/skills/monitoring-loop/SKILL.md',
        ]) {
            expect(cls(p), p).toBe('human');
        }
    });

    it('holds a change when any one of its files is held, and anything the table does not name', () => {
        expect(cls('docs/PLAN.md', 'src/lib/runGate.ts')).toBe('human');
        expect(cls('src/views/diagnosis/DiagnosisView.tsx')).toBe('human');
        expect(cls()).toBe('human');
    });

    it('asks the owner to review exactly what it holds (CODEOWNERS follows the table)', () => {
        const owners = readFileSync(path.join(ROOT, '.github', 'CODEOWNERS'), 'utf-8')
            .split('\n')
            .filter((l) => l.startsWith('/'))
            .map((l) => l.split(/\s+/)[0]);
        const held = (table.human as string[]).map((g) => `/${g.replace(/\/\*\*$/, '/')}`);
        expect(owners.sort()).toEqual(held.sort());
    });

    it('reads ** across folders and * within one', () => {
        expect(globToRegExp('docs/**').test('docs/a/b.md')).toBe(true);
        expect(globToRegExp('public/guide/*.md').test('public/guide/x/y.md')).toBe(false);
        expect(globToRegExp('public/guide/*.md').test('public/guide/drive.md')).toBe(true);
    });
});
