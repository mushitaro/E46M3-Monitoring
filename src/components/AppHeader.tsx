'use client';

import { RefreshCw } from 'lucide-react';
import { LABEL, Pill, WORDMARK } from './ui';
import { MMark } from './MMark';
import { StatusLed } from './StatusLed';
import { APP_VERSION } from '@/lib/version';
import { useBuildLabel, useBuildVariant } from '@/lib/build-variant';
import { useLang } from '@/lib/i18n';
import { PRIVACY_PREVIEW } from '@/lib/links';
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
 *   [ status-dot · TITLE /// ROLE · build-badge · version | identity-readouts ] ⟷ [ links ]
 *
 * The build badge says which build this URL serves — WORKS on the owner build,
 * nothing at all on production — and only says it: a tinted span, never a
 * control (tsunagi-m-chrome §2). Its word is `app-label`, not the variant, so
 * what the build is called can change without moving a feature gate.
 *
 * The status dot belongs HERE, not in a pane. It is the app's single statement
 * of what the machine is doing, and it has to be in the one place that is on
 * screen in every view — I had it inside the right column's bar, which is
 * exactly the sort of thing you stop looking at.
 *
 * ## Below 900px
 *
 * The header had no phone layout, and on one it drew itself on top of itself:
 * the links do not shrink, so at 360x780 they were painted across the wordmark
 * and the badge — elementFromPoint at WORKS returned CREDITS and JA, 0 of 7
 * points on the badge itself, and still 0 of 7 at 412px. The content box is
 * 312px there, and the row wanted 605 with IDENT and LEN already squeezed to
 * nothing.
 *
 * So below the breakpoint the row keeps what says which tool and which build
 * this is, and what cannot live anywhere else:
 *
 *   - the wordmark drops to 11px (WORDMARK in ui.tsx): 143.5px wide, not 189.9;
 *   - the version and the identity readouts step aside. IDENT and LEN are the
 *     first thing the DIAGNOSIS pane shows, with the whole hex, and the M menu's
 *     VEHICLE band; the version is at the foot of CREDITS and under the M menu's
 *     strip;
 *   - the links step aside too, into the M menu's strip — PRIVACY | CREDITS |
 *     RELOAD in this order, the family's (tsunagi-m-chrome §1). They were glyphs
 *     here while the app had no menu for them to move into; hidden then they
 *     would not have been harder to reach, they would not have existed, and the
 *     credits are what the licence of the work under this app asks to stay
 *     reachable. The sheet is that place now. Every one of them is still here
 *     from 900 up (tsunagi-m-mobile §8, the mirror).
 *
 * TUNER keeps one exception, RELOAD drawn on a phone while a newer build waits.
 * There is none here, because nothing here knows a newer build waits: the poll
 * that would (hooks/useAppUpdate) is a request of the app's own, and production
 * promises it makes none (THIRD-PARTY-NOTICES.md §1). RELOAD here reloads into
 * whatever the worker has already fetched, which is the browser's own reload
 * with the waiting worker let in.
 *
 * There is no language switch, at any width. The language is the browser's
 * (lib/i18n, tsunagi-m-ux §13); the ja | en pair that stood at the end of this
 * row was 59px a phone did not have, spent on overriding an answer the browser
 * already gives.
 */
export function AppHeader({
    ident,
    state,
    mode,
    hasError,
    onCredits,
    onReload,
    reloading,
}: {
    ident: { hex: string; length: number } | null;
    state: LinkState;
    mode: LinkMode;
    hasError: boolean;
    /** Opens the credits. The shell owns the dialog; the header owns the door. */
    onCredits: () => void;
    /** Reloads into the newest build. The shell confirms first when something would be lost. */
    onReload: () => void;
    reloading: boolean;
}) {
    const { lang, t } = useLang();
    // The preview sends what production never does, so it links to where that is written down —
    // in the reader's language. Production has nothing to disclose here and draws nothing.
    const preview = useBuildVariant() === 'preview';
    const buildLabel = useBuildLabel();

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
                    10px/1px tracking here against 14px/1.4px there.
                    `truncate`, not `shrink-0`: under ~350px the row runs out
                    even at 11px, and something has to give. The badge cannot —
                    it is the build's identity — and a covered name is worse
                    than a shortened one. At 320 it reads E46M3 /// MONI…, which
                    still says which tool has the cable. */}
                <h1 className={`min-w-0 truncate ${WORDMARK} text-slate-200`}>
                    E46M3
                    <MMark className="mx-1.5" />
                    {t.appRole}
                </h1>

                {buildLabel && <Pill tone="caution">{buildLabel}</Pill>}

                <span className="hidden shrink-0 whitespace-nowrap font-mono text-[10px] text-slate-500 min-[900px]:inline">
                    {APP_VERSION}
                </span>

                {/* Identity readouts, fenced off with a rule. Mono, because this
                    is data read off a machine — the split from the sans chrome is
                    a core identity cue, not a font preference. Desk only: the
                    rule and its margins alone are 65px of a phone's 312. */}
                <div className="ml-8 hidden min-w-0 flex-1 items-center gap-4 overflow-hidden whitespace-nowrap border-l border-slate-800 pl-8 font-mono text-[10px] text-slate-500 min-[900px]:flex">
                    <Readout label={t.field_ident} value={ident ? truncate(ident.hex, 26) : '—'} />
                    <Readout label={t.field_len} value={ident ? String(ident.length) : '—'} />
                </div>
            </div>

            {/* Credits, always reachable. The licence of the work this app
                rests on asks that attribution stay intact, and a PWA user never
                opens the README. It is NOT in the disclaimer — that is
                acknowledged once and then gone, which is the worst home for
                something that has to remain available.
                PRIVACY first, CREDITS after it, RELOAD last: the order of every
                M tool, and the M menu's strip below 900, which is where this
                group goes there. RELOAD hard against the corner because it is
                the one that drops the link. */}
            <div className="ml-auto hidden items-center gap-1 border-l border-slate-800 pl-4 min-[900px]:flex">
                {preview && <HeaderLink word={t.privacy} href={PRIVACY_PREVIEW[lang]} />}
                <HeaderLink word={t.credits_open} onClick={onCredits} />
                <HeaderLink
                    word={t.reload}
                    title={reloading ? t.reload_running : t.reload_title}
                    onClick={reloading ? undefined : onReload}
                    running={reloading}
                />
            </div>
        </header>
    );
}

/**
 * One of the header's links, as a word — from 900px up, the only width it is
 * drawn at. Below it the same destinations are the M menu's strip, in the same
 * order (tsunagi-m-chrome §1).
 *
 * `running` is RELOAD's while it fetches the newest build: the word keeps its
 * place and turns blue with a spinning glyph before it, since that can take
 * seconds and a press with no sign of life reads as a missed one.
 */
function HeaderLink({
    word,
    href,
    onClick,
    title,
    running = false,
}: {
    word: string;
    href?: string;
    onClick?: () => void;
    title?: string;
    running?: boolean;
}) {
    const className = `${LABEL} inline-flex items-center gap-1.5 px-1.5 py-0.5 transition-colors ${
        running ? 'cursor-default text-blue-400' : 'text-slate-600 hover:text-slate-400'
    }`;

    // `_blank` is not decoration: a same-tab navigation would drop the cable
    // link and whatever has not been saved (lib/links).
    return href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" title={title} className={className}>
            {word}
        </a>
    ) : (
        <button type="button" onClick={onClick} title={title} className={className}>
            {running && <RefreshCw aria-hidden="true" className="size-3 animate-spin" />}
            {word}
        </button>
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
