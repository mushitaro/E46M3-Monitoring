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
    it('lets every change merge by itself once CI passes (operator, 2026-11-13)', () => {
        expect(cls('docs/AUTONOMY.md', 'scenarios/cases.json', 'public/guide/faults.md', 'src/lib/i18n/ja.ts')).toBe('auto');
        for (const p of ['src/hooks/useDs2Link.ts', 'packages/monitoring-engine/src/link/session.ts', 'packages/monitoring-engine/src/probe/executor.ts', 'packages/monitoring-engine/src/probe/scan.ts', 'src/lib/bridge/tools.ts', 'src/hooks/useMonitoringFacade.ts', 'src/views/diagnosis/DiagnosisView.tsx', 'functions/api/bridge/socket.ts', 'public/guide/index.md']) {
            expect(cls(p), p).toBe('auto');
        }
    });

    it('holds the rules themselves and what decides what reaches the car', () => {
        for (const p of [
            'packages/monitoring-engine/src/runGate.ts',
            'packages/monitoring-engine/src/ledger.ts',
            'packages/monitoring-engine/src/actuationGate.ts',
            'packages/monitoring-engine/src/vehicleState.ts',
            'packages/monitoring-engine/src/variants.ts',
            'packages/ds2-core/src/link.ts',
            'public/kill-list.json',
            'functions/_middleware.ts',
            '.github/autonomy.json',
            '.github/workflows/autonomy-merge.yml',
            '.claude/skills/monitoring-loop/SKILL.md',
            'CLAUDE.md',
            'scripts/autonomy-class.mjs',
        ]) {
            expect(cls(p), p).toBe('human');
        }
    });

    it('holds a change when any one of its files is held, and an empty one', () => {
        expect(cls('docs/PLAN.md', 'packages/monitoring-engine/src/runGate.ts')).toBe('human');
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
