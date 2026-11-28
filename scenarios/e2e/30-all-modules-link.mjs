import { connectPractice, tool } from './_lib.mjs';

/**
 * ALL MODULES and the one module the link opens on (owner, 2026-11-28, from the car): 「全モジュール
 * 表示してるのに MSS54 よりつなげるっていう、その振る舞いをすること自体が間違えてる」. The scan reaches every
 * address through the one link, so opening on MSS54 is right; what was wrong was that neither the
 * screen nor the assistant said so. Beside the ALL MODULES title the list now says LINK 0x12 MSS54, and the
 * module chosen on the select takes it away.
 */
const linkTarget = (page) =>
    page.evaluate(() => {
        const el = [...document.querySelectorAll('[data-testid="link-target"]')].find((e) => e.offsetParent !== null);
        return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
    });

const showsLink = (when) => ({
    check: {
        desc: `${when}：全モジュールの見出しの右に、回線が開くモジュール（LINK 0x12 MSS54）が出ている`,
        run: async (page) => {
            const t = await linkTarget(page);
            return t && /LINK/.test(t) && /0x12/.test(t) && /MSS54/.test(t) ? true : `読み取り：${t}`;
        },
    },
});

const scenario = {
    id: 'S30',
    title: 'ALL MODULES のとき、回線が開くモジュールを画面と AI が言う',
    story:
        'オーナーが DIAGNOSIS を ALL MODULES のまま開く。つなぐ前から、全モジュールの見出しの右に LINK 0x12 MSS54 と出ていて、つないでも残る。' +
        'AI に状態を聞くと、全モジュールが選ばれていて回線は MSS54 だと分けて答える。モジュールを一つ選ぶと LINK の表示は消える。',
    car: { dmeFaults: [] },
    steps: [
        showsLink('つなぐ前'),
        ...connectPractice,
        showsLink('つないだあと'),
        {
            ai: 'monitoring_status',
            means: '画面は全モジュール、回線は MSS54',
            expect: (s) => (s?.showing === 'all-modules' && s?.module?.all === true && s?.linkModule?.id === 'mss54' ? true : JSON.stringify({ showing: s?.showing, module: s?.module, linkModule: s?.linkModule })),
        },
        { shot: 's30-all-modules-link' },
        { ai: 'monitoring_module', args: { module: 'smg2' }, means: 'モジュールを一つ選ぶ（SMG II）', expect: (r) => (r?.error ? JSON.stringify(r) : true) },
        { wait: 1500 },
        {
            check: {
                desc: 'モジュールを一つ選ぶと、LINK の表示は消える（選択がそのモジュールを言う）',
                run: async (page) => {
                    const s = await tool(page, 'monitoring_status');
                    const t = await linkTarget(page);
                    return s.showing === 'module' && t === null ? true : `showing ${s.showing}、LINK ${t}`;
                },
            },
        },
    ],
};

export default scenario;
