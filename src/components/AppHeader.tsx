'use client';

import { MMark } from './MMark';
import { useLang } from '@/lib/i18n';

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
 * Composition follows the recipe: one left cluster carrying the wordmark and
 * the identity readouts, separated by a rule; one right cluster of tools.
 */
export function AppHeader({ ident }: { ident: { hex: string; length: number } | null }) {
    const { lang, t, setLang } = useLang();

    return (
        <header className="relative flex h-[48px] shrink-0 items-center bg-slate-950/80 px-4 backdrop-blur-md">
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5"
                style={{
                    background:
                        'linear-gradient(to right, #0A9BDB 0 33.333%, #9B84E8 33.333% 66.667%, #F11A22 66.667% 100%)',
                }}
            />

            <h1 className="flex items-center text-sm font-bold uppercase tracking-widest text-slate-200">
                E46M3
                <MMark className="mx-1.5" />
                {t.appRole}
            </h1>

            {/* Identity readouts, fenced off with a rule. Mono, because this is
                data read off a machine — the split from the sans chrome is a
                core identity cue, not a font preference. */}
            <div className="ml-8 flex min-w-0 items-center gap-4 border-l border-slate-800 pl-8">
                <Readout label="IDENT" value={ident ? truncate(ident.hex, 26) : '—'} />
                <Readout label="LEN" value={ident ? String(ident.length) : '—'} />
            </div>

            <div className="ml-auto flex items-center gap-1 border-l border-slate-800 pl-4">
                {(['ja', 'en'] as const).map((l) => (
                    <button
                        key={l}
                        type="button"
                        onClick={() => setLang(l)}
                        aria-pressed={lang === l}
                        className={`px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-widest transition-colors ${
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
        <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 text-[9px] uppercase tracking-widest text-slate-600">{label}</span>
            <span className="truncate font-mono text-[11px] text-slate-300">{value}</span>
        </span>
    );
}

function truncate(s: string, n: number): string {
    return s.length <= n ? s : `${s.slice(0, n)}…`;
}
