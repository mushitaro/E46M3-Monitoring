import { connectPractice } from './_lib.mjs';

/**
 * The head unit's clock (2026-11-04): it boots in 2006 and is set later, in the middle of a drive.
 * What MONITORING records before the page hears the server's time is put right when it does; what
 * a page recorded and never put right is kept, not deleted as decades old.
 */
const YEARS_20 = 20 * 365 * 86_400_000;
const forget = {
    check: {
        desc: 'ページはまだサーバーの時刻を聞いていない（ナビの時計のまま）',
        run: async (page) => {
            await page.evaluate(() => window.__monitoringE2E.clock.forget());
            return true;
        },
    },
};

const scenario = {
    id: 'S11',
    title: 'ナビの時計：飛ぶ前に読んだ故障も保存に入る。直せなかった記録は、見つけた時から 7 日',
    story:
        'ページを開いた時点ではサーバーの時刻を聞けていない（ナビの時計は 2006 年）。その間に故障を読み、あとでサーバーの時刻を聞くと 20 年進む。' +
        '保存すると、直前に読んだ故障が入っている。次に、時刻を聞く前に故障を読んでページを閉じると、その記録は日付が確かでないものとして残り、時刻の合ったページが見つけた時から 7 日を数える。',
    car: { dmeFaults: [{ code: 0x43, type: 0x84, frequency: 2 }] },
    steps: [
        forget,
        ...connectPractice,
        { ai: 'monitoring_faults', args: { refresh: true }, means: '故障を読む（時刻はナビの時計）', expect: (r) => (r && r.refreshed ? true : JSON.stringify(r).slice(0, 200)) },
        {
            check: {
                desc: 'サーバーの時刻を聞く：20 年進む',
                run: async (page) => {
                    const now = await page.evaluate(() => window.__monitoringE2E.clock.now());
                    const step = await page.evaluate((iso) => window.__monitoringE2E.clock.hear(iso), new Date(now + YEARS_20).toISOString());
                    return Math.abs(step - YEARS_20) < 120_000 ? true : `step ${step}`;
                },
            },
        },
        { wait: 1000 },
        {
            ai: 'monitoring_save',
            args: { confirmed: true },
            means: '保存したまとまりに、時刻を聞く前に読んだ故障が入っている',
            expect: (r) => (r && r.saved && r.faultCount === 1 ? true : JSON.stringify(r)),
        },
        {
            ai: 'monitoring_sessions',
            means: '保存した記録の日付は、聞いた時刻に合っている（20 年後）',
            expect: (r) => {
                const s = (r?.saved ?? [])[0];
                const year = s ? new Date(s.createdAt).getUTCFullYear() : null;
                return year && year >= new Date().getUTCFullYear() + 19 ? true : JSON.stringify(s);
            },
        },
        { reload: true, means: 'ページを開き直す' },
        forget,
        ...connectPractice,
        { ai: 'monitoring_faults', args: { refresh: true }, means: '故障を読む（時刻はナビの時計のまま）', expect: (r) => (r && r.refreshed ? true : JSON.stringify(r).slice(0, 200)) },
        { ui: 'click', text: 'DISCONNECT', settle: 800, means: '切断' },
        { reload: true, means: '時刻を聞く前にページが閉じた（キーオフ）' },
        { wait: 1000 },
        {
            ai: 'monitoring_sessions',
            means: '直せなかった記録は「日付が確かでない」として残り、見つけた時から 7 日を数える',
            expect: (r) => {
                const ep = (r?.notKept ?? []).find((x) => x.undated);
                return ep && ep.daysLeft === 7 ? true : JSON.stringify(r?.notKept ?? r).slice(0, 400);
            },
        },
        { ui: 'tab', name: 'MEMORY', means: 'MEMORY を開く' },
        { screen: { desc: 'MEMORY に「日付が確かでない・あと 7 日」', has: ['日付が確かでない・あと 7 日'] } },
        { shot: 'undated' },
    ],
};

export default scenario;
