/**
 * The app's test hooks, in one place, as literal types.
 *
 * Three Playwright suites drive this UI (`e2e`, `review-func`, `shots`). They
 * select by `data-test`, which means those strings are an interface with an
 * external consumer — and the failure mode of an interface nobody typed is that
 * a rename here turns a suite green by making it match nothing.
 *
 * So the hooks are values, `tid(...)` is how a component spells one, and the
 * union below is what a suite may ask for. Renaming a hook without updating its
 * users is a compile error; deleting one that a suite still names is caught by
 * the check in `testIds.test.ts`, which compares this record against the list
 * the suites actually use.
 *
 * ## Names are the predecessor's where the thing is the predecessor's
 *
 * The PWA's suites are being ported, not rewritten, so a hook that means the
 * same thing keeps the same string. Two concepts were renamed in this port and
 * their hooks are renamed with them — CALIBRATION became ADAPTATION and
 * TESTJOBS became ACTUATOR — because a hook called `tab-calibration` on a tab
 * labelled ADAPTATION is a lie that a passing test would preserve. Those two are
 * the diff a suite port has to make, and they are listed here so it is a known
 * diff rather than a surprise.
 *
 * ## This grows with the UI, not ahead of it
 *
 * Only hooks that something actually renders belong here. A record listing hooks
 * for components that do not exist claims a surface the app does not have, and
 * the suites would be selecting nothing while this file said otherwise.
 */

export const TEST_ID = {
    // --- the gate ---------------------------------------------------------
    gateDialog: 'gate-dialog',
    /** Every checkbox in the gate. The suites count them and tick them all. */
    gateCond: 'gate-cond',
    gateRun: 'gate-run',
    gateCancel: 'gate-cancel',

    // --- the actuator list -------------------------------------------------
    actuatorRun: 'tj-run',
    actuatorStart: 'tj-start',
    actuatorStop: 'tj-stop',
} as const;

export type TestIdKey = keyof typeof TEST_ID;
export type TestId = (typeof TEST_ID)[TestIdKey];

/**
 * Spell a hook onto an element: `<button {...tid(TEST_ID.gateRun)}>`.
 *
 * Takes the union, not a string, so a typo is a compile error rather than a
 * selector that matches nothing at 2am on a bench.
 */
export function tid(id: TestId): { 'data-test': TestId } {
    return { 'data-test': id };
}

/**
 * Hooks whose names changed from the predecessor's, and what they were.
 *
 * Kept as data so the suite port has a list to work from instead of a diff to
 * discover. Empty is a fine state; it is not empty today.
 */
export const RENAMED_FROM: Readonly<Record<string, string>> = {
    // CALIBRATION -> ADAPTATION, TESTJOBS -> ACTUATOR. The hooks follow the
    // labels, because a hook that names the old concept survives a rename and
    // keeps a passing test pointing at the wrong idea.
    'tab-adaptation': 'tab-calibration',
    'tab-actuator': 'tab-testjobs',
};
