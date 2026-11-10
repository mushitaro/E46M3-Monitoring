/**
 * The head unit's header, opened by the launcher (2026-11-10): with `doors=settings` on the URL the
 * page's first render on the device used to disagree with the page built on the server, and the
 * hydration that failed took the WORKS badge and the AI switch with it — the owner lost the assistant.
 * Opened the way the launcher opens it, the header keeps all of them, and adds the two doors.
 */
const open = (q) => ({
    check: {
        desc: `ランチャーから開いたヘッダ（${q}）：WORKS の札と AI のボタンがある`,
        run: async (page, st) => {
            st.base = st.base ?? page.url().split('?')[0];
            await page.goto(st.base + q);
            await page.waitForTimeout(2500);
            const h = await page.evaluate(() => {
                const header = document.querySelector('header');
                return {
                    works: !!header && header.innerText.includes('WORKS'),
                    ai: !!header?.querySelector('button[aria-label="ASSISTANT"], button[aria-label*="ASSISTANT"]'),
                    doors: header ? header.querySelectorAll('a[href^="intent:"]').length : -1,
                };
            });
            const want = q.includes('doors=settings') ? 2 : 0;
            return h.works && h.ai && h.doors === want ? true : JSON.stringify(h);
        },
    },
});

const scenario = {
    id: 'S15',
    title: 'ランチャーから開いたヘッダ：WORKS・AI が消えない、設定への入口は新しいランチャーのときだけ',
    story: 'ナビのランチャーが開く形（?from=manifold、新しい版は &doors=settings）で開く。どちらでも WORKS の札と AI のボタンがあり、Wi-Fi と時計の入口は doors=settings のときだけ出る。',
    viewport: { width: 683, height: 400 },
    steps: [open('?from=manifold&doors=settings'), open('?from=manifold')],
};

export default scenario;
