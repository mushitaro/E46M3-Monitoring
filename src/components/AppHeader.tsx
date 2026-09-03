'use client';

import { LABEL, WORDMARK } from './ui';
import { MMark } from './MMark';
import { StatusLed } from './StatusLed';
import { APP_VERSION } from '@/lib/version';
import { useLang } from '@/lib/i18n';
import type { LinkState, LinkMode } from '@/hooks/useDs2Link';

/**
 * The app header: 48px, glass, and its bottom rule is the ///M tricolor stripe
 * rather than a slate hairline.
 *
 * The stripe is absolutely positioned INSIDE the 48px, replacing border-b. Put
 * below it instead, it pushes every pane down 2px and the golden-ratio split is
 * then measured on a shorter box. Hard colour stops, because a blended gradient
 * turns the three into mud at 2px tall. The middle stop is #9B84E8, not the
 * logo navy — at 1.33:1 on black that reads as a gap between the blue and the
 * red.
 *
 * Composition follows the recipe exactly:
 *
 *   [ status-dot · TITLE /// ROLE · version | identity-readouts ] ⟷ [ tools ]
 *
 * The status dot belongs HERE, not in a pane. It is the app's single statement
 * of what the machine is doing, and it has to be in the one place that is on
 * screen in every view — I had it inside the right column's bar, which is
 * exactly the sort of thing you stop looking at.
 */
export function AppHeader({
    ident,
    state,
    mode,
    hasError,
    onCredits,
}: {
    ident: { hex: string; length: number } | null;
    state: LinkState;
    mode: LinkMode;
    hasError: boolean;
    /** Opens the credits. The shell owns the dialog; the header owns the door. */
    onCredits: () => void;
}) {
    const { lang, t, setLang } = useLang();

    return (
        <header className="relative z-10 flex h-[48px] shrink-0 items-center bg-slate-950/80 px-6 backdrop-blur-md">
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5"
                style={{
                    background:
                        'linear-gradient(to right, #0A9BDB 0 33.333%, #9B84E8 33.333% 66.667%, #F11A22 66.667% 100%)',
                }}
            />

            <div className="flex min-w-0 flex-1 items-center gap-3">
                <StatusLed state={state} mode={mode} hasError={hasError} showLabel={false} />

                {/* WORDMARK, not LABEL. This shipped at 10px — the app's own
                    name set at tab-label size, while the reference app's header
                    reads at 14px. Measured side by side at the same viewport:
                    10px/1px tracking here against 14px/1.4px there. */}
                <h1 className={`shrink-0 whitespace-nowrap ${WORDMARK} text-slate-200`}>
                    E46M3
                    <MMark className="mx-1.5" />
                    {t.appRole}
                </h1>

                <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-slate-500">{APP_VERSION}</span>

                {/* Identity readouts, fenced off with a rule. Mono, because this
                    is data read off a machine — the split from the sans chrome is
                    a core identity cue, not a font preference. */}
                <div className="ml-8 flex min-w-0 flex-1 items-center gap-4 overflow-hidden whitespace-nowrap border-l border-slate-800 pl-8 font-mono text-[10px] text-slate-500">
                    <Readout label="IDENT" value={ident ? truncate(ident.hex, 26) : '—'} />
                    <Readout label="LEN" value={ident ? String(ident.length) : '—'} />
                </div>
            </div>

            {/* Credits, always reachable. The licence of the work this app
                rests on asks that attribution stay intact, and a PWA user never
                opens the README. It is NOT in the disclaimer — that is
                acknowledged once and then gone, which is the worst home for
                something that has to remain available. */}
            <div className="ml-auto flex items-center gap-1 border-l border-slate-800 pl-4">
                <button
                    type="button"
                    onClick={onCredits}
                    className={`px-1.5 py-0.5 ${LABEL} text-slate-600 transition-colors hover:text-slate-400`}
                >
                    {t.credits_open}
                </button>
                {(['ja', 'en'] as const).map((l) => (
                    <button
                        key={l}
                        type="button"
                        onClick={() => setLang(l)}
                        aria-pressed={lang === l}
                        className={`px-1.5 py-0.5 ${LABEL} transition-colors ${
                            lang === l ? 'text-blue-400' : 'text-slate-600 hover:text-slate-400'
                        }`}
                    >
                        {l}
                    </button>
                ))}
            </div>
        </header>
    );
}

function Readout({ label, value }: { label: string; value: string }) {
    return (
        <span className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 uppercase tracking-wider">{label}</span>
            <span className="truncate text-slate-300">{value}</span>
        </span>
    );
}

function truncate(s: string, n: number): string {
    return s.length <= n ? s : `${s.slice(0, n)}…`;
}
