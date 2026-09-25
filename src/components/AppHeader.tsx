'use client';

import { Medal, Shield, type LucideIcon } from 'lucide-react';
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
 *     first thing the DIAGNOSIS pane shows, with the whole hex; the version is
 *     at the foot of CREDITS, one tap away;
 *   - PRIVACY and CREDITS become glyphs (HeaderLink). They stay IN the header,
 *     unlike TUNER's and SMG2's, because this app has no menu sheet for them to
 *     move into — hidden here they would not be harder to reach, they would not
 *     exist, and the credits are what the licence of the work under this app
 *     asks to stay reachable.
 *
 * Measured at 360: the badge ends at 254.5 and the first glyph starts at 280.
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
}: {
    ident: { hex: string; length: number } | null;
    state: LinkState;
    mode: LinkMode;
    hasError: boolean;
    /** Opens the credits. The shell owns the dialog; the header owns the door. */
    onCredits: () => void;
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
                    <Readout label="IDENT" value={ident ? truncate(ident.hex, 26) : '—'} />
                    <Readout label="LEN" value={ident ? String(ident.length) : '—'} />
                </div>
            </div>

            {/* Credits, always reachable. The licence of the work this app
                rests on asks that attribution stay intact, and a PWA user never
                opens the README. It is NOT in the disclaimer — that is
                acknowledged once and then gone, which is the worst home for
                something that has to remain available.
                PRIVACY first, CREDITS after it: the order of every M tool. The
                rule is the desk's; a phone spends its width on the glyphs. The
                padding is both's — on a phone it is the least the badge and the
                first glyph can be apart, however narrow the screen. */}
            <div className="ml-auto flex items-center gap-4 pl-4 min-[900px]:gap-1 min-[900px]:border-l min-[900px]:border-slate-800">
                {preview && <HeaderLink Icon={Shield} word={t.privacy} href={PRIVACY_PREVIEW[lang]} />}
                <HeaderLink Icon={Medal} word={t.credits_open} onClick={onCredits} />
            </div>
        </header>
    );
}

/**
 * One of the header's links, in both of its forms: the word from 900px up, the
 * glyph below it.
 *
 * One element carrying both, not a phone row beside a desk row, so the two
 * layouts cannot come to disagree about which links there are or in what order
 * — a link added here is in both (tsunagi-m-chrome §1).
 *
 * The desk form is exactly what the header always drew. The phone form is the
 * family's: w-5, neutral slate, because it states no machine state. Its hit box
 * is padded out to 36x44 by margins that cancel the padding, so the row still
 * lays out at 20px, and two glyphs 16px apart have boxes that meet without
 * overlapping. The glyph's name is its <title>, which only the glyph carries —
 * the word needs no tooltip to say what it already says.
 */
function HeaderLink({
    Icon,
    word,
    href,
    onClick,
}: {
    Icon: LucideIcon;
    word: string;
    href?: string;
    onClick?: () => void;
}) {
    const className = `${LABEL} -mx-2 -my-3 px-2 py-3 text-slate-500 transition-colors hover:text-slate-300 min-[900px]:mx-0 min-[900px]:my-0 min-[900px]:px-1.5 min-[900px]:py-0.5 min-[900px]:text-slate-600 min-[900px]:hover:text-slate-400`;
    const body = (
        <>
            <Icon aria-hidden="true" className="size-5 min-[900px]:hidden">
                <title>{word}</title>
            </Icon>
            <span className="hidden min-[900px]:inline">{word}</span>
        </>
    );

    // `_blank` is not decoration: a same-tab navigation would drop the cable
    // link and whatever has not been saved (lib/links).
    return href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={word} className={className}>
            {body}
        </a>
    ) : (
        <button type="button" onClick={onClick} aria-label={word} className={className}>
            {body}
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
