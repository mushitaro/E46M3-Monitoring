'use client';

import { useCallback, useState } from 'react';
import type { EcuIndex, EcuProfile } from '@/lib/ecuCatalog';
import { text as resolveText } from '@/lib/ecuCatalog';
import { isAnchored } from '@/lib/clock';
import { download } from '@/lib/download';
import { normCode } from '@/lib/faultCode';
import { buildIntakeCheck, intakeFileName, sha256Hex } from '@/lib/intake/build';
import { handOff, newNonce, type HandoffWindow, type MessageLike } from '@/lib/intake/handoff';
import { useLang } from '@/lib/i18n';
import type { ScanRun } from '@/lib/probe/scan';
import type { RunBlockKey } from '@/lib/runGate';

export type IntakePhase = 'idle' | 'sending' | 'received' | 'refused' | 'saved';

/** What the shell and the assistant's status read: the phase for the scan on the screen, and where it went. */
export interface IntakeStatus {
    phase: IntakePhase;
    /** The store, once one answered. */
    store: string | null;
    at: number | null;
}

/** `window`, as the handshake reads it: the opener, and messages as origin, source and data. */
function browserWindow(): HandoffWindow {
    const wrapped = new Map<(e: MessageLike) => void, (e: MessageEvent) => void>();
    return {
        opener: window.opener as HandoffWindow['opener'],
        addEventListener: (_type, l) => {
            const w = (e: MessageEvent) => l({ origin: e.origin, source: e.source, data: e.data });
            wrapped.set(l, w);
            window.addEventListener('message', w);
        },
        removeEventListener: (_type, l) => {
            const w = wrapped.get(l);
            if (w) window.removeEventListener('message', w);
            wrapped.delete(l);
        },
    };
}

/** The build this page came from, as build-id.mjs stamped it (lib/sync/errorRecords reads it the same way). */
function buildId(): string {
    return document.querySelector('meta[name="build-id"]')?.getAttribute('content') || 'dev';
}

/**
 * SEND, under a finished scan of every module (operator, 2026-11-10, D5 and D6): one press writes
 * the intake report (lib/intake/build) and hands it to the store's MAINTENANCE tab that opened this
 * one (lib/intake/handoff). MONITORING stays in front and says what happened once, on the notice
 * line; the label is the state for that scan (SEND → SENDING → SENT, or SAVED when it went to a file).
 *
 * The report never passes through the assistant: this is a person's press, and the assistant's
 * status hears only the phase (`status`), not the report.
 */
export function useIntakeSend(input: {
    scan: ScanRun | null;
    practice: boolean;
    index: EcuIndex | null;
    mss54: EcuProfile | null;
    /** Other answers the page holds from the same work (the screen's IDENT and fault read): VIN sources too. */
    alsoRead: () => string[];
    /** Says it once on the notice line. */
    say: (text: string, tone: 'info' | 'warn' | 'error') => void;
}) {
    const { lang, t } = useLang();
    const [state, setState] = useState<{ scan: ScanRun | null; phase: IntakePhase; store: string | null; at: number | null }>({
        scan: null,
        phase: 'idle',
        store: null,
        at: null,
    });
    // The phase belongs to the scan it was for: a new scan starts at SEND again.
    const status: IntakeStatus = state.scan === input.scan && input.scan !== null ? { phase: state.phase, store: state.store, at: state.at } : { phase: 'idle', store: null, at: null };

    const { scan, practice, index, mss54, alsoRead, say } = input;
    const send = useCallback(async () => {
        if (!scan || (state.scan === scan && state.phase === 'sending')) return;
        setState({ scan, phase: 'sending', store: null, at: null });
        let built: ReturnType<typeof buildIntakeCheck>;
        try {
            const byCode = new Map((mss54?.faultText ?? []).map((f) => [normCode(f.code), f]));
            built = buildIntakeCheck({
                id: crypto.randomUUID(),
                scan,
                practice,
                build: buildId(),
                sgbdSet: index ? `ecu-data@${index.generatedAt}` : 'ecu-data@unknown',
                clockSet: isAnchored(),
                modules: (index?.modules ?? []).map((m) => ({ id: m.id, sgbd: m.sgbd, name: lang === 'ja' ? m.name : m.name_en })),
                faultText: (moduleId, code) => {
                    const known = moduleId === 'mss54' ? byCode.get(normCode(code)) : undefined;
                    const s = known && mss54 ? resolveText(mss54, known.text, lang).text : '';
                    return s ? String(s) : null;
                },
                reasonText: (r) => t.runBlock[r as RunBlockKey] ?? r,
                alsoRead: alsoRead(),
            });
        } catch {
            setState({ scan, phase: 'idle', store: null, at: null });
            say(t.intake_failed, 'error');
            return;
        }
        const sha = await sha256Hex(built.json);
        // Where the VIN came from, after the outcome: the store matches the car by it.
        const vinNote = t.intake_vin[built.vinSource ?? 'none'];
        const withVin = (s: string) => (vinNote ? `${s} ${vinNote}` : s);
        const out = await handOff(browserWindow(), built.json, sha, { nonce: newNonce() });
        const at = Date.now();
        if (out.kind === 'received') {
            setState({ scan, phase: 'received', store: out.mainstay.name, at });
            say(withVin(t.intake_received(out.mainstay.name, built.report.findings.length)), 'info');
        } else if (out.kind === 'refused') {
            setState({ scan, phase: 'refused', store: out.mainstay.name, at });
            say(withVin(t.intake_refused(out.mainstay.name, t.intake_refusal[out.reason])), 'warn');
        } else {
            // No tab took it: the same text as a file, which the store can drop in instead.
            download(built.json, 'application/json', intakeFileName(built.report));
            setState({ scan, phase: 'saved', store: out.kind === 'no-answer' ? out.mainstay.name : null, at });
            say(withVin(out.kind === 'no-answer' ? t.intake_noAnswer(out.mainstay.name) : t.intake_savedFile), out.kind === 'no-answer' ? 'warn' : 'info');
        }
    }, [scan, practice, index, mss54, alsoRead, say, state.scan, state.phase, lang, t]);

    const label = { idle: t.intake_send, sending: t.intake_sending, received: t.intake_sent, refused: t.intake_send, saved: t.intake_saved }[status.phase];
    return { status, send, label };
}
