/**
 * How the last SMG II procedure ended, as the page keeps it for the assistant (monitoring_status
 * `lastProcedure`, IJ F10): its program and name, how it ended, and why — in a sentence the assistant
 * can say, the same story the dialog tells.
 */
export interface ProcedureEnd {
    /** The program number (0x01 …). */
    program: string;
    name: string;
    nameJa: string;
    /** ok: the module said it finished; notOk: it finished and said not properly; aborted: ABORT or a stop;
     *  refused: the module answered a step with a refusal; failed: no answer, or not sent (with why). */
    ended: 'ok' | 'notOk' | 'aborted' | 'refused' | 'failed';
    reason: string | null;
    at: string;
}

/** The assistant's sentence for an ending. */
export function procedureReason(ended: ProcedureEnd['ended'], error: string | null, refusedStatus: number | null): string | null {
    if (ended === 'refused')
        return `The module refused a step (negative answer, status 0x${(refusedStatus ?? 0).toString(16).padStart(2, '0')}): the procedure was stopped (TESTPRG_STOP sent).`;
    if (ended === 'failed') return `It ended without finishing: ${error ?? 'no answer'}. TESTPRG_STOP was sent.`;
    if (ended === 'notOk') return 'The module said the test program did not finish properly.';
    if (ended === 'aborted') return 'Ended by ABORT or a stop before it finished.';
    return null;
}
