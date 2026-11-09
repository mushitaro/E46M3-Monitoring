import { connectPractice, plan, startProbe, tool } from './_lib.mjs';

/**
 * PROBE on the road (2026-11-09): the owner drove with PROBE on, the status said the speed was
 * unknown the whole way, and three runs ended "link-lost" — two after about three minutes, on a
 * link that was still up. The speed is now kept from the run's own reads, a heartbeat no longer
 * cuts into a run, and a run that does lose the line begins again by itself.
 */
const WORDS = '走りながら VANOS を見ておいて。切れても続けて';

const status = (page) => tool(page, 'monitoring_status');

const scenario = {
    id: 'S12',
    title: 'PROBE と走行：車速が見える → 回線が切れる → 自分で始め直す → 止めると待ちも止まる',
    story:
        '40 km/h で走りながら PROBE を回す。状態の車速は 40 km/h、走行中と出る。回線が黙ると、その回は「link-lost」で終わり、' +
        'ハブに「回線が切れた・再開を待つ」が出る。回線が戻ると、同じ計画の次の回が自分で始まる（ドライバーは何も押さない）。' +
        '止めると、その回も、次を待つことも止まる。',
    car: { dmeFaults: [], speedKmh: 40 },
    steps: [
        { say: WORDS },
        ...connectPractice,
        {
            ai: 'monitoring_investigate',
            args: { words: WORDS, modules: ['mss54'], days: 7, mode: 'symptom' },
            means: '症状の調査として任される',
            expect: (r) => (r && r.record && r.mandate ? true : JSON.stringify(r)),
            keep: (r, st) => Object.assign(st, { record: r.record, mandate: r.mandate }),
        },
        plan({
            purpose: '走行中の VANOS',
            steps: [{ n: 1, do: '車速と吸気 VANOS', kind: 'sample', channels: ['19:v', '19:v_asc'] }],
        }),
        startProbe,
        { wait: 2500 },
        {
            check: {
                desc: 'PROBE の最中も、状態に車速が出る（40 km/h、走行中）',
                run: async (page) => {
                    const s = await status(page);
                    return s.probe?.running && s.speedKmh === 40 && s.car === 'moving' ? true : JSON.stringify({ probe: s.probe, speedKmh: s.speedKmh, car: s.car }).slice(0, 300);
                },
            },
        },
        { car: { lineDown: true }, means: '回線が黙る（ケーブルが抜けた）' },
        // A line that says nothing is given up after three cycles of two tries, each waiting out its timeout.
        { until: '再開を待つ', timeout: 45000, means: 'その回は link-lost で終わり、ハブに再開待ち' },
        {
            check: {
                desc: '状態は再開待ち（1 回目）、PROBE はまだ持っている',
                run: async (page) => {
                    const s = await status(page);
                    return s.probe?.resuming === true && s.probe?.resumes === 0 ? true : JSON.stringify(s.probe).slice(0, 300);
                },
            },
        },
        { car: { lineDown: false }, means: '回線が戻る' },
        {
            check: {
                desc: '3 秒待って、同じ計画の次の回が自分で始まり、サンプルが増える',
                run: async (page) => {
                    for (let i = 0; i < 30; i++) {
                        const s = await status(page);
                        if (s.probe?.running && s.probe.resuming === false && s.probe.resumes === 1 && s.probe.samples > 0) return true;
                        await page.waitForTimeout(500);
                    }
                    return JSON.stringify((await status(page)).probe).slice(0, 300);
                },
            },
        },
        { until: 'サンプル', means: 'ハブは再びサンプルの数を出す' },
        { shot: 'resumed' },
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '止める（復唱のあと）', expect: (r) => (JSON.stringify(r).includes('probe') ? true : JSON.stringify(r)) },
        { wait: 1500 },
        {
            check: {
                desc: '止めたあとは何も走らず、最後の回は始め直した 2 回目で、止めたところで終わっている',
                run: async (page, st) => {
                    const s = await status(page);
                    if (s.probe?.running) return `still running: ${JSON.stringify(s.probe)}`;
                    const o = await tool(page, 'monitoring_run_overview');
                    return o.record === st.record && o.run === 2 && o.end === 'stopped' && o.samples > 0 ? true : JSON.stringify(o).slice(0, 400);
                },
            },
        },
    ],
};

export default scenario;
