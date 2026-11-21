import { always, bodyText, tool, until } from './_owner.mjs';

/**
 * SC11（docs/VIRTUAL-CAR-TESTS.md M1）：ナビで一日。
 * 1 ナビの時計が 2006 年のまま開く → 開ける。記録の時刻は、時計が合うまで「時刻未確定」。
 * 2 時計が合う → それまでの記録の時刻が、正しい今日の時刻に直って並ぶ。
 * 3 電波の無い所で開き直す → 開ける。部品を動かす項目も、値の組も出る。
 * 4 新しい版が届く → ヘッダに UPDATE。記録中は押しても「記録を止めてから」。止めて押すと、同じ画面に戻る。
 * ナビの時計は Playwright の時計（page.clock）で 2006 年にし、サーバーの時刻を聞くのは e2e の口（clock.hear）。
 */
const NAV_BOOT = new Date('2006-05-01T08:00:00+09:00');

const connect = [
    { ui: 'practice' },
    { ui: 'click', text: 'CONNECT', settle: 2500, means: '人がナビの画面で PRACTICE につなぐ' },
];

const scenario = {
    id: 'SC11',
    title: 'ナビで一日：2006 年の時計で開く → 時計が合う → 電波の無い所 → 新しい版',
    story:
        'エンジンをかけると、ナビの時計は 2006 年のまま。MONITORING を開いて故障を読む。記録の時刻は、時計が合うまで「時刻未確定」と出る。' +
        '時計が合うと、それまでの記録の時刻が今日に直る。電波の無い所で開き直しても開け、部品を動かす項目も値の組も出る。' +
        '新しい版が届くとヘッダに UPDATE が出る。記録中に押すと「記録を止めてから」と出て、止めて押すと同じ画面に戻る。',
    viewport: { width: 683, height: 400 },
    car: { dmeFaults: [{ code: 0x43, type: 0x84, frequency: 2 }] },
    steps: always([
        // ---- 1. 2006 年の時計で開く --------------------------------------------------------------
        {
            check: {
                desc: 'ナビの時計が 2006 年のまま、MONITORING を開く（開ける）',
                run: async (page, st) => {
                    st.real = Date.now();
                    await page.clock.install({ time: NAV_BOOT });
                    await page.reload();
                    await page.waitForFunction(() => !!window.__monitoringE2E, null, { timeout: 15000 });
                    await page.waitForTimeout(800);
                    await page.evaluate(() => {
                        window.__monitoringE2E.clock.forget();
                        window.__monitoringE2E.car.set({ dmeFaults: [{ code: 0x43, type: 0x84, frequency: 2 }] });
                    });
                    const year = await page.evaluate(() => new Date().getFullYear());
                    return year === 2006 ? true : `ページの時計 ${year}`;
                },
            },
        },
        ...connect,
        { ai: 'monitoring_faults', args: { refresh: true }, means: '故障を読む（時刻はナビの時計のまま）', expect: (r) => (r?.refreshed ? true : JSON.stringify(r).slice(0, 200)) },
        { ai: 'monitoring_display', args: { show: 'memory' }, means: '記録（MEMORY）を出す', expect: (r) => (r?.shown === 'memory' ? true : JSON.stringify(r)) },
        { wait: 800 },
        {
            check: {
                desc: '記録の時刻が「時刻未確定」と出る（2006 年の日付をそのまま出さない）',
                run: async (page) => {
                    const text = await bodyText(page);
                    if (/2006/.test(text)) return '2006 年の日付が出ている';
                    return /時刻未確定|日付が確かでない/.test(text) ? true : '「時刻未確定」が出ていない';
                },
            },
        },
        { shot: 's01-2006' },

        // ---- 2. 時計が合う ------------------------------------------------------------------------
        {
            check: {
                desc: '時計が合う（ナビの時計が今日になり、ページがサーバーの時刻を聞く）',
                run: async (page, st) => {
                    await page.clock.setSystemTime(new Date(st.real));
                    const step = await page.evaluate((iso) => window.__monitoringE2E.clock.hear(iso), new Date(st.real).toISOString());
                    return step > 10 * 365 * 86_400_000 ? true : `step ${step}`;
                },
            },
        },
        { wait: 1500 },
        { ai: 'monitoring_save', args: { confirmed: true }, means: '保存する', expect: (r) => (r?.saved && r.faultCount === 1 ? true : JSON.stringify(r)) },
        {
            check: {
                desc: 'それまでの記録の時刻が、正しい今日の時刻に直って並ぶ（AI の答えと画面の両方）',
                run: async (page, st) => {
                    const r = await tool(page, 'monitoring_sessions');
                    const s = (r?.saved ?? [])[0];
                    const today = new Date(st.real).toISOString().slice(0, 10);
                    if (!s || !String(s.createdAt).startsWith(today)) return `記録の日付 ${s?.createdAt}`;
                    await tool(page, 'monitoring_display', { show: 'memory' });
                    await page.waitForTimeout(600);
                    const text = await bodyText(page);
                    if (/2006/.test(text)) return '画面に 2006 年が残る';
                    return text.includes(today) ? true : `画面に今日（${today}）の日付が無い`;
                },
            },
        },
        { shot: 's02-clock-set' },

        // ---- 3. 電波の無い所で開き直す ------------------------------------------------------------
        {
            check: {
                desc: '電波の無い所で開き直す：開ける',
                run: async (page) => {
                    await page.clock.resume().catch(() => {});
                    const ready = await page.evaluate(async () => {
                        if (!('serviceWorker' in navigator)) return 'no serviceWorker';
                        const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 15000))]);
                        return reg ? 'ready' : 'not ready';
                    });
                    await page.waitForTimeout(3000);
                    await page.context().setOffline(true);
                    try {
                        await page.reload({ timeout: 15000 });
                        await page.waitForFunction(() => !!window.__monitoringE2E, null, { timeout: 15000 });
                    } catch (e) {
                        return `開けない（service worker: ${ready}）: ${String(e.message).split('\n')[0]}`;
                    }
                    return true;
                },
            },
        },
        ...connect,
        { ai: 'monitoring_module', args: { module: 'smg2' }, means: 'SMG II を画面に（ナビの幅ではモジュールの選択は MENU の奥なので、声で）', expect: (r) => (r?.switched ? true : JSON.stringify(r)) },
        { wait: 2500 },
        { ai: 'monitoring_display', args: { show: 'actuator', pane: 'list' }, means: 'ACTUATOR を出す', expect: () => true },
        { wait: 800 },
        {
            check: {
                desc: '電波が無くても、部品を動かす項目と値の組が出る（SMG II の STEUERN_STELLGLIED と油圧ポンプ（HYDROPUMPE）の組）',
                run: async (page) => {
                    const text = await bodyText(page);
                    if (!text.includes('STEUERN_STELLGLIED')) return '部品を動かす項目が出ない';
                    const ok = await until(page, async () => (await page.locator('select option').allTextContents()).some((o) => /油圧ポンプ/.test(o)), 6000, 300);
                    return ok ? true : '値の組が出ない';
                },
            },
        },
        { shot: 's03-offline' },

        // ---- 4. 新しい版が届く --------------------------------------------------------------------
        {
            check: {
                desc: '新しい版が届く：ヘッダに UPDATE が出る',
                run: async (page) => {
                    await page.context().setOffline(false);
                    // A new build on the server: the page's check fetches `/` and finds a chunk it is not running.
                    const origin = new URL(page.url()).origin;
                    // The context's route: once the service worker controls the page, the page's own route no longer sees its fetches.
                    await page.context().route(`${origin}/`, async (route) => {
                        if (route.request().isNavigationRequest() || route.request().resourceType() === 'document') return route.continue();
                        const res = await route.fetch();
                        const html = (await res.text()).replace('</head>', '<script src="/_next/static/chunks/next-build-sc11.js"></script></head>');
                        await route.fulfill({ response: res, body: html });
                    });
                    await page.reload();
                    await page.waitForFunction(() => !!window.__monitoringE2E, null, { timeout: 15000 });
                    const seen = await until(page, async () => /UPDATE/.test(await bodyText(page)) || (await tool(page, 'monitoring_status'))?.newBuildWaiting, 20000, 500);
                    return seen ? true : 'UPDATE が出ない（新しい版を待っていると言わない）';
                },
            },
        },
        ...connect,
        { ai: 'monitoring_log_channels', args: { channels: ['3:n'] }, means: '記録の支度', expect: () => true },
        { ai: 'monitoring_start_log', means: '記録を始める', expect: (r) => (r?.started ? true : JSON.stringify(r).slice(0, 200)) },
        {
            check: {
                desc: '記録中に UPDATE を押すと「記録を止めてから」と出る（記録は止まらない）',
                run: async (page) => {
                    const b = page.locator('button:visible:has-text("UPDATE")');
                    if ((await b.count()) === 0) return 'UPDATE のボタンが無い';
                    let asked = null;
                    const onDialog = (d) => {
                        asked = d.message();
                        void d.dismiss();
                    };
                    page.once('dialog', onDialog);
                    await b.first().click();
                    await page.waitForTimeout(800);
                    // No dialog came (the app says it in its own notice): the listener must not linger and
                    // dismiss the next step's confirmation.
                    page.off('dialog', onDialog);
                    const text = `${await bodyText(page)}\n${asked ?? ''}`;
                    const s = await tool(page, 'monitoring_status');
                    if (!s?.recording) return '記録が止まった';
                    if (asked && !/記録を止めてから/.test(asked)) return `ブラウザの確認が出る：「${asked}」（記録を止めてから、とは言わない）`;
                    return /記録を止めてから/.test(text) ? true : `「記録を止めてから」が出ない（画面の頭：${text.split('\n').slice(0, 8).join(' ')}）`;
                },
            },
        },
        { shot: 's04-update-recording' },
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '記録を止める', expect: (r) => (r?.stopped ? true : JSON.stringify(r)) },
        {
            check: {
                desc: '止めて UPDATE を押すと、新しい版で同じ画面（DATALOG）に戻る',
                run: async (page) => {
                    const b = page.locator('button:visible:has-text("UPDATE")');
                    if ((await b.count()) === 0) return 'UPDATE のボタンが無い';
                    await page.evaluate(() => (window.__sc11Before = true));
                    let asked = null;
                    page.once('dialog', (d) => {
                        asked = d.message();
                        void d.accept().catch(() => {});
                    });
                    await b.first().click();
                    await page.waitForTimeout(5000);
                    await page.waitForFunction(() => !!window.__monitoringE2E, null, { timeout: 20000 });
                    const reloaded = await page.evaluate(() => !window.__sc11Before);
                    const s = await tool(page, 'monitoring_status');
                    if (!reloaded) return '新しい版に開き直さない';
                    return s?.screen === 'datalog' ? true : `戻った画面 ${s?.screen}${asked ? `（途中の確認：「${asked}」）` : ''}`;
                },
            },
        },
        { shot: 's04-updated' },
    ]),
};

export default scenario;
