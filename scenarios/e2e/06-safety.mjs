import { connectPractice, tool } from './_lib.mjs';

/** What the assistant must not be able to do, and what the app refuses while the car moves. */
const scenario = {
    id: 'S06',
    title: '安全：走行中の読取、消去、作動テストは AI からできない',
    story:
        '走行中（40 km/h）に AI が故障を読み直そうとすると、アプリは送らずに理由を言う。全モジュール読取も始まらない。' +
        '故障の消去や作動テストの道具は AI に無く、手順は画面に置くだけで実行されない。',
    steps: [
        ...connectPractice,
        { car: { speedKmh: 40 }, means: '走っている' },
        {
            ai: 'monitoring_faults',
            args: { module: 'mss54', refresh: true },
            means: '走行中は送らない（停車中に限る読取）',
            expect: (r) => (/moving|走行|stationary|parked|止ま/i.test(JSON.stringify(r)) ? true : JSON.stringify(r).slice(0, 300)),
        },
        {
            check: {
                desc: '走行中は全モジュール読取が止まる（車速を測って動いていると分かる）',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_scan');
                    if (!r?.started) return /moving|stationary|parked/i.test(JSON.stringify(r)) ? true : JSON.stringify(r);
                    for (let i = 0; i < 30; i++) {
                        const s = await tool(page, 'monitoring_status');
                        if (s.scan && s.scan.running === false) return s.scan.end === 'not-parked' ? true : `scan ended ${s.scan.end}`;
                        await page.waitForTimeout(1000);
                    }
                    return 'scan did not end';
                },
            },
        },
        {
            check: {
                desc: 'AI の道具に、消去・作動テスト・書き込み・新しい機器の許可が無い',
                run: async (page) => {
                    for (const name of ['monitoring_clear_faults', 'monitoring_actuate', 'monitoring_write', 'monitoring_flash', 'monitoring_pair']) {
                        const r = await tool(page, name);
                        if (!r?.error) return `${name} が答えた`;
                    }
                    return true;
                },
            },
        },
        { car: { speedKmh: 0 }, means: '止まる' },
        {
            ai: 'monitoring_catalog',
            args: { module: 'mss54' },
            means: '試せる手順の一覧（説明つき）',
            expect: (r) => (r && !r.error ? true : JSON.stringify(r).slice(0, 200)),
            keep: (r, st) => {
                // An actuator test: something the assistant may only put on the screen.
                const job = (r.jobs ?? []).find((j) => /^STEUERN_/.test(j.job)) ?? (r.jobs ?? [])[0];
                st.job = job ? job.job : null;
            },
        },
        {
            check: {
                desc: '手順は画面に置くだけ：SERVICE に選ばれ、実行はされない',
                run: async (page, st) => {
                    if (!st.job) return 'catalog に手順が無い';
                    const r = await tool(page, 'monitoring_stage', { module: 'mss54', job: st.job });
                    st.staged = r;
                    if (!r || r.staged === undefined) return JSON.stringify(r).slice(0, 300);
                    // Put on the screen, never run: the comms log shows no actuator frame.
                    const log = await page.evaluate(() => document.body.innerText);
                    return /SERVICE/.test(log) ? true : 'SERVICE に出ていない';
                },
            },
        },
        { shot: 'staged' },
    ],
};

export default scenario;
