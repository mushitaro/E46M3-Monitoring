import { always, bodyText, hasJa, practiceOneOnScreen, scanModules, tool } from './_owner.mjs';

/**
 * MM04（docs/VIRTUAL-CAR-TESTS.md M2）：ナビと AV（8）。
 * 1 ラジオ・ボードモニター・ナビ・CD を、車の装備を変えながら接続 → 同じ場所にある別の機種を、正しい名前で出し分ける。
 * 2 それぞれで動かす項目を一つ → 動くものは動作中 → 止まった。動かないものは理由が出る。
 * ボードモニター（0xF0）とナビ（0x7F）は、同じアドレスに機種が 3〜4 つある。練習の車は IDENT の答え（ハードウェア番号・診断インデックス）を変えて機種を替える。
 */
const AV = [0x68, 0xf0, 0x7f, 0x76];
const BASE = [0x32, 0x56, 0x57, 0x44, 0x00, 0x80, 0xd0, 0x50, 0x5b, 0xa4];

/** Scans the car and returns the scan's rows for the AV addresses. */
const scanAv = (label, idents) => ({
    check: {
        desc: `装備：${label} — つなぎ直して全部を読む`,
        run: async (page, st) => {
            await page.evaluate((i) => window.__monitoringE2E.car.set({ idents: { ...window.__monitoringE2E.car.get().idents, ...i } }), idents);
            const r = await tool(page, 'monitoring_scan');
            if (!r?.started) return JSON.stringify(r);
            const mods = await scanModules(page);
            if (typeof mods === 'string') return mods;
            st.av = st.av ?? {};
            st.av[label] = Object.fromEntries(AV.map((a) => {
                const m = mods.find((x) => x.address === `0x${a.toString(16).toUpperCase()}`);
                return [a, { sgbd: m?.variant?.sgbd, names: (m?.modules ?? []).map((x) => x.id), outcome: m?.outcome }];
            }));
            return true;
        },
    },
});

const scenario = {
    id: 'MM04',
    title: 'ナビと AV：ラジオ・ボードモニター・ナビ・CD を機種ごとに名前で出し分け、一つずつ動かす',
    story:
        'ナビ付きの M3。ボードモニターとナビの機種を替えながらつなぐ。同じアドレスにある別の機種を、正しい名前で出し分ける。' +
        'それぞれで動かす項目を一つ動かす。動くものは動作中から止まったまで出て、動かないものは理由が出る。',
    car: { fitted: [...BASE, ...AV], dmeFaults: [], dscMk60: [] },
    steps: always([
        { ui: 'practice' },
        { ui: 'click', text: 'CONNECT', settle: 2500, means: '人が画面で PRACTICE につなぐ' },
        scanAv('A（ボードモニターとナビ：IDENT 1）', { 0xf0: { hw: '01', diag: '01' }, 0x7f: { hw: '01', diag: '01' } }),
        { shot: 's01-a' },
        scanAv('B（ボードモニターとナビ：IDENT 2）', { 0xf0: { hw: '05', diag: '0A' }, 0x7f: { hw: '05', diag: '0A' } }),
        { shot: 's01-b' },
        {
            check: {
                desc: 'ボードモニター（0xF0）とナビ（0x7F）：IDENT が選んだ機種の名前が一つ出る（候補を並べたままにしない）',
                run: async (page, st) => {
                    const why = [];
                    for (const [label, rows] of Object.entries(st.av ?? {})) {
                        for (const a of [0xf0, 0x7f]) {
                            const r = rows[a];
                            if (!r?.sgbd || r.sgbd === '?') why.push(`${label} 0x${a.toString(16).toUpperCase()}：機種が分からない（候補 ${r?.names?.join(' / ')}）`);
                        }
                    }
                    return why.length ? why.join('、') : true;
                },
            },
        },
        {
            check: {
                desc: '画面：ボードモニターとナビの行が、一つの機種の名前で出る（「/」で候補を並べない）',
                run: async (page) => {
                    const text = await bodyText(page);
                    const lines = text.split('\n');
                    const why = [];
                    for (const a of ['0xF0', '0x7F']) {
                        const i = lines.findIndex((l) => l.trim() === a);
                        const name = lines[i + 1] ?? '';
                        if (/ \/ /.test(name)) why.push(`${a}：「${name}」`);
                    }
                    return why.length ? why.join('、') : true;
                },
            },
        },
        {
            check: {
                desc: 'ラジオ（0x68）と CD（0x76）は名前が一つで、応答している',
                run: async (page, st) => {
                    const rows = Object.values(st.av ?? {})[0] ?? {};
                    const why = [0x68, 0x76].filter((a) => rows[a]?.outcome !== 'answered' || rows[a]?.names?.length !== 1).map((a) => `0x${a.toString(16)}: ${JSON.stringify(rows[a])}`);
                    return why.length ? why.join('、') : true;
                },
            },
        },
        {
            check: {
                desc: 'それぞれで動かす項目を一つ：動くものは作動中 → 止まった。動かないものは理由が日本語で出る',
                run: async (page) => {
                    const bad = [];
                    const ran = [];
                    for (const id of ['radio', 'bmbt46rn', 'navmk4', 'cdc_46']) {
                        const r = await practiceOneOnScreen(page, id);
                        if (r.error) bad.push(`${id}：${r.error}`);
                        else if (r.ran) {
                            ran.push(`${id}=${r.ran}`);
                            if (r.armedAfter > 0) bad.push(`${id}：止めても止まらない`);
                        } else if (!r.pane) bad.push(`${id}：動かす項目が 0 件で、なぜ無いかが出ない`);
                        else if (!hasJa(r.pane)) bad.push(`${id}：理由が日本語で出ない`);
                    }
                    return bad.length ? `${bad.join('、')}（動いたもの：${ran.join(' ')}）` : true;
                },
            },
        },
        { shot: 's02-actuate' },
    ]),
};

export default scenario;
