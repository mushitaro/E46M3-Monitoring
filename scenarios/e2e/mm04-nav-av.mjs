import { always, bodyText, hasJa, onModule, practiceOneOnScreen, scanModules, tool } from './_owner.mjs';

/**
 * MM04（docs/VIRTUAL-CAR-TESTS.md M2）：ナビと AV（8）。
 * 1 ラジオ・ボードモニター・ナビ・CD を、車の装備を変えながら接続 → 同じ場所にある別の機種を、正しい名前で出し分ける。
 * 2 それぞれで動かす項目を一つ → 動くものは動作中 → 止まった。動かないものは理由が出る。
 * ボードモニター（0xF0）とナビ（0x7F）は、同じアドレスに機種が 3〜4 つある。練習の車は IDENT の答え（ハードウェア番号・診断インデックス）を変えて機種を替える。
 * この二つにはグループファイルの規則が無く（D_00xx.grp は 0x12・0x32・0x80 だけ）、名乗りからは機種を決められない。推測で決めない（CLAUDE.md）
 * ので、画面は「? 共通の名前」と「候補 n」を出し（候補は行を開くと出る。UX-19）、オーナーが ACTUATOR で一度答えたら、その名前で出す（運営者 2026-11-20 の基準）。
 */

/** Which model the owner says is fitted, as ACTUATOR's buttons name it. */
const OWNER_SAYS = [
    { address: '0xF0', id: 'bmbt46rn', button: 'ボードモニター (Radio Nav)' },
    { address: '0x7F', id: 'navmk4', button: 'ナビゲーション MK4' },
];

/** The scan list's row for an address: the line under its address. */
const rowNameOf = async (page, address) => {
    const lines = (await bodyText(page)).split('\n');
    const i = lines.findIndex((l) => l.trim() === address);
    return i < 0 ? null : (lines[i + 1] ?? '').trim();
};
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
                desc: 'ボードモニター（0xF0）とナビ（0x7F）：名乗りで決められないので、推測した機種を出さない（変種は ?）',
                run: async (page, st) => {
                    const why = [];
                    for (const [label, rows] of Object.entries(st.av ?? {})) {
                        for (const a of [0xf0, 0x7f]) {
                            const r = rows[a];
                            if (r?.sgbd && r.sgbd !== '?') why.push(`${label} 0x${a.toString(16).toUpperCase()}：名乗りに規則が無いのに ${r.sgbd} と決めている`);
                            if (r?.outcome !== 'answered') why.push(`${label} 0x${a.toString(16).toUpperCase()}：応答していない（${r?.outcome}）`);
                        }
                    }
                    return why.length ? why.join('、') : true;
                },
            },
        },
        {
            check: {
                // UX-19: the row is「? 共通の名前」with「候補 n」beside it; the candidates are named when it is opened,
                // and why the IDENT cannot choose is the list's ⓘ, once.
                desc: '画面：ボードモニターとナビの行は「?」で始まり、候補の数が付く（機種を推測しない。候補を「/」で並べて全部付いているように見せない）',
                run: async (page) => {
                    const why = [];
                    for (const a of ['0xF0', '0x7F']) {
                        const name = (await rowNameOf(page, a)) ?? '';
                        const lines = (await bodyText(page)).split('\n').map((l) => l.trim());
                        const count = lines[lines.indexOf(a) + 2] ?? '';
                        if (!/^\? \S/.test(name) || / \/ /.test(name) || !/^候補 [2-9]$/.test(count)) why.push(`${a}：「${name}」「${count}」`);
                    }
                    return why.length ? why.join('、') : true;
                },
            },
        },
        {
            check: {
                desc: 'オーナーが ACTUATOR で機種を答える（ボードモニター：Radio Nav、ナビ：MK4）。答える行は日本語で、候補が日本語の名前で並ぶ',
                run: async (page) => {
                    const why = [];
                    for (const o of OWNER_SAYS) {
                        const off = await onModule(page, o.id);
                        if (off) {
                            why.push(off);
                            continue;
                        }
                        await page.locator('[role=tab]:has-text("ACTUATOR")').first().click();
                        await page.waitForTimeout(500);
                        const text = await bodyText(page);
                        if (!text.includes(`${o.address} の機種は、名乗り（IDENT）からは決められません。`)) why.push(`${o.address}：答えを訊く文が無い`);
                        const pick = page.getByRole('button', { name: o.button, exact: true });
                        if (!(await pick.count())) {
                            why.push(`${o.address}：「${o.button}」のボタンが無い`);
                            continue;
                        }
                        await pick.first().click();
                        await page.waitForTimeout(400);
                    }
                    // Back to the list: ALL MODULES is offered on DIAGNOSIS only.
                    await page.locator('[role=tab]:has-text("DIAGNOSIS")').first().click();
                    await page.waitForTimeout(400);
                    await page.locator('select:has(option[value="all"])').first().selectOption('all');
                    await page.waitForTimeout(800);
                    return why.length ? why.join('、') : true;
                },
            },
        },
        {
            check: {
                desc: '画面：答えたあと、ボードモニターとナビの行がオーナーの答えた名前一つで出る',
                run: async (page) => {
                    const why = [];
                    for (const o of OWNER_SAYS) {
                        const name = await rowNameOf(page, o.address);
                        if (name !== o.button) why.push(`${o.address}：「${name}」（想定「${o.button}」）`);
                    }
                    return why.length ? why.join('、') : true;
                },
            },
        },
        { shot: 's01-owner-said' },
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
