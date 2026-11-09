import { describe, expect, it } from 'vitest';
import { BOARD_LIMITS, boardLine, emptyBoard, move, partProblem, place, toggle } from './board';

describe('placing parts', () => {
    it('numbers them in order placed and never reuses a number', () => {
        let b = place(emptyBoard('rec-00000001'), [{ kind: 'message', text: 'a' }, { kind: 'scan' }], { now: 1 }).board;
        b = place(b, [{ kind: 'plan' }], { remove: ['p1'], now: 2 }).board;
        expect(b.parts.map((p) => p.id)).toEqual(['p2', 'p3']);
        expect(place(b, [{ kind: 'faults' }], { replace: true, now: 3 }).board.parts.map((p) => p.id)).toEqual(['p4']);
    });

    it('keeps only what a part is made of', () => {
        const b = place(emptyBoard('rec-00000001'), [{ kind: 'values', run: 2, channels: ['3:n'], extra: 1 } as never], { now: 1 }).board;
        expect(b.parts[0]).toEqual({ kind: 'values', run: 2, channels: ['3:n'], id: 'p1', open: true, at: 1 });
    });

    it('refuses the whole call on one bad part, and past the limit', () => {
        const b = emptyBoard('rec-00000001');
        expect(() => place(b, [{ kind: 'scan' }, { kind: 'values', text: '800 rpm' }], { now: 1 })).toThrow(/only a message part/);
        const many = Array.from({ length: BOARD_LIMITS.parts + 1 }, () => ({ kind: 'scan' }));
        expect(() => place(b, many, { now: 1 })).toThrow(/holds 12/);
        expect(() => place(b, [], { remove: ['p9'], now: 1 })).toThrow(/No part p9/);
    });

    it('says what is wrong with a part in a sentence', () => {
        expect(partProblem({ kind: 'message' })).toMatch(/needs text/);
        expect(partProblem({ kind: 'compare', against: { record: 'x' } })).toMatch(/session id/);
        expect(partProblem({ kind: 'values', channels: [] })).toMatch(/channels/);
        expect(partProblem({ kind: 'judges', run: 2 })).toBeNull();
    });

    it('takes a graph of a value and its target, with context, a window and a band', () => {
        const ok = { kind: 'graph', channels: ['35:evan1_ist', '35:evan1_soll'], context: ['3:n', '3:wdk1'], seconds: 30, band: 2 };
        expect(partProblem(ok)).toBeNull();
        expect(partProblem({ kind: 'graph', channels: ['3:toel'] })).toBeNull();
        expect(partProblem({ kind: 'graph' })).toMatch(/the value, its target/);
        expect(partProblem({ kind: 'graph', channels: ['a', 'b', 'c'] })).toMatch(/the value, its target/);
        expect(partProblem({ ...ok, seconds: 5 })).toMatch(/10 to 300/);
        expect(partProblem({ ...ok, band: -1 })).toMatch(/positive/);
        expect(partProblem({ kind: 'graph', channels: ['3:toel'], band: 2 })).toMatch(/needs a target/);
        expect(partProblem({ kind: 'values', seconds: 30 })).toMatch(/only a graph/);
        const placed = place(emptyBoard('rec-00000001'), [{ ...ok, extra: 1 }], { now: 1 }).board.parts[0];
        expect(placed).toMatchObject({ kind: 'graph', channels: ok.channels, context: ok.context, seconds: 30, band: 2 });
        expect(placed).not.toHaveProperty('extra');
    });
});

describe('the owner rearranging', () => {
    it('opens, closes and moves, and the assistant reads the order back', () => {
        let b = place(emptyBoard('rec-00000001'), [{ kind: 'message', text: 'a' }, { kind: 'scan' }, { kind: 'plan' }], { now: 1 }).board;
        b = toggle(move(b, 'p3', -1), 'p1');
        expect(boardLine(b)).toEqual([
            { id: 'p1', kind: 'message', title: null, open: false },
            { id: 'p3', kind: 'plan', title: null, open: true },
            { id: 'p2', kind: 'scan', title: null, open: true },
        ]);
        expect(move(b, 'p1', -1)).toBe(b);
    });
});
