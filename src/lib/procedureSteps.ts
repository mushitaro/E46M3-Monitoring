'use client';

/**
 * Steps — the thing an operator actually needs, from the three shapes the data
 * happens to come in.
 *
 * ## Why one model
 *
 * "The steps" arrive three different ways and were rendered three different
 * ways, none of them as steps:
 *
 *   1. An SMG II SEQUENCE is a list of procedures. It was drawn as a row of hex
 *      chips — `0x01 → 0x05 → 0x04 → …` — with the human name of each step
 *      available only in a `title=` tooltip. The full-service re-adaptation
 *      literally spells out "bleed the clutch, bleed the actuator, measure the
 *      accumulator pre-charge, learn the clutch valve characteristics…" and the
 *      app showed seven hex numbers.
 *   2. An SMG II PROCEDURE reports its phases as `activity[]` — 21 of them for a
 *      complete gearbox adaptation, including `Gang 1 ausmessen` through
 *      `Gang R ausmessen`. That was a collapsed `<details>` reference table.
 *   3. A DSC JOB FAMILY is a set of sibling jobs (`DRUCKABBAU_VL/VR/HA`). Those
 *      were loose rows in a 54-job list.
 *
 * One `StepPlan`, one `StepList`. What differs between the three is honestly
 * different, so it is a FIELD rather than a second component — see `order`.
 *
 * ## Live progress is a parameter, not a second code path
 *
 * Pass `LiveProgress` and the steps light up; omit it and every step is
 * `pending`, which is exactly right for a plan you are reading before pressing
 * anything. There is no run surface yet, so today it is always omitted — and the
 * shape is deliberately built so that adding one means adding a poll loop, not a
 * second renderer.
 */

import { humanName, type HumanName } from '@/components/ui';
import { decodeCode, type CodedText, type Smg2Procedure, type Smg2Sequence } from '@/lib/smg2Workflows';
import type { OpStep, WhyKey } from '@/lib/jobOps';

export type StepState =
    /** Not reached. */
    | 'pending'
    /** The ECU says it is doing this now. */
    | 'running'
    /**
     * The ECU has moved beyond this.
     *
     * NOT `done`. The ECU reports only the code it is on, and the vocabulary is
     * not guaranteed to be traversed linearly — `Einlegehaenger nachbearbeiten`
     * is skipped when there is nothing to re-work. Calling an earlier step "done"
     * would be a claim the wire never made.
     */
    | 'passed'
    /** Finished, and the ECU said so. */
    | 'done'
    | 'failed'
    /** A code arrived that is not in this procedure's vocabulary. Reported, never dropped. */
    | 'unknown';

export interface Step {
    key: string;
    /**
     * 1-based, from array position. **Never from a sort** — see `stepsFromActivity`.
     * 0 means "not a numbered step" (a sentinel, or an unordered set).
     */
    ordinal: number;
    /** The primary text. */
    name: HumanName;
    /** The SGBD token: an activity code, a job id, a test-program number. */
    token: string;
    /** The SGBD's German. Shown quiet underneath — it is the authoritative wording. */
    de?: string;
    ref:
        | { kind: 'procedure'; id: string }
        | { kind: 'activity'; code: string }
        | { kind: 'job'; id: string }
        | { kind: 'protocol'; id: string };
    state: StepState;
    /** What the ECU said happened, once it has said anything. */
    outcome?: { code: string; name: HumanName; de?: string; tone: 'ok' | 'fail' };
    /** A number this step measured. */
    reading?: { value: number; unit?: string; band?: { min: number; max: number } };
    /**
     * This slot exists but the SGBD has no job for it.
     *
     * The DSC has `DRUCKAUFBAU_VL` and `DRUCKAUFBAU_HA` and no `_VR`. That gap is
     * the ECU's, and a row that states it is stronger than a silently shorter
     * list — so absence travels as data, with its reason attached.
     */
    absence?: HumanName;
    /** Extra facts worth a line: duration, engine state. */
    meta?: Array<{ label: string; value: string; warn?: boolean }>;
    onPick?: () => void;
}

export interface StepPlan {
    /**
     * What the ordering MEANS. Rendered, always.
     *
     * `unordered-set` suppresses ordinals: a DSC wheel family is a SET, and
     * numbering `DRUCKABBAU_VL` "1" would fabricate an order the SGBD does not
     * have. Making the third shape's honesty a field is what lets one component
     * cover all three.
     */
    order: 'ecu-defined' | 'app-recommended' | 'unordered-set';
    /** The source's own caveat about its order, verbatim. */
    note?: HumanName;
    steps: Step[];
}

export interface LiveProgress {
    /** `INFO_STATUS_BYTE` — which activity the ECU says it is on. */
    activityCode?: string;
    /** `TEST_STATUS_BYTE` — 0x00 condition not met, 0x01 running, 0x02 completed, 0x03 aborted. */
    testStatus?: string;
    /** The result code, once there is one. */
    faultCode?: string;
    /** `STAT_INFO_STATUS2_WERT`, where the procedure returns a measurement. */
    value?: number;
}

const TEST_STATUS_COMPLETED = '0x02';
const TEST_STATUS_ABORTED = '0x03';

/**
 * Is this vocabulary entry a state rather than a step?
 *
 * `0xFF` is always the "unknown code" fallback. `0x00` is NOT reliably a
 * sentinel: in `0x07` it reads `Testprogramm noch nicht gestartet` (a state), but
 * in `0x01`, `0x03` and `0x04` it reads `Testprogramm Initialisierung` — which is
 * genuinely the first thing the procedure does. So this keys on the German, not
 * on the code.
 */
function isSentinel(c: CodedText): boolean {
    if (c.code.toLowerCase() === '0xff') return true;
    return /noch nicht gestartet/i.test(c.de ?? '');
}

function pick(x: { ja: string; en: string }, lang: 'ja' | 'en'): HumanName {
    return humanName(lang === 'en' ? x.en : x.ja);
}

/**
 * A sequence: several procedures in a stated order.
 *
 * The order is the one thing here the SGBD does NOT define, and the data says so
 * in its own note. That note is carried verbatim rather than smoothed into a
 * recommendation — "based on inter-step dependencies and service practice,
 * confirm against TIS" is a materially different claim from "run these in this
 * order", and on a gearbox adaptation the difference is expensive.
 */
export function stepsFromSequence(
    seq: Smg2Sequence,
    procedures: Smg2Procedure[],
    lang: 'ja' | 'en',
    onPick?: (testprg: string) => void,
    /** `engine` is a vocabulary, not a string. Resolved by the caller, which has the catalogue. */
    engineText?: (engine: string) => string,
): StepPlan {
    const steps = seq.steps.map((id, i): Step => {
        const p = procedures.find((x) => x.id === id);
        const meta: Step['meta'] = [];
        if (p?.durMax) meta.push({ label: 'duration', value: p.durMax });
        if (p) meta.push({ label: 'engine', value: engineText?.(p.engine) ?? p.engine, warn: p.engine === 'run' });
        return {
            key: `seq:${seq.id}:${i}:${id}`,
            ordinal: i + 1,
            name: p ? pick(p.name, lang) : humanName(id),
            token: id,
            de: p?.name.de,
            ref: { kind: 'procedure', id },
            state: 'pending',
            meta: meta.length ? meta : undefined,
            onPick: onPick ? () => onPick(id) : undefined,
        };
    });
    return { order: 'app-recommended', note: pick(seq.note, lang), steps };
}

/**
 * A procedure's own phases, as the ECU reports them.
 *
 * **Never sorted.** `activity[]` is in EXECUTION order, which is not numeric
 * order: complete gearbox adaptation runs 0x00, 0x01, 0x28, 0x29, 0x2A, 0x02,
 * 0x03, 0x04… Sorting it would produce a plausible, wrong sequence, so a fixture
 * test pins the first four tokens.
 */
export function stepsFromActivity(
    proc: Smg2Procedure,
    lang: 'ja' | 'en',
    live?: LiveProgress,
): StepPlan {
    const at = live?.activityCode
        ? proc.activity.findIndex((a) => a.code.toLowerCase() === live.activityCode!.toLowerCase())
        : -1;
    const outcome = live?.faultCode ? decodeCode(proc.faults, live.faultCode) : null;
    const aborted = live?.testStatus === TEST_STATUS_ABORTED;
    const completed = live?.testStatus === TEST_STATUS_COMPLETED;

    let ordinal = 0;
    const steps = proc.activity.map((a, i): Step => {
        const sentinel = isSentinel(a);
        if (!sentinel) ordinal += 1;
        let state: StepState = 'pending';
        if (at >= 0) {
            if (i < at) state = 'passed';
            else if (i === at) state = aborted ? 'failed' : completed ? 'done' : 'running';
        }
        return {
            key: `act:${proc.id}:${i}:${a.code}`,
            ordinal: sentinel ? 0 : ordinal,
            name: pick(a, lang),
            token: a.code,
            de: a.de,
            ref: { kind: 'activity', code: a.code },
            state,
            outcome:
                i === at && outcome
                    ? {
                          code: outcome.code,
                          name: pick(outcome, lang),
                          de: outcome.de,
                          tone: aborted ? 'fail' : 'ok',
                      }
                    : undefined,
            reading: i === at && live?.value !== undefined ? { value: live.value } : undefined,
        };
    });

    // A code the ECU reported that this procedure's vocabulary does not contain.
    // It gets a row saying so. Dropping it would hide the one event most worth
    // seeing — the ECU doing something we cannot name.
    if (live?.activityCode && at < 0) {
        steps.push({
            key: `act:${proc.id}:unknown:${live.activityCode}`,
            ordinal: 0,
            name: humanName(''),
            token: live.activityCode,
            ref: { kind: 'activity', code: live.activityCode },
            state: 'unknown',
        });
    }

    return { order: 'ecu-defined', steps };
}

/**
 * The wire plan for an ordinary job, from `jobOperation()`.
 *
 * `whyText` is injected rather than imported: the per-step reasons are safety
 * copy and live in the i18n catalogue, and this module is meant to stay testable
 * without a language.
 */
export function stepsFromOperation(
    steps: readonly OpStep[],
    whyText: (k: WhyKey) => string,
): StepPlan {
    return {
        order: 'ecu-defined',
        steps: steps.map((s, i) => ({
            key: `op:${i}:${s.job}`,
            ordinal: i + 1,
            name: humanName(whyText(s.why)),
            token: s.job,
            ref: { kind: 'job', id: s.job },
            state: 'pending',
        })),
    };
}

/**
 * A family of sibling jobs that address different places on the car.
 *
 * `order: 'unordered-set'` — these are alternatives, not a sequence. A site with
 * no job carries its `absence` sentence instead of a run affordance.
 */
export interface JobFamilySite {
    site: string;
    name: HumanName;
    job: string | null;
    absence?: HumanName;
    detail?: string;
}

export function stepsFromJobFamily(familyId: string, sites: JobFamilySite[]): StepPlan {
    return {
        order: 'unordered-set',
        steps: sites.map((s) => ({
            key: `fam:${familyId}:${s.site}`,
            ordinal: 0,
            name: s.name,
            token: s.job ?? s.site,
            ref: { kind: 'job', id: s.job ?? s.site },
            state: 'pending',
            absence: s.absence,
            meta: s.detail ? [{ label: 'valves', value: s.detail }] : undefined,
        })),
    };
}
