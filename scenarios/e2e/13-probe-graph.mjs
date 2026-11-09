import { connectPractice, plan, startProbe, tool } from './_lib.mjs';

/**
 * The graph part (owner, 2026-11-09): "列が出てるんだけど、グラフにできる？" — while driving, the
 * value large, coloured by its distance from the target, the last half minute of value and target
 * as lines, and beside it small what the car was doing.
 */
const WORDS = 'VANOS が目標に付いてくるか、走りながら見せて';

const scenario = {
    id: 'S13',
    title: 'PROBE のグラフ：見る値と目標 → 大きな値・二本の線・状況の値 → 二枚目の窓に大きく',
    story:
        '走りながら吸気 VANOS を見る計画で PROBE を回す。AI がボードに graph を置く（実角と目標角、状況に回転とスロットル、幅 ±2°）。' +
        'ボードには値と目標、「AI の決めた幅」、回転とスロットルが出て、二枚目の窓（VISU）には同じグラフが大きく出る。値は走っている間に動く。',
    car: { dmeFaults: [], speedKmh: 50 },
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
            purpose: '吸気 VANOS の追従',
            steps: [{ n: 1, do: 'VANOS と状況', kind: 'sample', channels: ['35:evan1_ist', '35:evan1_soll', '3:n', '3:wdk1'] }],
        }),
        startProbe,
        {
            ai: 'monitoring_show',
            args: {
                parts: [
                    {
                        kind: 'graph',
                        title: '吸気 VANOS の追従',
                        channels: ['35:evan1_ist', '35:evan1_soll'],
                        context: ['3:n', '3:wdk1'],
                        band: 2,
                    },
                ],
                replace: true,
            },
            means: 'AI がグラフを置く',
            expect: (r) => (r && r.placed && r.placed.length === 1 && r.screen === 'probe' ? true : JSON.stringify(r)),
        },
        { until: 'AI の決めた幅', means: 'ボードにグラフが出る' },
        { screen: { desc: 'ボード：見る値の名前、目標、幅の出所、状況の値', has: ['GRAPH', '吸気VANOS バンク1 実角', '目標', 'Δ', '±2 · AI の決めた幅', 'エンジン回転数', 'スロットルポテンショ1 実位置', 'LIVE'] } },
        {
            check: {
                desc: '走っている間にサンプルが増える（グラフは動いている）',
                run: async (page) => {
                    const a = (await tool(page, 'monitoring_status')).probe?.samples ?? 0;
                    await page.waitForTimeout(2500);
                    const b = (await tool(page, 'monitoring_status')).probe?.samples ?? 0;
                    return b > a ? true : `samples ${a} → ${b}`;
                },
            },
        },
        { ai: 'monitoring_display', args: { pane: 'visu' }, means: '二枚目の窓を出す', expect: () => true },
        { wait: 800 },
        { shot: 'graph' },
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '止める（復唱のあと）', expect: (r) => (JSON.stringify(r).includes('probe') ? true : JSON.stringify(r)) },
        { wait: 1500 },
        { screen: { desc: '止めたあとは、その回の記録からグラフを描く（LIVE ではない）', has: ['吸気VANOS バンク1 実角', 'AI の決めた幅'], hasNot: ['LIVE'] } },
    ],
};

export default scenario;
