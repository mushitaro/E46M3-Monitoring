'use client';

import { useEffect, useState } from 'react';
import { commonIdent, loadEcuCatalog, readCutShort, type EcuProfile, type RawFaultRead, type ScanResult } from '@tsunagi/monitoring-engine';
import type { ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import { DiagnosisView } from './DiagnosisView';
import { useLang } from '../../lib/i18n';
import { standing } from './ScanView';

/** Open the module from its scan. Looking up a fault never sends another request. */
export function SelectedDiagnosis({ result, moduleId }: { result: ScanResult; moduleId: string }) {
    const { t } = useLang();
    const [profile, setProfile] = useState<EcuProfile | null>(null);
    useEffect(() => {
        let current = true;
        void loadEcuCatalog(moduleId).then(p => { if (current) setProfile(p); }, () => { if (current) setProfile(null); });
        return () => { current = false; };
    }, [moduleId]);

    const compact = (s: string) => s.replace(/\s+/g, '').toLowerCase();
    const identRequest = Array.from(commonIdent(parseInt(result.address, 16)), b => b.toString(16).padStart(2, '0')).join('');
    const isIdent = (request: string) => compact(request) === identRequest || (result.ident && compact(request) === compact(result.ident.request));
    const ident = result.exchanges.find(x => isIdent(x.request) && x.response);
    const answered = result.outcome === 'answered';
    const complete = answered && !readCutShort(result);
    const dmeFaults = moduleId === 'mss54' && answered && Array.isArray(result.decoded) &&
        (complete || result.decoded.length > 0) ? result.decoded as ErrorMemoryEntry[] : null;
    const raw: RawFaultRead[] = result.exchanges.filter(x => !isIdent(x.request)).map(x => ({
        request: x.request, response: x.response ?? '', source: result.variant?.sgbd ?? moduleId,
    }));
    // Partial positive evidence may be shown. No incomplete decoder is allowed to assert zero.
    if (answered && raw[0]) {
        const job = result.sgbdFaults;
        if (job?.module === moduleId && (job.stopped !== null || job.status === 'OKAY') && (complete || job.faults.length)) raw[0].jobFaults = job;
        if (!job && result.faults && (complete || result.faults.length)) raw[0].decoded = result.faults;
        if (!job && !result.faults && result.kwpDtcs && (complete || result.kwpDtcs.length)) raw[0].kwpDtcs = result.kwpDtcs;
    }
    const state = standing(result, t);
    return <>
        <p role="status" className={`px-3 py-2 font-mono text-xs ${state.tone}`}>{result.address} · {state.word}</p>
        <DiagnosisView catalog={profile?.id === moduleId ? profile : null}
            ident={ident?.response ? { hex: ident.response, length: compact(ident.response).length / 2 } : null}
            faults={dmeFaults} rawFaults={dmeFaults || !raw.length ? null : raw} />
    </>;
}

