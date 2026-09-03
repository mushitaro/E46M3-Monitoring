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
 * ## Why ACTUATOR supplies nothing
 *
 * It has 85 independently-runnable rows and a START and a STOP on each. Routing
 * them through one ring would be an extra click and a re-derived label, and the
 * ring cannot say WHICH solenoid it would energise. `Hub.tsx`'s own contract
 * note says views like this supply none; it falls through to tier 3.
 *
 * Pure, and the caller passes the strings, the glyphs and the handlers, so
 * vitest checks it under `environment: 'node'`.
 */
import type { LucideIcon } from 'lucide-react';
import type { HubConfig } from '@/components/Hub';
import type { LinkState } from '@/hooks/useDs2Link';
import type { RunVerdict } from '@/lib/runGate';
import type { Tab } from '@/lib/tabs';

export interface ViewHubStrings {
    hub_read: string;
    hub_record: string;
    hub_stop: string;
    hub_connected: string;
    op_run: string;
    op_start: string;
    samples: string;
    plan_selectHint: string;
    adaptations_noDecoder: string;
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
}

export interface ViewHubState {
    tab: Tab;
    linkState: LinkState;
    t: ViewHubStrings;
    icons: ViewHubIcons;
    /** DIAGNOSIS: read the identity, then the fault memory. */
    readFaults: () => void;
    datalog: {
        sampleCount: number;
        /** One round trip per BLOCK, not per channel — the view words it. */
        costNotice: string;
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
    };
}

export function viewHubFor(s: ViewHubState): HubConfig | null {
    // The log is running. Which tab is up does not change what the one primary
    // control should be — see the note at the top.
    if (s.linkState === 'logging') {
        return {
            label: s.t.hub_stop,
            Icon: s.icons.stop,
            tone: 'armed',
            onClick: s.datalog.stop,
            notice: `${s.datalog.sampleCount} ${s.t.samples}`,
        };
    }

    switch (s.tab) {
        case 'diagnosis':
            return { label: s.t.hub_read, Icon: s.icons.read, tone: 'ready', onClick: s.readFaults };

        case 'datalog':
            return {
                label: s.t.hub_record,
                Icon: s.icons.record,
                tone: 'ready',
                onClick: s.datalog.start,
                notice: s.datalog.costNotice,
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
                      // "No decoder ported" is a different sentence from "this
                      // module has none", and the hub says which one it means.
                      notice: s.t.adaptations_noDecoder,
                  };

        case 'service': {
            const sel = s.service.selected;
            if (!sel) {
                return {
                    label: s.t.hub_connected,
                    Icon: s.icons.idle,
                    tone: 'idle',
                    disabled: true,
                    notice: s.t.plan_selectHint,
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

        case 'actuator':
            return null;
    }
}
