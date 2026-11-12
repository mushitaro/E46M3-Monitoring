/**
 * What MEMORY's SAVE says about PROBE.
 *
 * MEMORY's journal is quiet while PROBE runs (views/sessions/useJournal: an investigation keeps its
 * own record), so a saved session after a PROBE run counts no samples of it. That is where the run
 * belongs, not a loss — but an answer of `sampleCount: 0` alone reads as one. This is the sentence
 * and the counts that go with it: the runs of the open investigation, already on this device.
 */
export interface ProbeKept {
    record: string;
    runs: number;
    samples: number;
    note: string;
}

export function probeKept(
    record: string | null,
    runs: ReadonlyArray<{ samples: readonly unknown[] }>,
): ProbeKept | null {
    if (record === null || runs.length === 0) return null;
    const samples = runs.reduce((n, r) => n + r.samples.length, 0);
    return {
        record,
        runs: runs.length,
        samples,
        note:
            `PROBE runs are not part of this save and need none: each run is kept with its investigation on this device the moment it ends, ` +
            `and goes to the desk with the record. This investigation holds ${runs.length} run${runs.length === 1 ? '' : 's'}, ${samples} samples (monitoring_runs). ` +
            `sampleCount counts MANUAL recordings only; say this rather than that samples were lost.`,
    };
}
