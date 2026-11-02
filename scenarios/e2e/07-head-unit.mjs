/** The head unit's 683×400: HUB beside MAIN, the footer turning MAIN and MULTI, SESSION SYNC from the menu. */
const scenario = {
    id: 'S07',
    title: 'ナビ幅（683×400）：HUB は常に右、フッタは LIST と VISU',
    story: 'ナビの画面で使う。HUB（状態行・ハブ）は常に右に出ていて、フッタで LIST と VISU を切り替える。M メニューの SYNC から SESSION SYNC が開く。',
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
    ],
};

export default scenario;
