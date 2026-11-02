import { connectPractice, plan, scanAndWait, startProbe, tool } from './_lib.mjs';

/** 予兆保全 (operator, 2026-11-01): no fault, check everything against criteria, then again, and compare. */
const WORDS = '健康診断して。前回と比べて';

const scenario = {
    id: 'S03',
    title: 'AI 予兆保全：故障なし → 全部を見る → 2 回測って比べる',
    story:
        '故障の無い車で、オーナーが健康診断を頼む。AI は全モジュールを読み、故障が無いことを言い、予兆保全の調査として停車中のライブ値と学習値を判定つきで取る。' +
        '同じ記録でもう一度測り、1 回目と比べる。',
    car: { dmeFaults: [] },
    steps: [
        { say: WORDS },
        ...connectPractice,
        ...scanAndWait,
        {
            ai: 'monitoring_faults',
            means: 'どのモジュールにも DME の解読できる故障は無い',
            expect: (r) => (/0x2A/i.test(JSON.stringify(r)) ? 'DME に 0x2A がある' : true),
        },
        { screen: { desc: 'DME は「故障なし」', has: ['全モジュール', '故障なし'] } },
        {
            ai: 'monitoring_investigate',
            args: { words: WORDS, modules: [], days: 30, mode: 'predictive' },
            means: '予兆保全の調査として任される',
            expect: (r) => (r && r.record && r.mandate ? true : JSON.stringify(r)),
            keep: (r, st) => Object.assign(st, { record: r.record, mandate: r.mandate }),
        },
        plan({
            purpose: '停車・アイドルの健康診断',
            criteria: '停車中、車速 0、点火角が気筒間で揃う',
            judge: [
                { id: 'J1', channel: '19:v', stat: 'max', op: '==', value: 0, provenance: 'authored', note: '停車中' },
                { id: 'J2', channel: '19:tz1', stat: 'spread', op: '<=', value: 5, provenance: 'authored', note: '点火角の揺れ' },
            ],
            steps: [
                { n: 1, do: 'ライブ値をブロックごと', kind: 'sample', channels: ['19:*'] },
                { n: 2, do: '学習値', kind: 'adapt', when: 'parked' },
            ],
        }),
        startProbe,
        { wait: 4000 },
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '1 回目を止める', expect: (r) => (JSON.stringify(r).includes('probe') ? true : JSON.stringify(r)) },
        { wait: 1500 },
        {
            ai: 'monitoring_run_overview',
            means: '判定 J1・J2 が合格、学習値が読めている',
            expect: (r) => {
                const j = r?.judges ?? [];
                const failed = j.filter((x) => x.pass !== true);
                return j.length === 2 && failed.length === 0 ? true : JSON.stringify(j);
            },
        },
        startProbe,
        { wait: 4000 },
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '2 回目を止める', expect: (r) => (JSON.stringify(r).includes('probe') ? true : JSON.stringify(r)) },
        { wait: 1500 },
        {
            check: {
                desc: 'AI が 2 回目を 1 回目と比べる：値ごとの変化が返る',
                run: async (page, st) => {
                    const r = await tool(page, 'monitoring_compare', { record: st.record });
                    st.compare = r;
                    const s = JSON.stringify(r);
                    return r && !r.error && /19:/.test(s) ? true : s.slice(0, 300);
                },
            },
        },
        { shot: 'compared' },
    ],
};

export default scenario;
