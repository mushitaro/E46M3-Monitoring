/**
 * One shape for every "not started" the assistant's tools answer (ASSISTANT-LAYERS.md 5.4, C7):
 * the sentence to say, which stop of the closed list it is (docs/NO-STOP.md §2, engine stopReasons.ts),
 * and the next step that makes it go. Before, 23 places in the facade each wrote a `reason` of their
 * own, and the assistant could not tell "stopped by a rule" from "use another tool" from "the tab is
 * busy" — so it said "can't" to all three.
 *
 *   - `S1`…`S7`: a stop of the closed list. `next` defaults to that stop's own next step.
 *   - `route`: not a stop: another tool or another way runs it (the sentence names which).
 *   - `state`: not a stop on the car: the tab's own state (the line is lost, a job is on, a run is
 *     going). It passes by itself or by one step, which `next` says.
 *
 * Pure, so vitest holds it; refusal.test.ts checks that the facade returns no `started: false` that
 * did not come from here.
 */
import { STOP_REASONS, type StopId } from '@tsunagi/monitoring-engine';

export type RefusalKind = StopId | 'route' | 'state';

export interface Refusal {
    started: false;
    /** The sentence for the assistant to say (the field the tools have always answered with). */
    reason: string;
    stop: RefusalKind;
    /** Who does what so it goes. */
    next: string;
}

export function refusal(stop: StopId, sentence: string, next?: string): Refusal;
export function refusal(stop: 'route' | 'state', sentence: string, next: string): Refusal;
export function refusal(stop: RefusalKind, sentence: string, next?: string): Refusal {
    const n = next ?? (stop === 'route' || stop === 'state' ? '' : STOP_REASONS[stop].nextEn);
    return { started: false, reason: sentence, stop, next: n || sentence };
}
