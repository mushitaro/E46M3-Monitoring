import { always, bodyText, tool } from './_owner.mjs';

/**
 * SC12（docs/VIRTUAL-CAR-TESTS.md M1）：残す・渡す・頼む。
 * 1「前の記録を開いて」→ AI が候補を日付で言い、選ぶと画面に開く。
 * 2「TUNER を開いて」→ TUNER は同じタブで開く（ケーブルは一本で、TUNER もそれを使う）。記録中は AI が「記録を止めてから」と答え、
 *   記録は止まらない（黙って止めない）。止めて保存したあと TUNER が開く。
 * 3「開発に、この表示が分かりにくいって送って」→ AI「送りました」。あとで「返事来た？」に開発の返事を読む。
 *   開発への頼みごと（monitoring_dev_request・dev_status）は中継が持ち、タブには無いので、ここでは確かめない（FINDINGS に記す）。
 */
const scenario = {
    id: 'SC12',
    title: '残す・渡す・頼む：前の記録を開く → TUNER を開く（記録は止まらない） → 開発に送る',
    story:
        '前に保存した記録が 2 件ある。オーナーが声で「前の記録を開いて」と頼むと、AI が日付で候補を言い、選んだものが画面に開く。' +
        '次に「TUNER を開いて」。TUNER が開き、MONITORING の記録は止まらない。最後に「開発に、この表示が分かりにくいって送って」。',
    car: { dmeFaults: [{ code: 0x43, type: 0x84, frequency: 2 }] },
    steps: always([
        { ui: 'practice' },
        { ui: 'click', text: 'CONNECT', settle: 2500, means: '人が画面で PRACTICE につなぐ' },
        { ai: 'monitoring_faults', args: { refresh: true }, means: '故障を読む', expect: (r) => (r?.refreshed ? true : JSON.stringify(r).slice(0, 200)) },
        { ai: 'monitoring_save', args: { confirmed: true }, means: '保存する（1 件目）', expect: (r) => (r?.saved ? true : JSON.stringify(r)) },
        { ui: 'click', text: 'DISCONNECT', settle: 1200, means: '一度切って（キーオフ）' },
        { ui: 'click', text: 'CONNECT', settle: 2500, means: 'もう一度つなぐ（次の記録）' },
        { ai: 'monitoring_log_channels', args: { channels: ['3:n', '3:toel'] }, means: '記録の支度', expect: (r) => (r?.changed ? true : JSON.stringify(r)) },
        { ai: 'monitoring_start_log', means: '記録する', expect: (r) => (r?.started ? true : JSON.stringify(r).slice(0, 200)) },
        { wait: 2500 },
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '止める', expect: (r) => (r?.stopped ? true : JSON.stringify(r)) },
        { ai: 'monitoring_save', args: { confirmed: true }, means: '保存する（2 件目）', expect: (r) => (r?.saved ? true : JSON.stringify(r)) },

        // ---- 1. 前の記録を開いて ----------------------------------------------------------------
        { say: '前の記録を開いて' },
        {
            ai: 'monitoring_sessions',
            means: 'AI が候補を日付で言える：各記録に日付と中身。VIN は無い',
            expect: (r, e) => {
                const s = r?.saved ?? [];
                if (JSON.stringify(r).includes('JR12345')) return 'VIN がある';
                return s.length >= 2 && s.every((x) => x.createdAt && x.label) ? true : JSON.stringify(r ?? e).slice(0, 200);
            },
            keep: (r, st) => (st.saved = r?.saved ?? []),
        },
        {
            check: {
                desc: '選ぶと画面に開く：AI の道具で、保存した記録を画面に開ける',
                run: async (page, st) => {
                    const pick = st.saved?.[1];
                    if (!pick) return '候補が無い';
                    const r = await tool(page, 'monitoring_session', { action: 'open', record: pick.id });
                    await page.waitForTimeout(800);
                    const text = await bodyText(page);
                    if (r?.error || !text.includes(pick.label)) return `保存した記録を画面に開く道具が無い（monitoring_session open は PROBE の記録だけ）: ${JSON.stringify(r).slice(0, 160)}`;
                    return true;
                },
            },
        },
        {
            check: {
                desc: '（画面の人なら）MEMORY で記録を選ぶと中身が開く',
                run: async (page, st) => {
                    await tool(page, 'monitoring_display', { show: 'memory' });
                    await page.waitForTimeout(600);
                    // The record the assistant opened above is on the screen: back to the list first, as a person would.
                    const back = page.locator('button:visible:has-text("Back")');
                    if (await back.count()) {
                        await back.first().click();
                        await page.waitForTimeout(400);
                    }
                    const pick = st.saved?.[1];
                    const row = page.locator(`text=${pick?.label}`).first();
                    if ((await row.count()) === 0) return 'MEMORY に記録が無い';
                    // Its own row's VIEW (the rows carry the label, and each its VIEW).
                    const view = page.locator(`xpath=//*[.//button[contains(normalize-space(.), "View")]][contains(normalize-space(.), "${pick.label}")]`).last().locator('button:visible').filter({ hasText: /見る|view|開く/i }).last();
                    if ((await view.count()) === 0) return '開くボタンが無い';
                    await view.click();
                    await page.waitForTimeout(800);
                    const text = await bodyText(page);
                    return /0x43|サンプル/.test(text) ? true : '開いた記録の中身が無い';
                },
            },
        },
        { shot: 's01-open' },

        // ---- 2. TUNER を開いて（記録中） ----------------------------------------------------------
        { ai: 'monitoring_start_log', means: '記録している', expect: (r) => (r?.started ? true : JSON.stringify(r).slice(0, 200)) },
        { say: 'TUNER を開いて' },
        {
            ai: 'monitoring_open_tuner',
            args: { confirmed: true },
            means: 'TUNER は同じタブで開くので、記録中は開かず「記録を止めてから」と答える（記録を黙って止めない）',
            expect: (r) => (r?.opened === false && /Stop it first|recording/i.test(r?.reason ?? '') ? true : `記録中に答えが違う: ${JSON.stringify(r).slice(0, 200)}`),
        },
        {
            check: {
                desc: 'MONITORING の記録は止まっていない',
                run: async (page) => {
                    const s = await tool(page, 'monitoring_status');
                    return s?.recording ? true : `記録が止まった（${s?.link}）`;
                },
            },
        },
        { shot: 's02-tuner' },

        // ---- 3. 開発に送る ------------------------------------------------------------------------
        { say: '開発に、この表示が分かりにくいって送って', means: '開発への頼みごとは中継（monitoring_dev_request）が持つ。タブの道具には無いので、声の予行で確かめる' },
        {
            check: {
                desc: 'タブの道具に開発への頼みごとが無いこと（中継が持つ）を確かめる',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_dev_request', { text: 'この表示が分かりにくい' });
                    return /No tool named/.test(r?.error ?? '') ? true : `タブが答えた: ${JSON.stringify(r).slice(0, 160)}`;
                },
            },
        },

        // ---- 終わり：止めてから TUNER へ（このあとページは TUNER へ移る） --------------------------
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '止める', expect: (r) => (r?.stopped ? true : JSON.stringify(r)) },
        { ai: 'monitoring_save', args: { confirmed: true }, means: '保存する', expect: (r) => (r?.saved ? true : JSON.stringify(r)) },
        { wait: 1500 },
        {
            check: {
                desc: '（テストの支度）TUNER WORKS のページは外へ取りに行かず、代わりの小さなページを返す',
                run: async (page) => {
                    await page.route(/^https:\/\/(?!localhost)/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>TUNER</title><p>TUNER WORKS</p>' }));
                    return true;
                },
            },
        },
        {
            ai: 'monitoring_open_tuner',
            args: { confirmed: true },
            means: '止めたあとなら TUNER が開く（このタブが TUNER WORKS へ移る）',
            expect: (r) => (r?.opened === true && /tuner/i.test(r.url ?? '') ? true : JSON.stringify(r)),
        },
        {
            check: {
                desc: 'このタブが TUNER WORKS に移る',
                run: async (page) => {
                    for (let i = 0; i < 20 && !/tuner/i.test(page.url()); i++) await page.waitForTimeout(250);
                    return /tuner/i.test(page.url()) ? true : `移らない: ${page.url()}`;
                },
            },
        },
    ]),
};

export default scenario;
