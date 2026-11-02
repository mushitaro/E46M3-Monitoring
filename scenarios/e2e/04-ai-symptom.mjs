import { connectPractice, plan, startProbe, tool } from './_lib.mjs';

/** 症状 (operator, 2026-11-01): the owner's complaint, values chosen for it, caught where it happens. */
const WORDS = '昔よりパワーが落ちた気がする。3 速で踏んだとき';

const scenario = {
    id: 'S04',
    title: 'AI 症状：「パワーが落ちた」 → 点火角と車速 → 踏んだところを捉える',
    story:
        'オーナーの訴えをそのまま任される。AI は点火角（6 気筒）と車速を取る計画を書き、60 km/h 以上で捉える条件を置く。' +
        '車が 60 km/h を超えると PROBE がそこを捉え、止まってから AI が読む。',
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
            purpose: '踏んだときの点火角',
            hypotheses: [{ id: 'H1', text: 'ノックで点火が遅れている', refutedBy: '踏んだとき点火角が全気筒で 20°KW 以上' }],
            judge: [{ id: 'J1', hypothesis: 'H1', channel: '19:tz1', stat: 'min', where: [{ channel: '19:v', op: '>', value: 60 }], op: '>=', value: 0, provenance: 'authored' }],
            steps: [
                { n: 1, do: '点火角と車速', kind: 'sample', channels: ['19:v', '19:tz1', '19:tz2', '19:tz3', '19:tz4', '19:tz5', '19:tz6'] },
                { n: 2, do: '60 km/h を超えたところ', kind: 'capture', condition: [{ channel: '19:v', op: '>', value: 60 }], preS: 2, postS: 2 },
            ],
        }),
        startProbe,
        { wait: 2000 },
        { car: { speedKmh: 30 }, means: '3 速で流す' },
        { wait: 2000 },
        { car: { speedKmh: 80 }, means: '踏む（80 km/h）' },
        { wait: 4000 },
        { car: { speedKmh: 0 }, means: '止まる' },
        { wait: 2000 },
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '確認のあと止める', expect: (r) => (JSON.stringify(r).includes('probe') ? true : JSON.stringify(r)) },
        { wait: 1500 },
        {
            ai: 'monitoring_run_overview',
            means: '60 km/h 超えの捕捉が 1 回以上、J1 は 60 km/h 超えの区間だけで判定',
            expect: (r) => {
                if (!(r?.captures >= 1)) return `captures ${r?.captures}`;
                const j = (r.judges ?? []).find((x) => x.id === 'J1');
                return j && j.n > 0 ? true : JSON.stringify(r.judges);
            },
        },
        {
            check: {
                desc: 'AI が捉えた瞬間を読む（monitoring_moment）',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_moment', { seconds_ago: 5 });
                    return r && !r.error ? true : JSON.stringify(r).slice(0, 300);
                },
            },
        },
        { shot: 'symptom' },
    ],
};

export default scenario;
