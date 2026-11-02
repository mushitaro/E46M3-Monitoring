import { connectPractice, plan, startProbe, tool } from './_lib.mjs';

/**
 * NEXT and item versions (operator, 2026-11-02): a session that has taken data is carried into the
 * next; an item added starts its series there, an item removed keeps its history; compare uses
 * the items both measured.
 */
const WORDS = '毎週の点検をして。前回と比べて';

const stopProbe = { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '止める（復唱のあと）', expect: (r) => (JSON.stringify(r).includes('probe') ? true : JSON.stringify(r)) };

const scenario = {
    id: 'S09',
    title: 'NEXT と項目の版：先週のセッションを引き継ぐ → 項目を足して外す → 共通の項目だけを比べ、足した・外したに印',
    story:
        '先週の点検のセッション（v1：車速と 1 番の点火角）でデータを取る。オーナーが STARTUP の NEXT を押し、委任と形が新しいセッションに移る。' +
        'AI は形の新しい版 v2 で 2 番の点火角とその判定を足し、1 番を外す。2 回目を取り、前のセッションの最後の回と比べる：' +
        '比べるのは両方で測った車速と判定 J1 だけで、足した項目は「v2 から」、外した項目は「それまでの記録は残る」と出る。STARTUP の系列に版の変化が出る。',
    car: { dmeFaults: [] },
    steps: [
        { say: WORDS },
        ...connectPractice,
        {
            ai: 'monitoring_investigate',
            args: { words: WORDS, modules: ['mss54'], days: 30, mode: 'predictive' },
            means: '予兆保全の調査として任される',
            expect: (r) => (r && r.record && r.mandate ? true : JSON.stringify(r)),
            keep: (r, st) => Object.assign(st, { record: r.record, mandate: r.mandate, first: r.record }),
        },
        plan({
            purpose: '週ごとの点検',
            judge: [
                { id: 'J1', channel: '19:v', stat: 'max', op: '==', value: 0, provenance: 'authored', note: '停車中' },
                { id: 'J2', channel: '19:tz1', stat: 'spread', op: '<=', value: 5, provenance: 'authored' },
            ],
            steps: [{ n: 1, do: '車速と 1 番の点火角', kind: 'sample', channels: ['19:v', '19:tz1'] }],
        }),
        startProbe,
        { wait: 3000 },
        stopProbe,
        { wait: 1500 },
        { ai: 'monitoring_display', args: { show: 'startup' }, means: 'AI が STARTUP を出す（画面は PROBE に）', expect: (r) => (r && r.shown === 'startup' ? true : JSON.stringify(r)) },
        { screen: { desc: 'このセッションは 1 回分のデータがある', has: ['毎週の点検', 'v1', '1 回'] } },
        { ui: 'click', text: 'Next', settle: 1500, means: 'オーナーが NEXT を押す' },
        {
            check: {
                desc: '新しいセッションが開き、前のセッションに続いている',
                run: async (page, st) => {
                    const s = await tool(page, 'monitoring_status');
                    if (!s.session || s.session === st.first) return `session ${s.session}`;
                    st.record = s.session;
                    const c = await tool(page, 'monitoring_cowork', { record: s.session });
                    const m = (c.list ?? []).find((e) => e.kind === 'mandate');
                    st.mandate = m?.id;
                    return m && m.follows === st.first && m.by === 'owner' ? true : JSON.stringify(m ?? c).slice(0, 300);
                },
            },
        },
        { screen: { desc: '一覧に新しいセッション、前のセッションの続きと出る', has: ['のセッションの続き', 'データなし'] } },
        plan({
            purpose: '週ごとの点検（2 番を足し、1 番を外す）',
            judge: [
                { id: 'J1', channel: '19:v', stat: 'max', op: '==', value: 0, provenance: 'authored', note: '停車中' },
                { id: 'J3', channel: '19:tz2', stat: 'spread', op: '<=', value: 5, provenance: 'authored' },
            ],
            steps: [{ n: 1, do: '車速と 2 番の点火角', kind: 'sample', channels: ['19:v', '19:tz2'] }],
        }),
        {
            check: {
                desc: '新しい版は v2 で、分かれていない（前の形を書き換える）',
                run: async (_page, st) => (st.plan && st.plan.v === 2 ? true : JSON.stringify(st.plan)),
            },
        },
        startProbe,
        { wait: 3000 },
        stopProbe,
        { wait: 1500 },
        {
            ai: 'monitoring_compare',
            means: '前のセッションの最後の回と比べる：共通は車速と J1 だけ、足したのは 2 番と J3、外したのは 1 番と J2',
            expect: (r) => {
                if (!r || r.error) return JSON.stringify(r);
                const ch = (r.channels ?? []).map((c) => c.channel).join(',');
                const added = (r.items?.added ?? []).map((i) => i.label).sort().join(',');
                const removed = (r.items?.removed ?? []).map((i) => i.label).sort().join(',');
                const judges = (r.judges ?? []).map((j) => j.id).join(',');
                // Block 19 is read whole, so both runs hold tz1 and tz2: only what both forms name is compared.
                const ok = r.a.record !== r.b.record && ch === '19:v' && added === '19:tz2,J3' && removed === '19:tz1,J2' && judges === 'J1';
                return ok ? true : JSON.stringify({ a: r.a.record, b: r.b.record, ch, added, removed, judges });
            },
        },
        {
            ai: 'monitoring_show',
            args: { replace: true, parts: [{ kind: 'message', text: '先週と比べて、停車中の値は変わっていません。2 番の点火角は今回から測っています。' }, { kind: 'compare', title: '先週と今週' }] },
            means: 'AI が結論と比較を置く',
            expect: (r) => (r && r.placed && r.placed.length === 2 ? true : JSON.stringify(r)),
        },
        { until: '先週と今週', means: 'ボードが端末から読み直される' },
        {
            screen: {
                desc: '比較：共通の車速、足した 2 番は「v2 から」、外した 1 番は「記録は残る」',
                has: ['COMPARE', '先週と今週', '19:v', 'ADDED', '19:tz2', 'v2 から測っています', 'REMOVED', '19:tz1', 'それまでの記録は残ります'],
            },
        },
        { shot: 'compare' },
        { ui: 'tab', name: 'STARTUP', means: 'オーナーが STARTUP を開く' },
        { screen: { desc: '系列：二つのセッション、v2 で足した項目と外した項目', has: ['SERIES', 'v2', '+19:tz2', '+J3'] } },
        { shot: 'series' },
    ],
};

export default scenario;
