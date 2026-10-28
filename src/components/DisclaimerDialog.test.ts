import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LABEL } from '@/components/ui';
import { STRINGS } from '@/lib/i18n';
import { PRIVACY_PREVIEW } from '@/lib/links';
import { DisclaimerDialog, PreviewNotice } from './DisclaimerDialog';

/**
 * The first-run dialog, rendered as the prerender renders it — no DOM, and `useLang` answers with
 * its server snapshot, ja.
 *
 * lucide's path data is not this dialog's: an icon-library bump may redraw a glyph without changing
 * a line here. So an <svg> is compared by its class list alone, which still names the icon.
 */
const render = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
    renderToStaticMarkup(el).replace(/<svg\b[^>]*?\bclass="([^"]*)"[^>]*>[\s\S]*?<\/svg>/g, '<svg class="$1"></svg>');

const dialog = (preview?: boolean) =>
    render(createElement(DisclaimerDialog, { onAgree: () => {}, ...(preview === undefined ? {} : { preview }) }));

/**
 * The production dialog, pinned. Re-captured from the component when it took the family's form —
 * TUNER's frame, dash list and filled answer (operator, 2026-10-28). A change to what production
 * shows has to change this literal — as a deliberate act, in a diff someone reads — rather than ride
 * in on a commit about the preview.
 */
const PRODUCTION = [
    '<div class="fixed inset-0 z-[100] bg-slate-950/70 min-[900px]:backdrop-blur-sm"></div>',
    '<div role="dialog" aria-modal="true" aria-label="免責事項" tabindex="-1" class="fixed left-1/2 top-1/2 z-[110] flex max-h-[min(84dvh,560px)] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl outline-none duration-200 animate-in fade-in zoom-in-95">',
    '<div class="mb-4 flex shrink-0 items-center gap-2 border-b border-slate-800 pb-2">',
    '<svg class="lucide lucide-triangle-alert size-3.5 shrink-0 text-red-400"></svg>',
    `<h3 class="min-w-0 flex-1 truncate ${LABEL} text-slate-300">免責事項</h3></div>`,
    '<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">',
    '<div class="space-y-3 text-xs leading-relaxed text-slate-300">',
    '<p>BMW E46 M3 を DS2 で読むための個人用ツールです。',
    '<strong class="font-bold text-slate-100">業務用の診断機ではありません。</strong>整備の判断は必ず整備マニュアル（TIS）と実車の状態に基づいて行ってください。</p>',
    '<ul class="space-y-2">',
    '<li class="flex gap-2"><span aria-hidden="true" class="shrink-0 text-slate-600">—</span>',
    '<span>実車に送るのは<strong class="font-bold text-slate-100">読取だけ</strong>です。唯一の例外は故障メモリの消去で、実行前に必ず確認を求めます。</span></li>',
    '<li class="flex gap-2"><span aria-hidden="true" class="shrink-0 text-slate-600">—</span>',
    '<span>表示している分類・訳・規定値は BMW の SGBD ファイルから機械的に取り出したものです。',
    '<strong class="font-bold text-slate-100">実車で確認が取れていない項目は「実車未確認」と表示されます。</strong>確認が取れていない操作は、理由を示して拒否します。</span></li>',
    '<li class="flex gap-2"><span aria-hidden="true" class="shrink-0 text-slate-600">—</span>',
    '<span>PRACTICE モードが話す相手はシミュレータで、車ではありません。作動テストを試せるのはこのモードだけです。</span></li>',
    '<li class="flex gap-2"><span aria-hidden="true" class="shrink-0 text-slate-600">—</span>',
    '<span>車の作業には危険が伴います。ジャッキアップ、エンジン運転、可動部——このツールは何も肩代わりしません。</span></li></ul>',
    '<p class="text-[11px] text-slate-500">「同意して続ける」を押した場合、上記に同意したものとみなします。</p></div></div>',
    '<div class="mt-3 flex shrink-0 items-center justify-end gap-2 border-t border-slate-800 pt-3">',
    `<button type="button" class="inline-flex items-center gap-1.5 whitespace-nowrap rounded px-4 py-3 ${LABEL} transition-colors disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-600 bg-blue-600 text-white hover:bg-blue-500">`,
    '<svg class="lucide lucide-check size-3 shrink-0"></svg>同意して続ける</button></div></div>',
].join('');

/** Every sentence of the notice, in the order the section says them. */
const noticeText = (n: (typeof STRINGS)['ja']['disclaimer_preview']) => [
    n.lead,
    n.sessionsTitle,
    n.sessions,
    n.sessionsWhen,
    n.recordsTitle,
    n.records,
    n.recordsWhen,
    n.readsTitle,
    n.reads,
    n.readsWhen,
    n.investigationsTitle,
    n.investigations,
    n.investigationsWhen,
    n.alsoSent,
    n.purposeTitle,
    n.purpose,
    n.whereTitle,
    n.where,
    n.deleteTitle,
    n.deleteBody,
    n.policy,
];

describe('the first-run dialog outside the preview', () => {
    it('renders exactly as it did before the preview had a notice', () => {
        expect(dialog()).toBe(PRODUCTION);
        expect(dialog(false)).toBe(PRODUCTION);
    });

    it('says nothing about sending and links nowhere', () => {
        const html = dialog(false);
        for (const s of noticeText(STRINGS.ja.disclaimer_preview)) expect(html).not.toContain(s);
        expect(html).not.toContain('<a ');
    });
});

describe('the first-run dialog in the preview', () => {
    it('is the same dialog with one section more, after the agree note', () => {
        const html = dialog(true);
        const sections = html.match(/<section\b[\s\S]*?<\/section>/g) ?? [];
        expect(sections).toHaveLength(1);
        const section = sections[0] ?? '';
        expect(html.replace(section, '')).toBe(PRODUCTION);
        // After the note, not before it: the note accepts "the above", and the above stays the points.
        const note = `${STRINGS.ja.disclaimer_agreeNote}</p>`;
        expect(html.indexOf(section)).toBe(html.indexOf(note) + note.length);
    });

    it("says m3's notice, every sentence of it, in order", () => {
        const html = dialog(true);
        let at = 0;
        for (const s of noticeText(STRINGS.ja.disclaimer_preview)) {
            const found = html.indexOf(s, at);
            expect(found, s).toBeGreaterThan(at);
            at = found;
        }
    });

    it('opens the policy in a new tab, in the reader’s language', () => {
        for (const lang of ['ja', 'en'] as const) {
            const html = render(
                createElement(PreviewNotice, { copy: STRINGS[lang].disclaimer_preview, policyHref: PRIVACY_PREVIEW[lang] }),
            );
            expect(html).toContain(`<a href="${PRIVACY_PREVIEW[lang]}" target="_blank" rel="noopener noreferrer"`);
            for (const s of noticeText(STRINGS[lang].disclaimer_preview)) expect(html, `${lang}: ${s}`).toContain(s);
        }
        expect(PRIVACY_PREVIEW.ja).toBe('https://m3.tsunagi.app/privacy-policy#preview');
        expect(PRIVACY_PREVIEW.en).toBe('https://m3.tsunagi.app/en/privacy-policy#preview');
    });

    it('keeps AGREE the only way out — no second button, no close', () => {
        const html = dialog(true);
        expect(html.match(/<button\b/g)).toHaveLength(1);
        expect(html).toContain(`${STRINGS.ja.disclaimer_agree}</button>`);
    });
});
