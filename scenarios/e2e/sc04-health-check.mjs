import { all, ask, connect, faultsByAddress, noVin, screenText, waitScan } from './_sc01-07.mjs';

/**
 * SC04 健康診断（予兆保全）。docs/VIRTUAL-CAR-TESTS.md M1。
 * 停車中、故障の無い車。前回（1 回目）と今回（2 回目）を同じ計画で取り、判定と比較を見る。
 * 合格の文言は「外れは 1 つ、SMG の油圧が前回より低いです」。練習の車で SMG の油圧を回ごとに変えられるかも、ここで確かめる。
 */
const WORDS = '健康診断して';
const PHYD = 'smg2:STATUS_IO_LESEN:STAT_PHYD_WERT';

const scenario = {
    id: 'SC04',
    title: '健康診断（予兆保全）：停車して「健康診断して」→ 合格・外れの一覧 → 「前回と比べて」',
    story:
        '停車して声で「健康診断して」。AI は全部を読み、判定つきで値を取り、「外れは 1 つ、SMG の油圧が前回より低いです」と言う。画面に合格・外れが一覧で出る。' +
        '「前回と比べて」で、画面に前回と今回が並び、変わった値に印。AI は前回の日付を言う。',
    car: { dmeFaults: [], dscMk60: [] },
    steps: all([
        ...connect,
        { say: WORDS },
        // 1. 全部見ます
        {
            check: {
                desc: '手順 1：AI が全モジュールを読み、故障が無いと分かる',
                run: async (page, st) => {
                    const r = await ask(page, st, 'monitoring_scan');
                    if (!r.started) return JSON.stringify(r).slice(0, 200);
                    const s = await waitScan(page);
                    const n = faultsByAddress(await ask(page, st, 'monitoring_faults'));
                    const total = Object.values(n).reduce((a, b) => a + b, 0);
                    return s?.end === 'done' && total === 0 ? true : `走査 ${s?.end}、故障 ${total} 件`;
                },
            },
        },
        {
            check: {
                desc: '手順 1：AI が予兆保全として任され、判定つきの計画（電圧と SMG の油圧）を書く',
                run: async (page, st) => {
                    const inv = await ask(page, st, 'monitoring_investigate', { words: WORDS, modules: [], days: 30, mode: 'predictive' });
                    Object.assign(st, { record: inv.record, mandate: inv.mandate });
                    const p = await ask(page, st, 'monitoring_plan', {
                        record: st.record,
                        mandate: st.mandate,
                        purpose: '停車中の健康診断',
                        criteria: '電圧 13 V 以上、SMG の油圧 40 bar 以上',
                        judge: [
                            { id: 'J1', channel: '3:ub', stat: 'min', op: '>=', value: 13, provenance: 'authored', note: '電圧' },
                            { id: 'J2', channel: PHYD, stat: 'mean', op: '>=', value: 40, provenance: 'authored', note: 'SMG の油圧' },
                        ],
                        steps: [
                            { n: 1, do: 'DME の電圧と回転', kind: 'sample', channels: ['3:ub', '3:n'] },
                            { n: 2, do: 'SMG の油圧', kind: 'sample', channels: [PHYD] },
                        ],
                    });
                    return p.v === 1 ? true : JSON.stringify(p).slice(0, 300);
                },
            },
        },
        {
            check: {
                desc: '手順 1：前回の回（1 回目）を取る',
                run: async (page, st) => {
                    const r = await ask(page, st, 'monitoring_probe', { record: st.record });
                    if (!r.started) return JSON.stringify(r).slice(0, 200);
                    await page.waitForTimeout(5000);
                    await ask(page, st, 'monitoring_stop_log', { confirmed: true });
                    await page.waitForTimeout(1500);
                    st.first = await ask(page, st, 'monitoring_run_overview', { channels: ['3:ub', PHYD] });
                    return st.first.run === 1 ? true : JSON.stringify(st.first).slice(0, 200);
                },
            },
        },
        {
            check: {
                desc: '手順 1：練習の車で、SMG の油圧を前回より低くできる（できなければ「前回より低い」は試せない）',
                run: async (page) => {
                    const car = await page.evaluate(() => window.__monitoringE2E.car.get());
                    const knobs = Object.keys(car).filter((k) => /smg|phyd|hydraul|pressure/i.test(k));
                    return knobs.length ? true : `練習の車に SMG の値を変える項目が無い（${Object.keys(car).join(', ')}）`;
                },
            },
        },
        {
            check: {
                desc: '手順 1：今回の回（2 回目）を取る',
                run: async (page, st) => {
                    const r = await ask(page, st, 'monitoring_probe', { record: st.record });
                    if (!r.started) return JSON.stringify(r).slice(0, 200);
                    await page.waitForTimeout(5000);
                    await ask(page, st, 'monitoring_stop_log', { confirmed: true });
                    await page.waitForTimeout(1500);
                    st.second = await ask(page, st, 'monitoring_run_overview', { channels: ['3:ub', PHYD] });
                    return st.second.run === 2 ? true : JSON.stringify(st.second).slice(0, 200);
                },
            },
        },
        {
            check: {
                desc: '手順 1：AI の答えに、外れが 1 つ（SMG の油圧）と、その値が入る（言い方は声の稽古で確かめる）',
                run: async (_page, st) => {
                    const j = st.second?.judges ?? [];
                    const failed = j.filter((x) => x.pass === false).map((x) => x.id);
                    const unread = j.filter((x) => x.pass === null).map((x) => x.id);
                    const phyd = st.second?.stats?.[PHYD];
                    if (failed.length === 1 && failed[0] === 'J2') return true;
                    return `外れ：${failed.join(', ') || 'なし'}。判定できない：${unread.join(', ') || 'なし'}。SMG の油圧：${phyd ? `平均 ${phyd.mean}` : '読めていない（null）'}`;
                },
            },
        },
        {
            check: {
                desc: '手順 1：SMG の油圧の値がもっともらしい（0〜120 bar。外れを決める元の値）',
                run: async (_page, st) => {
                    const m = st.second?.stats?.[PHYD];
                    if (!m) return 'SMG の油圧が読めていない';
                    return m.min >= 0 && m.max <= 120 ? true : `SMG の油圧 平均 ${m.mean}、最小 ${m.min}、最大 ${m.max} bar（あり得ない値で J2 が合格になる）`;
                },
            },
        },
        {
            ai: 'monitoring_show',
            args: { replace: true, parts: [{ kind: 'judges' }] },
            means: 'AI が判定の一覧をボードに置く',
            expect: (r) => (r?.placed?.length === 1 ? true : JSON.stringify(r).slice(0, 200)),
        },
        { wait: 1200 },
        {
            check: {
                desc: '手順 1：画面に合格・外れが一覧で出る（判定ごとに、合格／外れ／判定できない、が読める）',
                run: async (page) => {
                    const t = await screenText(page);
                    const why = [];
                    if (!/J1/.test(t) || !/J2/.test(t)) why.push('判定 J1・J2 が並ばない');
                    if (!/PASS|合格/.test(t)) why.push('合格の印が無い');
                    if (!/FAIL|外れ/.test(t)) why.push('外れの印が無い');
                    return why.length ? why.join('、') : true;
                },
            },
        },
        { shot: 's01-judges' },
        // 2. 前回と比べて
        { say: '前回と比べて' },
        {
            check: {
                desc: '手順 2：AI の答えに、前回の日付と、変わった値（前回→今回）が入る（言い方は声の稽古で確かめる）',
                run: async (page, st) => {
                    const c = await ask(page, st, 'monitoring_compare', { record: st.record });
                    st.compare = c;
                    const why = [];
                    if (!(c.a?.startedAt > 0)) why.push('前回の日時が無い');
                    if (!(c.channels ?? []).some((x) => typeof x.delta === 'number')) why.push('値の変化が無い');
                    if (!(c.channels ?? []).some((x) => x.channel === PHYD)) why.push('SMG の油圧が比較に入らない');
                    return why.length ? why.join('、') : true;
                },
            },
        },
        {
            ai: 'monitoring_show',
            args: { parts: [{ kind: 'compare', title: '前回と今回' }] },
            means: 'AI が比較をボードに置く',
            expect: (r) => (r?.placed?.length === 1 ? true : JSON.stringify(r).slice(0, 200)),
        },
        { wait: 1200 },
        {
            check: {
                desc: '手順 2：画面に前回と今回が並び、変わった値に印、前回がいつかが分かる',
                run: async (page) => {
                    const t = await screenText(page);
                    const why = [];
                    if (!/RUN 1[^\n]*→[^\n]*RUN 2/.test(t)) why.push('前回と今回が並ばない');
                    if (!/→\s*[\d.]+\s*[+-][\d.]+/.test(t)) why.push('変わった値に印（差）が無い');
                    if (!/\d{1,2}[:/月]\d{1,2}/.test(t.slice(t.indexOf('前回と今回')))) why.push('前回の日付・時刻が比較に出ない');
                    return why.length ? why.join('、') : true;
                },
            },
        },
        { shot: 's02-compare' },
        noVin,
    ]),
};

export default scenario;
