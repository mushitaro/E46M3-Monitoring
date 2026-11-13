/**
 * Two observations side by side, and one value across many — what a periodic observation is for
 * (operator, 2026-11-01: "carry the session on, observe again, compare with last time, and judge on
 * the history").
 *
 * Runs are compared value by value: the same channel in both, its count, mean, min and max in each,
 * and how far the mean moved. Learned values (an `adapt` step) and every module's fault answer are
 * compared too. Nothing here judges: a change is a number, and whether it matters is the plan's
 * judgements' (with their provenance) or the reader's.
 *
 * Runs taken under different conditions are not made comparable by this file. It says what each
 * run was (record, plan version, length, PRACTICE or the car) so the reader can tell.
 *
 * Pure: the bridge's compare and the desk read the same numbers.
 */
import type { ProbeRun } from '@tsunagi/monitoring-engine';
import { diffForms, judgeKey, measures, type Form, type ItemDiff } from './items';

export interface RunRef {
    record: string;
    n: number;
    planV: number;
    startedAt: number;
    seconds: number;
    samples: number;
    mock: boolean;
}

export interface ChannelStats {
    n: number;
    mean: number;
    min: number;
    max: number;
}

export interface ChannelChange {
    channel: string;
    a: ChannelStats | null;
    b: ChannelStats | null;
    /** b.mean − a.mean, when both have the channel. */
    delta: number | null;
    /** |delta| over the larger of the two spreads (max − min), so a quiet value's small move still shows. */
    relative: number | null;
}

export interface Comparison {
    a: RunRef;
    b: RunRef;
    channels: ChannelChange[];
    adaptations: Array<{ key: string; a: number | null; b: number | null; delta: number | null }>;
    faults: Array<{ module: string; what: string; a: string | null; b: string | null; same: boolean }>;
    /**
     * Each judgement in each run: pass, fail, or null when there were no samples to judge. With the
     * runs' forms known, only the judgements both measured — the same channel, statistic and
     * condition — and the rest are in `items`.
     */
    judges: Array<{ id: string; a: { value: number | null; pass: boolean | null } | null; b: { value: number | null; pass: boolean | null } | null }>;
    /** Channels in one run only. */
    onlyIn: { a: string[]; b: string[] };
    /**
     * How the two runs' forms differ, when both are known: the items both measured, those the later
     * form added (their series starts there) and those it removed (their history stays in the runs
     * that had them). Null when a form is not on this device.
     */
    items: ItemDiff | null;
}

type Run = ProbeRun & { sessionId: string; n: number; mock?: boolean };

export function runRef(r: Run): RunRef {
    return {
        record: r.sessionId,
        n: r.n,
        planV: r.planV,
        startedAt: r.startedAt,
        seconds: Math.round((r.endedAt - r.startedAt) / 1000),
        samples: r.samples.length,
        mock: !!r.mock,
    };
}

export function channelStats(r: Pick<ProbeRun, 'samples'>): Map<string, ChannelStats> {
    const acc = new Map<string, { n: number; sum: number; min: number; max: number }>();
    for (const s of r.samples) {
        for (const [k, v] of Object.entries(s.values)) {
            if (typeof v !== 'number' || !Number.isFinite(v)) continue;
            const x = acc.get(k) ?? { n: 0, sum: 0, min: Infinity, max: -Infinity };
            x.n++;
            x.sum += v;
            x.min = Math.min(x.min, v);
            x.max = Math.max(x.max, v);
            acc.set(k, x);
        }
    }
    const out = new Map<string, ChannelStats>();
    for (const [k, x] of acc) out.set(k, { n: x.n, mean: round(x.sum / x.n), min: round(x.min), max: round(x.max) });
    return out;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** The last answer each module gave to each one-shot read in a run. */
function lastAnswers(r: ProbeRun): Map<string, string | null> {
    const out = new Map<string, string | null>();
    for (const x of r.exchanges) {
        if (x.what.startsWith('LIVE_') || x.what.startsWith('RAM_') || x.what.startsWith('ADAPT_')) continue;
        if (x.outcome === 'ok') out.set(`${x.module}\u0000${x.what}`, x.response);
    }
    return out;
}

export function compareRuns(a: Run, b: Run, opts: { channels?: readonly string[]; limit?: number; forms?: { a: Form | null; b: Form | null } } = {}): Comparison {
    const sa = channelStats(a);
    const sb = channelStats(b);
    const formA = opts.forms?.a ?? null;
    const formB = opts.forms?.b ?? null;
    const wanted = opts.channels?.length ? new Set(opts.channels) : null;
    const keys = [...new Set([...sa.keys(), ...sb.keys()])].filter((k) => !wanted || wanted.has(k));
    // With both forms known, a value is compared only when both forms name it: one read on the
    // way (a whole block for one of its values) was not measured, and one form's item alone is
    // in `items` as added or removed.
    const common = (k: string) => sa.has(k) && sb.has(k) && (!formA || !formB || (measures(formA, k) && measures(formB, k)));
    const channels: ChannelChange[] = keys
        .filter(common)
        .map((k) => {
            const x = sa.get(k)!;
            const y = sb.get(k)!;
            const delta = round(y.mean - x.mean);
            const spread = Math.max(x.max - x.min, y.max - y.min);
            const relative = spread > 0 ? round(Math.abs(delta) / spread) : delta === 0 ? 0 : null;
            return { channel: k, a: x, b: y, delta, relative };
        })
        // The values that moved most, relative to how much they move anyway, first.
        .sort((p, q) => (q.relative ?? Infinity) - (p.relative ?? Infinity) || Math.abs(q.delta ?? 0) - Math.abs(p.delta ?? 0));

    const aa = a.adaptations ?? {};
    const ab = b.adaptations ?? {};
    const adaptations = [...new Set([...Object.keys(aa), ...Object.keys(ab)])]
        .sort()
        .map((key) => {
            const x = aa[key] ?? null;
            const y = ab[key] ?? null;
            return { key, a: x, b: y, delta: x !== null && y !== null ? round(y - x) : null };
        });

    const fa = lastAnswers(a);
    const fb = lastAnswers(b);
    const faults = [...new Set([...fa.keys(), ...fb.keys()])].sort().map((k) => {
        const [module, what] = k.split('\u0000');
        const x = fa.get(k) ?? null;
        const y = fb.get(k) ?? null;
        return { module, what, a: x, b: y, same: x === y };
    });

    const items = formA && formB ? diffForms(formA, formB) : null;
    const judges = items ? judgesByItem(a, b, formA!, formB!) : judgesById(a, b);

    return {
        a: runRef(a),
        b: runRef(b),
        channels: channels.slice(0, opts.limit ?? 30),
        adaptations,
        faults,
        judges,
        onlyIn: {
            a: keys.filter((k) => sa.has(k) && !sb.has(k)),
            b: keys.filter((k) => sb.has(k) && !sa.has(k)),
        },
        items,
    };
}

type JudgeRow = Comparison['judges'][number];

/** Without the forms: by the judgement's id, as the runs named them. */
function judgesById(a: Run, b: Run): JudgeRow[] {
    const ja = new Map(a.judges.map((j) => [j.id, { value: j.value, pass: j.pass }]));
    const jb = new Map(b.judges.map((j) => [j.id, { value: j.value, pass: j.pass }]));
    return [...new Set([...ja.keys(), ...jb.keys()])].map((id) => ({ id, a: ja.get(id) ?? null, b: jb.get(id) ?? null }));
}

/**
 * With the forms: a judgement is matched by what it measured and under which condition, so one
 * whose condition changed is not set beside its old self. Only those both runs measured.
 */
function judgesByItem(a: Run, b: Run, fa: Form, fb: Form): JudgeRow[] {
    const keyed = (r: Run, f: Form) => {
        const defs = new Map((f.judge ?? []).map((j) => [j.id, judgeKey(j)]));
        return new Map(r.judges.flatMap((j) => (defs.has(j.id) ? [[defs.get(j.id)!, j] as const] : [])));
    };
    const ka = keyed(a, fa);
    const kb = keyed(b, fb);
    return [...kb.keys()]
        .filter((k) => ka.has(k))
        .map((k) => {
            const x = ka.get(k)!;
            const y = kb.get(k)!;
            return { id: y.id, a: { value: x.value, pass: x.pass }, b: { value: y.value, pass: y.pass } };
        });
}

/** One value across many runs, oldest first: the history a periodic observation is judged on. */
export function trend(runs: readonly Run[], channels: readonly string[]): Array<{ channel: string; points: Array<{ run: RunRef; stats: ChannelStats | null; learned: number | null }> }> {
    const stats = runs.map((r) => ({ ref: runRef(r), s: channelStats(r), learned: r.adaptations ?? {} }));
    return channels.map((channel) => ({
        channel,
        points: stats.map((x) => ({ run: x.ref, stats: x.s.get(channel) ?? null, learned: channel.startsWith('adapt:') ? (x.learned[channel] ?? null) : null })),
    }));
}
