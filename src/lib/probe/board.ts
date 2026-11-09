/**
 * The PROBE board: the parts the assistant places on the PROBE tab for a session, and the owner's
 * opening, closing and reordering of them (operator, 2026-11-02).
 *
 * The screen is variable in what it shows, not in how it draws it. The assistant chooses parts from
 * a fixed catalogue and says what each shows — a module, a run, the channels — and the tab draws
 * every value from its own data. The one part that carries the assistant's own words is `message`,
 * and it is drawn as the assistant's, so an estimate never wears a measurement's face.
 *
 * A board belongs to a session (a CO-WORK record) and is kept on this device only, beside MEMORY's
 * journal (lib/probe/boardStore.ts). With nothing placed, the board is empty.
 *
 * Pure: the bridge and the view apply the same rules.
 */

export const PART_KINDS = ['message', 'faults', 'scan', 'plan', 'judges', 'compare', 'values', 'graph'] as const;
export type PartKind = (typeof PART_KINDS)[number];

export const BOARD_LIMITS = {
    parts: 12,
    title: 60,
    text: 400,
    channels: 12,
    /** graph: the values beside the main one. */
    context: 6,
    /** graph: the window, seconds. */
    seconds: { min: 10, max: 300, default: 30 },
} as const;

/** What the assistant asks for: a kind and what to show. */
export interface PartSpec {
    kind: PartKind;
    /** A short heading of the assistant's. */
    title?: string;
    /** message: one or two sentences, the assistant's own words. */
    text?: string;
    /** faults: the module whose fault read to show (the module in session). */
    module?: string;
    /** judges, values, compare: the run (default: the session's last). */
    run?: number;
    /** compare: the earlier run — of this session, or of another (`record`). Default: the run
     *  before, else the last run of the session this one follows. */
    against?: { record?: string; run?: number };
    /** values, compare: only these channels. graph: the value to watch, then its target if it has one. */
    channels?: string[];
    /** graph: the values that say what the car was doing (engine speed, throttle), drawn small beside it. */
    context?: string[];
    /** graph: how many seconds the line shows, the newest at the right (default 30). */
    seconds?: number;
    /**
     * graph: how far from its target the value may be before its colour changes, in its own unit.
     * The assistant's number, and drawn as the assistant's; without it the colour does not change.
     */
    band?: number;
}

export interface Part extends PartSpec {
    /** `p1`, `p2` … in the order placed on this board; never reused. */
    id: string;
    /** Placed by the assistant; opened, closed and moved by the owner. */
    open: boolean;
    at: number;
}

export interface Board {
    record: string;
    parts: Part[];
    /** The last id handed out. */
    seq: number;
}

export const emptyBoard = (record: string): Board => ({ record, parts: [], seq: 0 });

const RUN = (n: unknown) => n === undefined || (Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 99);
const MODULE = /^[a-z0-9_]{2,32}$/;
const RECORD = /^[0-9A-Za-z-]{8,64}$/;
const CHANNEL = /^[A-Za-z0-9_:*]{1,40}$/;
const text = (s: unknown, max: number) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;

/** What is wrong with a part as asked for, in a sentence the assistant can act on — or null. */
export function partProblem(p: unknown): string | null {
    if (!p || typeof p !== 'object') return 'a part is an object with a kind';
    const x = p as Partial<PartSpec>;
    if (!PART_KINDS.includes(x.kind as PartKind)) return `part.kind must be one of ${PART_KINDS.join(', ')}`;
    if (x.title !== undefined && !text(x.title, BOARD_LIMITS.title)) return `part.title is up to ${BOARD_LIMITS.title} characters`;
    if (x.kind === 'message' && !text(x.text, BOARD_LIMITS.text)) return `a message part needs text, up to ${BOARD_LIMITS.text} characters`;
    if (x.kind !== 'message' && x.text !== undefined) return 'only a message part carries text: the tab draws every other part from its own data';
    if (x.module !== undefined && (typeof x.module !== 'string' || !MODULE.test(x.module))) return 'part.module must be a module id';
    if (!RUN(x.run)) return 'part.run must be a run number, from 1';
    if (x.against !== undefined) {
        const a = x.against;
        if (!a || typeof a !== 'object') return 'part.against is {record?, run?}';
        if (a.record !== undefined && (typeof a.record !== 'string' || !RECORD.test(a.record))) return 'part.against.record must be a session id';
        if (!RUN(a.run)) return 'part.against.run must be a run number, from 1';
    }
    if (x.kind === 'graph') {
        if (!Array.isArray(x.channels) || x.channels.length < 1 || x.channels.length > 2) return 'a graph part names channels: [the value, its target?] (35:evan1_ist, 35:evan1_soll)';
        if (x.context !== undefined && (!Array.isArray(x.context) || x.context.length > BOARD_LIMITS.context || !x.context.every((c) => typeof c === 'string' && CHANNEL.test(c)))) {
            return `part.context names up to ${BOARD_LIMITS.context} channels (3:n, 3:wdk)`;
        }
        const w = BOARD_LIMITS.seconds;
        if (x.seconds !== undefined && !(Number.isInteger(x.seconds) && x.seconds >= w.min && x.seconds <= w.max)) return `part.seconds is a whole number from ${w.min} to ${w.max}`;
        if (x.band !== undefined && !(typeof x.band === 'number' && Number.isFinite(x.band) && x.band > 0)) return 'part.band is a positive number, in the value’s own unit';
        if (x.band !== undefined && x.channels.length < 2) return 'part.band needs a target: channels: [the value, its target]';
    } else if (x.context !== undefined || x.seconds !== undefined || x.band !== undefined) {
        return 'only a graph part takes context, seconds and band';
    }
    if (
        x.channels !== undefined &&
        (!Array.isArray(x.channels) || x.channels.length === 0 || x.channels.length > BOARD_LIMITS.channels || !x.channels.every((c) => typeof c === 'string' && CHANNEL.test(c)))
    ) {
        return `part.channels names 1-${BOARD_LIMITS.channels} channels (19:v, adapt:6:lu_adapt)`;
    }
    return null;
}

/**
 * Place parts: after those on the board, or — `replace` — instead of them. `remove` takes part ids
 * off first. All or nothing: the first problem throws its sentence and the board is unchanged.
 */
export function place(board: Board, specs: readonly unknown[], opts: { replace?: boolean; remove?: readonly string[]; now: number }): { board: Board; placed: string[] } {
    for (const s of specs) {
        const problem = partProblem(s);
        if (problem) throw new Error(problem);
    }
    const unknown = (opts.remove ?? []).filter((id) => !board.parts.some((p) => p.id === id));
    if (unknown.length) throw new Error(`No part ${unknown.join(', ')} on this board; monitoring_status lists the board.`);
    const kept = opts.replace ? [] : board.parts.filter((p) => !(opts.remove ?? []).includes(p.id));
    if (kept.length + specs.length > BOARD_LIMITS.parts) {
        throw new Error(`A board holds ${BOARD_LIMITS.parts} parts; it has ${kept.length}. Remove some (remove) or start over (replace).`);
    }
    let seq = board.seq;
    const placed: Part[] = (specs as PartSpec[]).map((s) => ({ ...pick(s), id: `p${++seq}`, open: true, at: opts.now }));
    return { board: { record: board.record, parts: [...kept, ...placed], seq }, placed: placed.map((p) => p.id) };
}

/** Only the fields a part is made of: whatever else came with the call is not kept. */
function pick(s: PartSpec): PartSpec {
    const out: PartSpec = { kind: s.kind };
    if (s.title !== undefined) out.title = s.title.trim();
    if (s.text !== undefined) out.text = s.text.trim();
    if (s.module !== undefined) out.module = s.module;
    if (s.run !== undefined) out.run = s.run;
    if (s.against !== undefined) out.against = { ...(s.against.record ? { record: s.against.record } : {}), ...(s.against.run ? { run: s.against.run } : {}) };
    if (s.channels !== undefined) out.channels = [...s.channels];
    if (s.context !== undefined) out.context = [...s.context];
    if (s.seconds !== undefined) out.seconds = s.seconds;
    if (s.band !== undefined) out.band = s.band;
    return out;
}

/** The owner opening or closing a part. */
export function toggle(board: Board, id: string): Board {
    return { ...board, parts: board.parts.map((p) => (p.id === id ? { ...p, open: !p.open } : p)) };
}

/** The owner moving a part one place up (-1) or down (+1). */
export function move(board: Board, id: string, by: -1 | 1): Board {
    const i = board.parts.findIndex((p) => p.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= board.parts.length) return board;
    const parts = [...board.parts];
    [parts[i], parts[j]] = [parts[j], parts[i]];
    return { ...board, parts };
}

/** The board as the assistant reads it back: what is on it, in the owner's order, and what is open. */
export function boardLine(board: Board): Array<{ id: string; kind: PartKind; title: string | null; open: boolean }> {
    return board.parts.map((p) => ({ id: p.id, kind: p.kind, title: p.title ?? null, open: p.open }));
}
