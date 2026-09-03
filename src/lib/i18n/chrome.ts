/**
 * The words that are the same in both languages, written once.
 *
 * The tabs, the hub's verbs, PRACTICE, DISCONNECT: English in the Japanese UI
 * too, on purpose. They are instrument tokens rather than prose — the ///M
 * idiom — and they sit in rows with machine identity (`MSS54`, a DS2 address, a
 * job id) where a Japanese common noun would break the row's vocabulary without
 * telling the reader anything the glyph beside it had not already said.
 *
 * The point of the file is that two spellings are now UNREPRESENTABLE. The
 * catalogs are typed as `Localised`, which does not declare these keys, so
 * writing `tab_diagnosis: '診断'` into ja.ts is an excess-property error rather
 * than a divergence nobody notices until both spellings appear in one
 * screenshot. There are 29 of them and they had been kept in step by hand.
 *
 * What is NOT here: any sentence that explains a consequence. The safety copy —
 * what a confirmation destroys, why a control refuses — is language-switched
 * and lives in ja.ts and en.ts, like everything else the reader has to READ
 * rather than recognise.
 */
export const CHROME = {
    appRole: 'DIAGNOSIS',
    tab_diagnosis: 'DIAGNOSIS',
    tab_datalog: 'DATALOG',
    tab_log: 'COMMS LOG',
    // Sub-action row, under the hub. Same vocabulary as the hub itself.
    disconnect: 'Disconnect',
    practice: 'PRACTICE',
    exportCsv: 'Export CSV',
    retry: 'Retry',
    tab_calibration: 'CALIBRATION',
    tab_testjobs: 'ACTUATOR TEST',
    tab_actuator: 'ACTUATOR',
    // --- The hub cluster's verbs. English in BOTH languages. ---
    //
    // These are the labels ON the controls: the hub's own verb and the
    // sub-action row under it. They join DIAGNOSIS / DATALOG / SERVICE /
    // PRACTICE / MODULE as one chrome vocabulary, the same one the
    // reference tuner uses (CONNECTION / READ / WRITE).
    //
    // The boundary is deliberate and it is NOT "English everywhere":
    // anything that explains, warns or asks for consent stays in the
    // reader's language — the notice line, the run-block reasons, every
    // dialog body and its confirm/cancel buttons. A verb on a button is
    // chrome; a sentence about what it will destroy is safety copy.
    hub_connect: 'Connect',
    hub_connecting: 'Linking',
    hub_connected: 'Linked',
    hub_read: 'Read',
    hub_reading: 'Reading',
    hub_record: 'Record',
    hub_stop: 'Stop',
    hub_recording: 'Recording',
    pane_visualization: 'VISUALIZATION & CONTROLS',
    details: 'Details',

    // The hub's verb in the SERVICE tab, and the STOP/ABORT beside it.
    // Same rule as hub_* above: the label on the control is English, the
    // reason it is blocked (op_blocked_*, runBlock) is not.
    op_run: 'Run',
    op_stop: 'Stop',
    op_abort: 'Abort',
    op_start: 'Start',
    tab_adaptation: 'ADAPTATION',
    adaptations_read: 'Read adaptations',
    // The BUTTON is English like the rest of the row. Everything the dialog
    // then says — what is destroyed, that it cannot be undone — stays
    // Japanese. That is the line: chrome in one vocabulary, consent in the
    // reader's language.
    clearFaults: 'Clear faults',

    tab_service: 'SERVICE',
    // The one exit from the disclaimer. A verb, like every other verb in this
    // file; the SENTENCES it agrees to are language-switched, in ja.ts / en.ts.
    disclaimer_agree: 'Agree',
    // The wizard's navigation. Verbs, like every other verb in this file; the
    // sentences they move between are language-switched.
    wiz_next: 'Next',
    wiz_back: 'Back',
    wiz_close: 'Close',
} as const;

export type Chrome = typeof CHROME;
