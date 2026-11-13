import { describe, expect, it } from 'vitest';
import { BOARD_LIMITS, boardLine, defaultReadouts, emptyBoard, move, partProblem, place, setShow, toggle } from './board';

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

describe('what a graph shows large (owner, 2026-11-13)', () => {
    const vanos = { kind: 'graph', channels: ['35:evan1_ist', '35:evan1_soll'] };

    it('shows the value and its target by default, the value alone without one', () => {
        expect(defaultReadouts(['a', 'b'])).toEqual(['value', 'target']);
        expect(defaultReadouts(['a'])).toEqual(['value']);
    });

    it('takes the readouts asked for, in order, and keeps them on the part', () => {
        const { board } = place(emptyBoard('r1'), [{ ...vanos, show: ['delta', 'value', 'max'] }], { now: 1 });
        expect(board.parts[0].show).toEqual(['delta', 'value', 'max']);
    });

    it('refuses an unknown readout, a repeat, or a target or delta without a target', () => {
        expect(partProblem({ ...vanos, show: ['peak'] })).toMatch(/part.show/);
        expect(partProblem({ ...vanos, show: [] })).toMatch(/part.show/);
        expect(partProblem({ ...vanos, show: ['value', 'value'] })).toMatch(/once/);
        expect(partProblem({ kind: 'graph', channels: ['3:ubatt'], show: ['delta'] })).toMatch(/need a target/);
        expect(partProblem({ kind: 'graph', channels: ['3:ubatt'], show: ['value', 'min', 'max', 'mean'] })).toBeNull();
        expect(partProblem({ kind: 'values', show: ['value'] })).toMatch(/only a graph/);
    });

    it('changes a placed graph in place: its id, order and open state stay', () => {
        let { board } = place(emptyBoard('r1'), [{ kind: 'message', text: 'x' }, vanos], { now: 1 });
        board = toggle(board, 'p2');
        const next = setShow(board, [{ id: 'p2', show: ['value', 'target', 'delta'] }]);
        expect(next.parts.map((p) => p.id)).toEqual(['p1', 'p2']);
        expect(next.parts[1]).toMatchObject({ id: 'p2', open: false, show: ['value', 'target', 'delta'] });
        expect(next.seq).toBe(board.seq);
    });

    it('changes nothing when one change is wrong', () => {
        const { board } = place(emptyBoard('r1'), [{ kind: 'message', text: 'x' }, vanos], { now: 1 });
        expect(() => setShow(board, [{ id: 'p2', show: ['max'] }, { id: 'p1', show: ['value'] }])).toThrow(/only a graph/);
        expect(() => setShow(board, [{ id: 'p9', show: ['value'] }])).toThrow(/No part p9/);
        expect(board.parts[1].show).toBeUndefined();
    });
});
