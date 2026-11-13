import { connectPractice, plan, startProbe, tool } from './_lib.mjs';

/**
 * The screen follows the work (operator, 2026-11-12): 「ログ取ってとかエラーコード読んでとか、俺が指示した時に、
 * いつも画面変わんない」 — and while recording, VISU went black when no graph had been placed, and the
 * board's values were small rows where the owner pictured cards.
 */
const WORDS = '走りながら回転と VANOS を見ておいて';
const screenIs = (want) => async (page) => {
    const s = await tool(page, 'monitoring_status');
    return s.screen === want ? true : `screen ${s.screen}, wanted ${want}`;
};

const scenario = {
    id: 'S18',
    title: '画面が仕事に付いてくる：故障 → DIAGNOSIS、記録 → DATALOG、PROBE → ボード（VISU は空にならない、値はカード）',
    story:
        'AI に故障を読ませると DIAGNOSIS に、記録を始めさせると DATALOG の VISU に、PROBE を始めさせるとボードの VISU に、画面が自分で移る。' +
        'グラフを置いていなくても、記録中の VISU には最初の値のグラフと残りの値のカードが出る。記録中に故障を読ませても、画面はボードのまま。' +
        'ボードの values は大きな数字のカードで出る。',
    car: { dmeFaults: [], speedKmh: 40 },
    steps: [
        { say: 'エラーコード読んで' },
        ...connectPractice,
        { ai: 'monitoring_display', args: { show: 'memory' }, means: '別の画面にいる', expect: () => true },
        { ai: 'monitoring_faults', args: { module: 'mss54', refresh: true }, means: '故障を読む', expect: (r) => (r?.refreshed ? true : JSON.stringify(r).slice(0, 300)) },
        { wait: 800 },
        { check: { desc: '画面は DIAGNOSIS に移っている', run: screenIs('diagnosis') } },
        { say: 'ログ取って、回転で' },
        { ai: 'monitoring_log_channels', args: { channels: ['3:n'] }, means: '回転を選ぶ', expect: (r) => (JSON.stringify(r).includes('3:n') ? true : JSON.stringify(r)) },
        { ai: 'monitoring_start_log', means: '記録を始める', expect: (r) => (r?.error ? JSON.stringify(r) : true) },
        { wait: 800 },
        { check: { desc: '画面は DATALOG に移っている', run: screenIs('datalog') } },
        { wait: 1500 },
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '止める（復唱のあと）', expect: () => true },
        { wait: 1000 },
        { say: WORDS },
        {
            ai: 'monitoring_investigate',
            args: { words: WORDS, modules: ['mss54'], days: 7, mode: 'symptom' },
            means: '症状の調査として任される',
            expect: (r) => (r && r.record && r.mandate ? true : JSON.stringify(r)),
            keep: (r, st) => Object.assign(st, { record: r.record, mandate: r.mandate }),
        },
        plan({ purpose: '回転と吸気 VANOS', steps: [{ n: 1, do: '回転と VANOS', kind: 'sample', channels: ['3:n', '35:evan1_ist', '35:evan1_soll'] }] }),
        startProbe,
        { wait: 800 },
        { check: { desc: '画面は PROBE のボードに移っている', run: screenIs('probe') } },
        { until: 'LIVE', means: 'グラフを置かなくても、VISU に記録中の値が出る' },
        { screen: { desc: 'VISU：最初の値（回転）のグラフと、残りの値のカード', has: ['エンジン回転数', 'LIVE', '⌀'] } },
        { shot: 'visu-auto' },
        { ai: 'monitoring_faults', args: { module: 'mss54', refresh: true }, means: '記録中に故障を読ませる', expect: () => true },
        { wait: 800 },
        { check: { desc: '記録中はボードのまま', run: screenIs('probe') } },
        {
            ai: 'monitoring_show',
            args: { parts: [{ kind: 'values', title: '今の値' }], replace: true },
            means: 'AI が値の部品を置く',
            expect: (r) => (r && r.placed && r.placed.length === 1 ? true : JSON.stringify(r)),
        },
        { ai: 'monitoring_display', args: { pane: 'list' }, means: '狭い画面では、ボードの一覧に戻す', expect: () => true },
        { until: '今の値', means: 'ボードに値の部品が出る' },
        { screen: { desc: 'ボードの値は大きな数字のカード（名前・値・単位、平均と幅）', has: ['今の値', 'エンジン回転数', '⌀'] } },
        { shot: 'value-cards' },
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '止める（復唱のあと）', expect: () => true },
    ],
};

export default scenario;
