import { NAVI, all, ask, connect, noVin, openNavi, screenText } from './_sc01-07.mjs';

/**
 * SC03 気になる症状を任せる（症状・PROBE）。docs/VIRTUAL-CAR-TESTS.md M1。
 * 走りの筋書き（practiceCar.drive）で 0→25→40→0 km/h を走り、止まったら停車中に読むもの（DSC MK60 の故障）を読む。
 */
const WORDS = '低速カーブで DSC が早く効く気がする。原因を調べて、任せる';
const PURPOSE = '低速で曲がるとき、DSC が見る車速と DME の車速を比べる';

const planBody = (v) => ({
    purpose: v === 1 ? PURPOSE : `${PURPOSE}（2 版目：走り出しを長めに取る）`,
    hypotheses: [{ id: 'H1', text: '低速で DSC の車速が DME の車速とずれる', refutedBy: '0〜40 km/h で 19:v と 19:v_asc の差が 2 km/h 以内' }],
    criteria: '低速（10〜30 km/h）で二つの車速の差が 2 km/h 以内',
    judge: [{ id: 'J1', hypothesis: 'H1', channel: '19:v', stat: 'max', op: '>', value: 20, provenance: 'authored', note: '低速の走行を取れた' }],
    steps: [
        { n: 1, do: '車速を DME と DSC の二系統で記録', kind: 'sample', channels: ['19:v', '19:v_asc'] },
        { n: 2, do: '低速で走り出すところを捉える', kind: 'capture', condition: [{ channel: '19:v', op: '>', value: 20 }], preS: 2, postS: v === 1 ? 3 : 5 },
        { n: 3, do: '止まったら DSC の故障を読む', kind: 'faults', module: 'dsc_mk60', when: 'parked' },
    ],
});

const DRIVE = { points: [{ t: 0, kmh: 0, gear: 1 }, { t: 3, kmh: 25, gear: 2 }, { t: 6, kmh: 40, gear: 3 }, { t: 9, kmh: 40 }, { t: 12, kmh: 0, gear: 0 }, { t: 600, kmh: 0 }] };

const scenario = {
    id: 'SC03',
    title: '気になる症状を任せる：声で任せる → PROBE の計画 → 走る → 停車中に読む → 何が分かった → 次の日に続ける',
    story:
        'オーナーが声で「低速カーブで DSC が早く効く気がする。原因を調べて、任せる」。AI は見る値と走り方の条件を言い、PROBE を始める。' +
        '画面は PROBE になり、計画が見える。0→25→40→0 km/h と走る間は画面を触らない。止まると停車中に読むものを読み、AI は分かったことと足りないことを分けて言う。' +
        '次の日「続けて」で、前回の続き（計画 2 版目）から始まり、前回の結果は消えていない。',
    viewport: NAVI,
    car: { dmeFaults: [], dscMk60: [{ code: 0x5d8c, status: 0x24 }] },
    steps: all([
        openNavi({ dmeFaults: [], dscMk60: [{ code: 0x5d8c, status: 0x24 }] }),
        ...connect,
        // 1. 声で任せる
        { say: WORDS },
        {
            check: {
                desc: '手順 1：AI が調査を任され（症状）、計画を書いて PROBE を始める',
                run: async (page, st) => {
                    const inv = await ask(page, st, 'monitoring_investigate', { words: WORDS, modules: ['mss54', 'dsc_mk60'], days: 7, mode: 'symptom' });
                    if (!inv.record || !inv.mandate) return `任されない：${JSON.stringify(inv).slice(0, 200)}`;
                    Object.assign(st, { record: inv.record, mandate: inv.mandate });
                    const p = await ask(page, st, 'monitoring_plan', { record: st.record, mandate: st.mandate, ...planBody(1) });
                    if (p.error || p.v !== 1) return `計画：${JSON.stringify(p).slice(0, 200)}`;
                    const r = await ask(page, st, 'monitoring_probe', { record: st.record });
                    return r.started && r.plan === 1 && r.run === 1 ? true : `PROBE：${JSON.stringify(r).slice(0, 200)}`;
                },
            },
        },
        {
            ai: 'monitoring_show',
            args: { parts: [{ kind: 'plan' }] },
            means: 'AI が計画をボードに置く（何を見るか、どう走るか）',
            expect: (r) => (r && r.placed?.length === 1 ? true : JSON.stringify(r).slice(0, 200)),
        },
        { wait: 1200 },
        {
            check: {
                desc: '手順 1：画面のモードが PROBE になり、計画（目的と手順）が見える',
                run: async (page, st) => {
                    const s = await ask(page, st, 'monitoring_status');
                    await ask(page, st, 'monitoring_display', { pane: 'list' });
                    await page.waitForTimeout(600);
                    const t = await screenText(page);
                    const why = [];
                    if (s.mode !== 'probe') why.push(`mode: ${s.mode}`);
                    if (!t.includes(PURPOSE)) why.push('計画の目的が画面に無い');
                    if (!t.includes('車速を DME と DSC の二系統で記録')) why.push('計画の手順が画面に無い');
                    return why.length ? why.join('、') : true;
                },
            },
        },
        { shot: 's01-plan' },
        { ui: 'click', text: 'VISU', settle: 400, means: '走行中の画面（VISU）' },
        // 2. そのまま走る（0→25→40→0 km/h）
        { car: { drive: DRIVE }, means: '走る：0→25→40→0 km/h（12 秒）' },
        { wait: 4500 },
        { shot: 's02-driving' },
        {
            check: {
                desc: '手順 2：走行中、画面に「PROBE n/3」の進み具合（手順 3 つのうちいくつ）',
                run: async (page) => {
                    const t = await screenText(page);
                    const m = /PROBE v\d+ · (\d+)\/(\d+)/.exec(t);
                    if (!m) return `進み具合が無い：${t.split('\n').filter((l) => l.includes('PROBE')).join(' / ')}`;
                    return m[2] === '3' ? true : `「${m[0]}」と出る（計画の手順は 3 つ）`;
                },
            },
        },
        {
            check: {
                desc: '手順 2：走行中、触る必要のある表示が出ない（ダイアログも、確認を求める札も無い）',
                run: async (page) => {
                    const dialogs = await page.locator('[role=dialog]').count();
                    const t = await screenText(page);
                    const asks = ['押してください', '選んでください', '確認してください'].filter((w) => t.includes(w));
                    return dialogs === 0 && asks.length === 0 ? true : `ダイアログ ${dialogs}、${asks.join(', ')}`;
                },
            },
        },
        {
            check: {
                desc: '手順 2：走行中の画面は、計画で見る値（車速 2 つ）が主役で、見ない値が並ばない（D2-4）',
                run: async (page) => {
                    const t = await screenText(page);
                    const extra = ['噴射カット', '噴射時間'].filter((w) => t.includes(w));
                    return extra.length ? `計画で選んでいない値が並ぶ：${extra.join('、')}（ブロック 19 を丸ごと）` : true;
                },
            },
        },
        // 3. 停車
        { wait: 10000, means: '止まるまで（筋書きは 12 秒で 0 km/h）' },
        { shot: 's03-parked' },
        {
            check: {
                desc: '手順 3：止まると「停車中に読むもの」（DSC の故障）を読んだと分かる',
                run: async (page, st) => {
                    const o = await ask(page, st, 'monitoring_run_overview');
                    const step3 = (o.steps ?? []).find((x) => x.n === 3);
                    const t = await screenText(page);
                    if (step3?.state !== 'done') return `手順 3 は ${step3?.state}：「${step3?.reason ?? ''}」`;
                    return /停車中|DSC/.test(t) ? true : '画面に読んだことが出ていない';
                },
            },
        },
        { say: '何が分かった？' },
        {
            check: {
                desc: '手順 3：AI の答えで、分かったこと（二つの車速の最大・平均）と、まだ足りないこと（読めなかった手順とその理由）を分けられる（言い方は声の稽古で確かめる）',
                run: async (page, st) => {
                    const o = await ask(page, st, 'monitoring_run_overview', { channels: ['19:v', '19:v_asc'] });
                    const v = o.stats?.['19:v'];
                    const can = o.stats?.['19:v_asc'];
                    const why = [];
                    if (!(v?.max >= 39 && can?.max >= 39)) why.push(`車速の最大：DME ${v?.max}、CAN ${can?.max}`);
                    const open = (o.steps ?? []).filter((x) => x.state !== 'done');
                    if (open.some((x) => !x.reason)) why.push(`済んでいない手順に理由が無い：${JSON.stringify(open)}`);
                    return why.length ? why.join('。') : true;
                },
            },
        },
        {
            ai: 'monitoring_stop_log',
            args: { confirmed: true },
            means: '「止めますか？」に「はい」のあと、今日の回を止める',
            expect: (r) => (r?.stopped === 'probe' ? true : JSON.stringify(r)),
        },
        { wait: 1500 },
        { shot: 's03-stopped' },
        // 4. 次の日に「続けて」
        { say: '続けて' },
        {
            check: {
                desc: '手順 4：前回の続き（同じ記録、計画 2 版目）で 2 回目が始まる',
                run: async (page, st) => {
                    const inv = await ask(page, st, 'monitoring_investigate', { words: '続けて', modules: ['mss54', 'dsc_mk60'], days: 7, mode: 'symptom', record: st.record });
                    if (inv.record !== st.record) return `別の記録になった：${JSON.stringify(inv).slice(0, 200)}`;
                    const p = await ask(page, st, 'monitoring_plan', { record: st.record, mandate: inv.mandate, ...planBody(2) });
                    if (p.v !== 2) return `計画の版：${JSON.stringify(p).slice(0, 200)}`;
                    const r = await ask(page, st, 'monitoring_probe', { record: st.record });
                    return r.started && r.plan === 2 && r.run === 2 ? true : `PROBE：${JSON.stringify(r).slice(0, 200)}`;
                },
            },
        },
        { wait: 2500 },
        {
            check: {
                desc: '手順 4：画面に 2 版目と出る',
                run: async (page) => {
                    const t = await screenText(page);
                    return /PROBE v2/.test(t) ? true : `画面：${t.split('\n').filter((l) => l.includes('PROBE')).join(' / ')}`;
                },
            },
        },
        {
            check: {
                desc: '手順 4：前回の結果（1 回目）が消えていない（比べられる）',
                run: async (page, st) => {
                    await ask(page, st, 'monitoring_stop_log', { confirmed: true });
                    await page.waitForTimeout(1500);
                    const c = await ask(page, st, 'monitoring_compare', { record: st.record });
                    return c.a?.n === 1 && c.b?.n === 2 && c.a?.samples > 0 ? true : JSON.stringify(c).slice(0, 300);
                },
            },
        },
        { shot: 's04-next-day' },
        noVin,
    ]),
};

export default scenario;
