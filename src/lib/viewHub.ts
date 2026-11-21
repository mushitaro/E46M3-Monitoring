/**
 * Tier 2 of the hub: what the CURRENT VIEW would offer, if the link let it.
 *
 * `lib/hub.ts` owns tiers 1 and 3 — the link's own answers, and the "nothing to
 * do" fallback. This is the middle, and it lived inline in the shell where the
 * five branches sat under one `if (tab === …)` chain that nothing could test.
 *
 * ## The running log outranks the tab
 *
 * One rule here is not "whatever tab is up". While a log is running the hub is
 * the datalog view's STOP, on every tab. The predecessor got this by putting
 * `logging` in the link tier, which worked but put a view's stop handler in the
 * layer that is supposed to know nothing about views. Stated here instead, where
 * the reason is visible: a recording is a thing that is HAPPENING, and its stop
 * has to stay one press away from wherever the operator wandered to. Exactly the
 * argument that keeps ACTUATOR's STOP out of the sub-action row.
 *
 * ## Every tab has a verb (docs/UX-DESIGN.md §1)
 *
 * The ring is the one thing to press on the screen, and a ring with nothing to
 * press (the old LINKED) is not shown any more. A job table with nothing chosen
 * shows its verb disabled and says what it waits for. ACTUATOR's rows still
 * carry their own START and RUN (each names the part it drives), so its ring is
 * that verb, disabled, until something is on — then it is the thing's STOP
 * (lib/hub tier 0), the one place to stop it.
 *
 * Pure, and the caller passes the strings, the glyphs and the handlers, so
 * vitest checks it under `environment: 'node'`.
 */
import type { LucideIcon } from 'lucide-react';
import type { HubConfig } from '@/components/Hub';
import type { LinkState } from '@/hooks/useDs2Link';
import type { RunVerdict } from '@tsunagi/monitoring-engine';
import type { Tab } from '@/lib/tabs';

export interface ViewHubStrings {
    hub_read: string;
    hub_record: string;
    hub_stop: string;
    hub_connected: string;
    op_run: string;
    op_start: string;
    samples: string;
    /** The job tables with nothing chosen: what the verb waits for. */
    hub_pickRow: string;
    /** ACTUATOR: its rows start what they drive; the ring stops it. */
    hub_actuatorRows: string;
    /** Short forms for the notice line: the screen's MAIN says the whole sentence. */
    hub_noReadFrame: string;
    hub_dmeOnly: string;
    next_session: string;
    probe_notRunnable: string;
    /** The refusal, already resolved to a sentence — `t.runBlock[reason]`. */
    runBlock: (reason: Extract<RunVerdict, { allowed: false }>['reason']) => string;
}

export interface ViewHubIcons {
    read: LucideIcon;
    record: LucideIcon;
    stop: LucideIcon;
    idle: LucideIcon;
    run: LucideIcon;
    start: LucideIcon;
    probe: LucideIcon;
    next: LucideIcon;
    save: LucideIcon;
}

export interface ViewHubState {
    tab: Tab;
    linkState: LinkState;
    t: ViewHubStrings;
    icons: ViewHubIcons;
    /** DIAGNOSIS: read the identity, then the fault memory. */
    readFaults: () => void;
    /** The module's own SGBD gives the app an IDENT or a fault-read frame to send it. */
    faultsAvailable: boolean;
    /**
     * DIAGNOSIS with ALL MODULES chosen: READ is every module's fault read, one address at a time
     * (lib/probe/scan), and `line` says how far one in progress has got.
     */
    scan?: { run: () => void; line?: string };
    /** A PROBE plan is running on the link. Its STOP and its line, while it does. */
    probe?: { line: string; stop: () => void };
    /**
     * The PROBE tab: run the plan of the session on the screen. `runnable` is false when the
     * session has no plan that may run now (none, a fork, its mandate ended).
     */
    probeRun?: { runnable: boolean; run: () => void };
    /** STARTUP: carry the session on (NEXT). `blocked` is why it cannot go yet, said in the notice. */
    startup?: { next: () => void; blocked: string | null };
    /** MEMORY: SAVE, worded as its state (lib/sync/status `describeSave`). Works without a link. */
    memory?: { label: string; disabled: boolean; save: () => void };
    datalog: {
        /** This module's live-block layout is ported. Only the MSS54's is. */
        decoded: boolean;
        sampleCount: number;
        /** While recording: the mark, how long, and the engine speed and road speed now, read at a glance. */
        recordingLine?: string;
        /**
         * After a recording: what the press of STOP left — how long, how many samples. The cost
         * (items / blocks / round trips) is MAIN's, said there once, not here again (UX-04).
         */
        stoppedLine?: string;
        start: () => void;
        stop: () => void;
    };
    adaptation: {
        /** A ported decoder exists for this module. Absent is not "none". */
        decoded: boolean;
        read: () => void;
    };
    service: {
        /** Null when nothing is selected: a verb with no object. */
        selected: { isProcedure: boolean; risk: 'high' | 'medium' | 'low' } | null;
        /** From `mayRun`. The hub RENDERS this answer; it never derives one. */
        verdict: RunVerdict | null;
        run: () => void;
        /**
         * Open the guided procedure. Present only when the selection IS one.
         *
         * A procedure does not go out when the hub is pressed — the SMG II test
         * program is a sequence with a mandatory stop-before-start, a ten-second
         * ECU timeout and a status that has to be read by re-asking, so what the
         * hub opens is the wizard that runs it. Which means the GATE's answer is
         * not the right question for this button: opening a dialog sends
         * nothing, and the dialog is where "may I, and why not" gets a full
         * answer instead of a one-line refusal.
         */
        openProcedure?: () => void;
    };
}

export function viewHubFor(s: ViewHubState): HubConfig | null {
    // The log is running. Which tab is up does not change what the one primary
    // control should be — see the note at the top.
    // A PROBE run is the same kind of thing to the link, and is stopped the same way; what it reports
    // is its own. It holds the hub between its runs too, while it waits to begin the plan again
    // after the line dropped (useProbe): STOP there ends the wait.
    if (s.probe) return { label: s.t.hub_stop, Icon: s.icons.stop, tone: 'armed', onClick: s.probe.stop, notice: s.probe.line };
    if (s.linkState === 'logging') {
        return {
            label: s.t.hub_stop,
            Icon: s.icons.stop,
            tone: 'armed',
            onClick: s.datalog.stop,
            notice: s.datalog.recordingLine ?? `${s.datalog.sampleCount} ${s.t.samples}`,
        };
    }

    switch (s.tab) {
        case 'diagnosis':
            if (s.scan) return { label: s.t.hub_read, Icon: s.icons.read, tone: 'ready', onClick: s.scan.run, notice: s.scan.line };
            return s.faultsAvailable
                ? { label: s.t.hub_read, Icon: s.icons.read, tone: 'ready', onClick: s.readFaults }
                : {
                      label: s.t.hub_read,
                      Icon: s.icons.read,
                      tone: 'idle',
                      disabled: true,
                      notice: s.t.hub_noReadFrame,
                  };

        case 'datalog':
            if (!s.datalog.decoded) {
                return {
                    label: s.t.hub_record,
                    Icon: s.icons.record,
                    tone: 'idle',
                    disabled: true,
                    notice: s.t.hub_dmeOnly,
                };
            }
            return {
                label: s.t.hub_record,
                Icon: s.icons.record,
                tone: 'ready',
                onClick: s.datalog.start,
                notice: s.datalog.stoppedLine,
            };

        // The read is the hub here, not a sub-action. It is the one thing this
        // tab does, and a tab whose entire purpose sat in the row BELOW the
        // primary control had the hub saying LINKED with nothing to press.
        case 'adaptation':
            return s.adaptation.decoded
                ? { label: s.t.hub_read, Icon: s.icons.read, tone: 'ready', onClick: s.adaptation.read }
                : {
                      label: s.t.hub_read,
                      Icon: s.icons.read,
                      tone: 'idle',
                      disabled: true,
                      // No notice: MAIN already says the module's adaptations are not
                      // readable here, and the line does not say it a second time (UX-04).
                  };

        case 'service': {
            const sel = s.service.selected;
            // The verb, waiting for its object: not a dead LINKED ring.
            if (!sel) {
                return {
                    label: s.t.op_run,
                    Icon: s.icons.run,
                    tone: 'idle',
                    disabled: true,
                    notice: s.t.hub_pickRow,
                };
            }
            // A procedure opens its wizard. Not `armed-danger`, whatever its
            // risk: nothing is armed, because pressing this sends no frame.
            if (sel.isProcedure && s.service.openProcedure) {
                return {
                    label: s.t.op_start,
                    Icon: s.icons.start,
                    tone: 'ready',
                    onClick: s.service.openProcedure,
                };
            }
            const v = s.service.verdict;
            const allowed = v?.allowed === true;
            return {
                label: sel.isProcedure ? s.t.op_start : s.t.op_run,
                Icon: sel.isProcedure ? s.icons.start : s.icons.run,
                // Red only when the control is armed to do something
                // irreversible AND could actually go. An armed-looking ring on a
                // button that cannot fire is theatre.
                tone: !allowed ? 'idle' : sel.risk === 'high' ? 'armed-danger' : 'ready',
                disabled: !allowed,
                notice: v && !v.allowed ? s.t.runBlock(v.reason) : undefined,
                onClick: allowed ? s.service.run : undefined,
            };
        }

        // The rows start what they drive (each names its part, and a job that takes values chooses
        // them on its row); the ring is the verb until something is on, then that thing's STOP.
        case 'actuator':
            return { label: s.t.op_run, Icon: s.icons.run, tone: 'idle', disabled: true, notice: s.t.hub_actuatorRows };

        // SAVE works with or without a link, so it holds the ring while disconnected too (`offline`):
        // under the link's CONNECT it would vanish exactly when the cable is unplugged, which is
        // when an owner sits down to look back at a session.
        case 'memory':
            if (!s.memory) return null;
            return {
                label: s.memory.label,
                Icon: s.icons.save,
                tone: s.memory.disabled ? 'idle' : 'ready',
                disabled: s.memory.disabled,
                onClick: s.memory.disabled ? undefined : s.memory.save,
                offline: true,
            };

        // PROBE's board: the one thing to do here is run the session's form. Present only with the
        // link up (the link tier answers CONNECT before this), and said plainly when it may not.
        case 'probe':
            return s.probeRun?.runnable
                ? { label: s.t.op_start, Icon: s.icons.probe, tone: 'ready', onClick: s.probeRun.run }
                : { label: s.t.op_start, Icon: s.icons.probe, tone: 'idle', disabled: true, notice: s.t.probe_notRunnable };

        // STARTUP: NEXT carries the session on — the one step here, and one that needs no link (a
        // session is chosen before the drive), so it holds the ring disconnected too. NEW SESSION is
        // the sub-action; CONNECT is on the board's ring, where the session is run.
        case 'startup':
            if (!s.startup) return null;
            return s.startup.blocked
                ? { label: s.t.next_session, Icon: s.icons.next, tone: 'idle', disabled: true, notice: s.startup.blocked, offline: true }
                : { label: s.t.next_session, Icon: s.icons.next, tone: 'ready', onClick: s.startup.next, offline: true };
    }
}
