'use client';

import { CircleDot, Loader2, Play, PlayCircle, PlugZap, Radio, Square, Zap } from 'lucide-react';
import type { HubConfig, NoticeTone } from '@/components/Hub';
import type { useDs2Link } from '@/hooks/useDs2Link';
import { hubConfigFor, hubNoticeFor } from '@/lib/hub';
import { jobRiskOf, type CatalogJob } from '@/lib/ecuCatalog';
import { useLang } from '@/lib/i18n';
import { operationFor } from '@/lib/jobOps';
import type { RunVerdict } from '@/lib/runGate';
import type { Tab } from '@/lib/tabs';
import { viewHubFor } from '@/lib/viewHub';
import { hasDecoder } from '@/views/adaptation/AdaptationView';
import type { Datalog } from '@/views/datalog/useDatalog';

/**
 * The hub, resolved — and the one notice line that goes above it.
 *
 * Two pure functions decide this and neither of them may import React: the
 * link's tiers in `lib/hub`, the view's in `lib/viewHub`. What is left is
 * plumbing — which glyph means READ, which string table entry, which handler —
 * and it is here so the shell states WHAT is true rather than how it is spelled.
 *
 * The glyphs are chosen once, in this file. `Loader2` rather than the state's own
 * icon for BUSY is the load-bearing one: `animate-spin` rotates whatever it is
 * handed, and a plug or a bolt spun end over end reads as a corrupt icon instead
 * of as progress, at the two moments the operator most needs to believe the tool
 * is alive.
 */
export function useHub(input: {
    tab: Tab;
    link: ReturnType<typeof useDs2Link>;
    datalog: Datalog;
    practiceArmed: boolean;
    ecuId: string;
    selectedJob: CatalogJob | null;
    runVerdict: RunVerdict | null;
    catalogError: string | null;
}): { hub: HubConfig; notice: { text?: string; tone: NoticeTone } } {
    const { t } = useLang();
    const { link, datalog, selectedJob, runVerdict } = input;

    const hub = hubConfigFor({
        linkState: link.state,
        practiceArmed: input.practiceArmed,
        connect: (mode) => void link.connect(mode),
        fromView: viewHubFor({
            tab: input.tab,
            linkState: link.state,
            t: {
                hub_read: t.hub_read,
                hub_record: t.hub_record,
                hub_stop: t.hub_stop,
                hub_connected: t.hub_connected,
                op_run: t.op_run,
                op_start: t.op_start,
                samples: t.samples,
                plan_selectHint: t.plan_selectHint,
                adaptations_noDecoder: t.adaptations_noDecoder,
                runBlock: (reason) => t.runBlock[reason],
            },
            icons: { read: Zap, record: Radio, stop: Square, idle: CircleDot, run: Play, start: PlayCircle },
            readFaults: () => void link.readIdent().then(() => link.readFaults()),
            datalog: {
                sampleCount: datalog.samples.length,
                costNotice: datalog.costNotice,
                start: datalog.start,
                stop: datalog.stop,
            },
            adaptation: { decoded: hasDecoder(input.ecuId), read: () => void link.readAdaptations() },
            service: {
                selected: selectedJob
                    ? { isProcedure: operationFor(selectedJob).kind === 'procedure', risk: jobRiskOf(selectedJob) }
                    : null,
                verdict: runVerdict,
                run: () => {
                    // The gate's answer, used — not re-derived. `mayRun` decided
                    // this once, and the hub and the panel read the same object.
                    if (runVerdict?.allowed === true && selectedJob) {
                        void link.runRead(selectedJob.id, runVerdict.telegram.hex);
                    }
                },
            },
        }),
        t: {
            hub_connect: t.hub_connect,
            hub_connecting: t.hub_connecting,
            hub_busy: t.hub_reading,
            hub_connected: t.hub_connected,
            mode_practice: t.mode_practice,
        },
        icons: { plug: PlugZap, loader: Loader2, idle: CircleDot },
    });

    // One line, one precedence: a link error outranks a catalog error outranks
    // whatever the hub wanted to say about cost or progress. The hub's own
    // notice is never urgent, so it always loses.
    const notice = hubNoticeFor({
        linkError: link.error ?? undefined,
        catalogError: input.catalogError ?? undefined,
        viewNotice: hub.notice,
    });

    return { hub, notice };
}
