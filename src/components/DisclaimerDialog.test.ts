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
 * The production dialog, pinned as it rendered before the preview's notice existed (captured from
 * the component at caf1a9d). A change to what production shows has to change this literal — as a
 * deliberate act, in a diff someone reads — rather than ride in on a commit about the preview.
 */
const PRODUCTION = [
    '<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6" aria-hidden="false">',
    '<div role="dialog" aria-modal="true" aria-label="このツールについて" tabindex="-1" class="flex max-h-full w-full max-w-md flex-col bg-slate-900 outline-none">',
    '<div class="flex flex-none items-center gap-2 border-b border-slate-800 px-5 py-4">',
    '<svg class="lucide lucide-shield-alert size-3.5 shrink-0 text-blue-400"></svg>',
    `<span class="${LABEL} text-slate-300">このツールについて</span></div>`,
    '<div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">',
    '<p class="text-xs leading-relaxed text-slate-300">BMW E46 M3 を DS2 で読むための個人用ツールです。',
    '<strong class="font-bold text-amber-300">業務用の診断機ではありません。</strong>整備の判断は必ず整備マニュアル（TIS）と実車の状態に基づいて行ってください。</p>',
    '<ul class="mt-4 space-y-2.5">',
    '<li class="flex gap-2.5 text-[11px] leading-relaxed text-slate-400">',
    '<span aria-hidden="true" class="mt-1.5 size-1 shrink-0 rounded-full bg-slate-600"></span>',
    '<span>実車に送るのは',
    '<strong class="font-bold text-amber-300">読取だけ</strong>です。唯一の例外は故障メモリの消去で、実行前に必ず確認を求めます。</span></li>',
    '<li class="flex gap-2.5 text-[11px] leading-relaxed text-slate-400">',
    '<span aria-hidden="true" class="mt-1.5 size-1 shrink-0 rounded-full bg-slate-600"></span>',
    '<span>表示している分類・訳・規定値は BMW の SGBD ファイルから機械的に取り出したものです。',
    '<strong class="font-bold text-amber-300">実車で確認が取れていない項目は「実車未確認」と表示されます。</strong>確認が取れていない操作は、理由を示して拒否します。</span></li>',
    '<li class="flex gap-2.5 text-[11px] leading-relaxed text-slate-400">',
    '<span aria-hidden="true" class="mt-1.5 size-1 shrink-0 rounded-full bg-slate-600"></span>',
    '<span>PRACTICE モードが話す相手はシミュレータで、車ではありません。作動テストを試せるのはこのモードだけです。</span></li>',
    '<li class="flex gap-2.5 text-[11px] leading-relaxed text-slate-400">',
    '<span aria-hidden="true" class="mt-1.5 size-1 shrink-0 rounded-full bg-slate-600"></span>',
    '<span>車の作業には危険が伴います。ジャッキアップ、エンジン運転、可動部——このツールは何も肩代わりしません。</span></li></ul></div>',
    '<div class="flex h-[52px] flex-none items-center justify-end gap-4 border-t border-slate-800 px-5">',
    `<button type="button" class="inline-flex items-center gap-1.5 whitespace-nowrap ${LABEL} transition-colors disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:text-slate-600 text-blue-400 hover:text-blue-300 ">Agree</button></div></div></div>`,
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
    it('is the same dialog with one section more, after the points, on the ///M modal width', () => {
        const html = dialog(true);
        const sections = html.match(/<section\b[\s\S]*?<\/section>/g) ?? [];
        expect(sections).toHaveLength(1);
        const section = sections[0] ?? '';
        expect(PRODUCTION.split(' max-w-md ')).toHaveLength(2);
        expect(html.replace(section, '')).toBe(PRODUCTION.replace(' max-w-md ', ' max-w-[560px] '));
        expect(html.indexOf(section)).toBe(html.indexOf('</ul>') + '</ul>'.length);
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
        expect(html).toContain('>Agree</button>');
    });
});
