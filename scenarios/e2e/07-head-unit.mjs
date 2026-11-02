/** The head unit's 683×400: HUB beside MAIN, the footer turning MAIN and MULTI, SESSION SYNC from the menu. */
const scenario = {
    id: 'S07',
    title: 'ナビ幅（683×400）：HUB は常に右、フッタは LIST と VISU、MODE は HUB の左下',
    story:
        'ナビの画面で使う。HUB（状態行・ハブ）は常に右に出ていて、フッタで LIST と VISU を切り替える。M メニューの SYNC から SESSION SYNC が開く。' +
        'HUB の左下に MODE があり、AI が PROBE のセッションを開くと、M メニューのビューは STARTUP と PROBE になる。',
    viewport: { width: 683, height: 400 },
    steps: [
        {
            check: {
                desc: 'HUB が MAIN の右に、画面からはみ出さずに出ている',
                run: async (page) => {
                    const r = await page.evaluate(() => {
                        const b = (id) => document.getElementById(id)?.getBoundingClientRect();
                        const list = b('narrow-list');
                        const hub = [...document.querySelectorAll('button')].find((x) => /CONNECT/.test(x.innerText))?.getBoundingClientRect();
                        return { list: list && { x: list.x, w: list.width }, hub: hub && { x: hub.x, right: hub.right }, overflow: document.documentElement.scrollWidth - innerWidth };
                    });
                    if (!r.list || !r.hub) return JSON.stringify(r);
                    return r.hub.x >= r.list.x + r.list.w - 1 && r.hub.right <= 683 && r.overflow === 0 ? true : JSON.stringify(r);
                },
            },
        },
        { ui: 'click', text: 'VISU', settle: 500, means: 'MULTI（VISU）が LIST と入れ替わる' },
        { screen: { desc: 'HUB はそのまま', has: ['CONNECT', 'LIST', 'VISU'] } },
        { shot: 'visu' },
        {
            check: {
                desc: 'M メニューの SYNC から SESSION SYNC が開く',
                run: async (page) => {
                    await page.getByRole('button', { name: /menu|メニュー/i }).first().dispatchEvent('pointerdown');
                    await page.waitForTimeout(500);
                    await page.locator('button:visible:has-text("SYNC")').first().click();
                    await page.waitForTimeout(600);
                    const text = await page.evaluate(() => document.body.innerText);
                    return text.includes('SESSION SYNC') ? true : 'SESSION SYNC が開かない';
                },
            },
        },
        { shot: 'sync' },
        { reload: true },
        {
            check: {
                desc: 'MODE が HUB の左下に、はみ出さずに出ている',
                run: async (page) => {
                    const r = await page.evaluate(() => {
                        const m = document.querySelector('[data-mode=manual]')?.getBoundingClientRect();
                        const hub = [...document.querySelectorAll('button')].find((x) => /CONNECT/.test(x.innerText))?.getBoundingClientRect();
                        return { m: m && { x: m.x, bottom: m.bottom }, hub: hub && { x: hub.x, bottom: hub.bottom }, h: innerHeight - 52 };
                    });
                    if (!r.m || !r.hub) return JSON.stringify(r);
                    return r.m.x < r.hub.x && r.m.bottom > r.hub.bottom && r.m.bottom <= r.h ? true : JSON.stringify(r);
                },
            },
        },
        { ai: 'monitoring_session', args: { action: 'new', confirmed: true }, means: 'AI が PROBE のセッションを開く', expect: (r) => (r && r.fresh ? true : JSON.stringify(r)) },
        { screen: { desc: 'ナビ幅でも STARTUP に新しいセッション', has: ['新しいセッション'] } },
        {
            check: {
                desc: 'M メニューのビューは STARTUP と PROBE だけ',
                run: async (page) => {
                    await page.getByRole('button', { name: /menu|メニュー/i }).first().dispatchEvent('pointerdown');
                    await page.waitForTimeout(500);
                    const text = await page.evaluate(() => document.body.innerText);
                    await page.keyboard.press('Escape');
                    return text.includes('STARTUP') && !text.includes('DIAGNOSIS') ? true : 'M メニューに MANUAL のビューが出ている';
                },
            },
        },
        { shot: 'probe-narrow' },
    ],
};

export default scenario;
