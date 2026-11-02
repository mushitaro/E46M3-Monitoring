import { connectPractice, plan, tool } from './_lib.mjs';

/**
 * MODE, STARTUP and the board (operator, 2026-11-02): PROBE is the assistant's mode; a session is
 * started on purpose and by the owner's words; the assistant places parts and the owner rearranges them.
 */
const WORDS = '新しく調べて。アイドルがばらつく気がする';

const scenario = {
    id: 'S08',
    title: 'PROBE モード：AI だけが選べる → NEW SESSION → 言葉で始める → 形 → ハブで走らせる → ボードに部品 → オーナーが閉じて並べ替える',
    story:
        'AI がオフのまま、オーナーが MODE の PROBE を押しても選べず、理由が出る。AI が空のセッションを開き（画面は PROBE の STARTUP）、言葉の前には形を書けないことを確かめ、' +
        'オーナーの言葉でそのセッションを始め、形を書く。オーナーは PROBE のボードを開き（まだ空）、ハブの PROBE で走らせる。AI が結論・判定・形をボードに置き、' +
        'オーナーは AI の言葉を閉じ、形を上に動かす。AI はいまの並びを読み返す。読み込み直しても、ボードは端末に残っている。',
    car: { dmeFaults: [] },
    steps: [
        { say: WORDS },
        ...connectPractice,
        { ui: 'click', selector: '[data-mode=probe]', means: 'AI がオフのまま、オーナーが MODE の PROBE を押す' },
        { screen: { desc: 'PROBE は選べず、通知行に理由が出る。タブは MANUAL のまま', has: ['PROBE は AI のモードです', 'DIAGNOSIS'], hasNot: ['STARTUP'] } },
        {
            ai: 'monitoring_session',
            args: { action: 'new', confirmed: true },
            means: 'AI が空のセッションを開き、画面は PROBE の STARTUP になる',
            expect: (r) => (r && r.fresh && r.screen === 'startup' ? true : JSON.stringify(r)),
            keep: (r, st) => Object.assign(st, { record: r.record }),
        },
        { screen: { desc: 'タブは STARTUP と PROBE、一覧の先頭に新しいセッション', has: ['STARTUP', '新しいセッション', 'まだ始まっていません'], hasNot: ['DIAGNOSIS', 'ADAPTATION'] } },
        {
            ai: 'monitoring_plan',
            args: { mandate: 'xxxxxxxx', purpose: '先に形を書く', steps: [{ n: 1, do: 'ライブ値', kind: 'sample', channels: ['19:v'] }] },
            means: 'オーナーの言葉の前には形を書けない（空のセッション）',
            expect: (r, e) => (/new and empty/.test(e ?? '') ? true : e ?? JSON.stringify(r)),
        },
        {
            check: {
                desc: 'AI がオーナーの言葉で、開いているそのセッションを始める',
                run: async (page, st) => {
                    const r = await tool(page, 'monitoring_investigate', { words: WORDS, modules: ['mss54'], days: 7, mode: 'symptom' });
                    st.mandate = r.mandate;
                    return r.record === st.record ? true : JSON.stringify(r).slice(0, 300);
                },
            },
        },
        plan({
            purpose: 'アイドルの揺れ',
            criteria: '停車中、点火角が気筒間で揃う',
            judge: [
                { id: 'J1', channel: '19:v', stat: 'max', op: '==', value: 0, provenance: 'authored', note: '停車中' },
                { id: 'J2', channel: '19:tz1', stat: 'spread', op: '<=', value: 5, provenance: 'authored', note: '点火角の揺れ' },
            ],
            steps: [{ n: 1, do: 'ライブ値をブロックごと', kind: 'sample', channels: ['19:*'] }],
        }),
        { wait: 800 },
        { screen: { desc: 'STARTUP の行にオーナーの言葉と v1、まだデータなし', has: ['アイドルがばらつく', 'v1', 'データなし'] } },
        { ui: 'tab', name: 'PROBE', means: 'オーナーが PROBE のボードを開く' },
        { screen: { desc: 'まだ何も置かれていない：何も出ない', hasNot: ['FORM', 'JUDGEMENTS', 'AI の言葉'] } },
        { ui: 'click', role: 'PROBE', settle: 1500, means: 'ハブの PROBE で、このセッションの形を走らせる' },
        { until: 'サンプル', means: 'ハブの通知行に PROBE の進み' },
        { wait: 3000 },
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '止める（復唱のあと）', expect: (r) => (JSON.stringify(r).includes('probe') ? true : JSON.stringify(r)) },
        { wait: 1500 },
        {
            ai: 'monitoring_show',
            args: {
                parts: [
                    { kind: 'message', text: '停車中のアイドルは安定しています。点火角の揺れは基準内です。' },
                    { kind: 'judges', title: '1 回目の判定' },
                    { kind: 'plan' },
                ],
            },
            means: 'AI が結論の一言・判定・形を置く',
            expect: (r) => (r && r.placed && r.placed.length === 3 && r.screen === 'probe' ? true : JSON.stringify(r)),
        },
        { until: '停車中のアイドルは安定しています', means: 'ボードが端末から読み直される' },
        { screen: { desc: 'ボードに AI の言葉・判定（PASS）・形', has: ['停車中のアイドルは安定しています', 'AI の言葉', 'JUDGEMENTS', '1 回目の判定', 'PASS', 'FORM', 'アイドルの揺れ'] } },
        { shot: 'board' },
        { ui: 'click', role: '閉じる', means: 'オーナーが最初の部品（AI の言葉）を閉じる' },
        { ui: 'click', role: '上へ', nth: 2, means: 'オーナーが形（3 番目）を一つ上へ' },
        { wait: 500 },
        {
            check: {
                desc: 'AI がいまの並びを読み返す：AI の言葉は閉じ、形が判定の上',
                run: async (page) => {
                    const s = await tool(page, 'monitoring_status');
                    const line = (s.board ?? []).map((p) => `${p.kind}:${p.open ? 'open' : 'closed'}`).join(',');
                    return line === 'message:closed,plan:open,judges:open' ? true : line || JSON.stringify(s).slice(0, 300);
                },
            },
        },
        { reload: true, means: 'ナビのキーオフとオン' },
        {
            check: {
                desc: 'AI がそのセッションを開き直す',
                run: async (page, st) => {
                    const r = await tool(page, 'monitoring_session', { action: 'open', record: st.record });
                    return r && r.opened === st.record ? true : JSON.stringify(r);
                },
            },
        },
        { ui: 'tab', name: 'PROBE', means: 'ボードを開く' },
        { until: 'JUDGEMENTS', means: 'ボードが端末から読み直される' },
        { screen: { desc: 'ボードは端末に残っている：閉じた AI の言葉は中身を出さず、形と判定は開いている', has: ['FORM', 'JUDGEMENTS', 'PASS'], hasNot: ['停車中のアイドルは安定しています'] } },
        { shot: 'kept' },
    ],
};

export default scenario;
