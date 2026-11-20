import { always, bodyText, tool } from './_owner.mjs';

/**
 * MM03（docs/VIRTUAL-CAR-TESTS.md M2）：エンジンが吹けない（7 モジュールを横断する調査）。
 * 1「高回転で吹けない。原因を調べて、任せる」→ AI が見るモジュール（エンジン・SMG・DSC・舵角・メーター・エアコン・ボディ）と理由を短く言う。
 * 2 走行と停車を 2 回 → 画面の PROBE が、いまどのモジュールを読んでいるかを名前で示す。2 回目は続きから。
 * 3「何が分かった？」→ モジュールごとに分かったことを言い、確かさ（確か・可能性・未確認）を分ける。
 */
const MODULES = ['mss54', 'smg2', 'dsc_e46', 'lws5', 'kombi46r', 'ihka46_2', 'zke5'];
const NAMES = { mss54: 'MSS54', smg2: 'SMG II', dsc_e46: 'DSC', lws5: '舵角', kombi46r: 'メーター', ihka46_2: 'エアコン', zke5: 'ボディ' };
const WORDS = '高回転で吹けない。原因を調べて、任せる';

/** Waits for the PROBE run to end by itself, or stops it after `ms`. */
const runFor = (ms) => ({
    check: {
        desc: `PROBE を回す（最長 ${ms / 1000} 秒）。その間、画面がいま読んでいるモジュールを名前で示す`,
        run: async (page, st) => {
            const seen = new Set();
            const t0 = Date.now();
            while (Date.now() - t0 < ms) {
                const s = await tool(page, 'monitoring_status');
                const text = await bodyText(page);
                for (const [id, name] of Object.entries(NAMES)) if (text.includes(`${name}`) && /読(取|んで)中|読んでいる|reading/i.test(text)) seen.add(id);
                if (!s?.probe?.running) break;
                await page.waitForTimeout(700);
            }
            st.seenReading = [...(st.seenReading ?? []), ...seen];
            if ((await tool(page, 'monitoring_status'))?.probe?.running) await tool(page, 'monitoring_stop_log', { confirmed: true });
            await page.waitForTimeout(1200);
            return seen.size > 0 ? true : '画面に「いま読んでいるモジュール」の名前が出ない';
        },
    },
});

const scenario = {
    id: 'MM03',
    title: 'エンジンが吹けない：7 モジュールを横断して調べる（PROBE を 2 回、続きから）',
    story:
        '高回転で吹けない。オーナーが声で「原因を調べて、任せる」と言う。AI はエンジン・SMG・DSC・舵角・メーター・エアコン・ボディを見ると言い、' +
        '調査を任されて計画を書き、PROBE を回す。走行と停車を 2 回くり返すと、画面がいまどのモジュールを読んでいるかを名前で示し、2 回目は続きから。' +
        '「何が分かった？」に、モジュールごとに分かったことを確かさで分けて言う。',
    car: { dmeFaults: [{ code: 0x2a, type: 0x08, frequency: 3 }], moduleFaults: { 0x32: [0x01, 0x05, 0x21, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00] } },
    steps: always([
        { ui: 'practice' },
        { ui: 'click', text: 'CONNECT', settle: 2500, means: '人が画面で PRACTICE につなぐ' },
        { say: WORDS },
        {
            ai: 'monitoring_investigate',
            args: { words: WORDS, modules: MODULES, days: 14, mode: 'symptom' },
            means: '7 つのモジュールを読む調査として任される',
            expect: (r) => (r?.record && r.modules?.length === 7 ? true : JSON.stringify(r)),
            keep: (r, st) => Object.assign(st, { record: r?.record, mandate: r?.mandate }),
        },
        {
            check: {
                desc: 'AI が計画を書く：7 つの故障読み取りと、エンジンの値（回転・アクセル・VANOS）',
                run: async (page, st) => {
                    const steps = [
                        ...MODULES.map((m, i) => ({ n: i + 1, do: `${NAMES[m]} の故障を読む`, kind: 'faults', module: m, when: 'any' })),
                        { n: 8, do: '回転・アクセル・VANOS', kind: 'sample', channels: ['3:n', '3:pwg1', '35:evan1_ist', '35:evan1_soll'] },
                    ];
                    const r = await tool(page, 'monitoring_plan', { record: st.record, mandate: st.mandate, purpose: '高回転で吹けない原因', steps });
                    return r?.v ? true : JSON.stringify(r).slice(0, 300);
                },
            },
        },
        { car: { speedKmh: 40 }, means: '走る（1 回目）' },
        { ai: 'monitoring_probe', means: 'PROBE を始める（1 回目）', expect: (r) => (r?.started ? true : JSON.stringify(r).slice(0, 200)) },
        runFor(20000),
        { shot: 's02-run1' },
        { car: { speedKmh: 0 }, means: '停車' },
        { car: { speedKmh: 40 }, means: '走る（2 回目）' },
        {
            ai: 'monitoring_probe',
            means: 'PROBE を始める（2 回目は同じ調査の続き：回の番号が 2）',
            expect: (r) => (r?.started && (r.run === 2 || r.n === 2 || /2/.test(String(r.run ?? r.n))) ? true : JSON.stringify(r).slice(0, 200)),
        },
        runFor(20000),
        { car: { speedKmh: 0 }, means: '停車' },
        { shot: 's02-run2' },
        { say: '何が分かった？' },
        {
            ai: 'monitoring_run_overview',
            means: 'AI が言える材料：段ごとの結果に、どのモジュールの段か（名前）と状態（読めた・待っている・断られた、と理由）がある',
            expect: (r) => {
                const steps = r?.steps ?? [];
                if (steps.length < 8) return `段が ${steps.length} 個`;
                if (steps.some((x) => !x.state)) return `状態の無い段がある: ${JSON.stringify(steps).slice(0, 200)}`;
                const named = steps.filter((x) => x.module || x.do || x.kind).length;
                return named >= 7 ? true : `段に番号と状態しか無く、どのモジュールかが分からない: ${JSON.stringify(steps).slice(0, 200)}`;
            },
        },
        {
            check: {
                desc: 'モジュールごとに分かったこと：エンジン（0x2A 車速の直接入力）と SMG の故障が、名前で読める',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_compare', {});
                    const faults = r?.faults ?? [];
                    const at = (m) => faults.find((f) => f.module === m);
                    const why = [];
                    if (!at('mss54')?.b) why.push('エンジンの故障の答えが無い');
                    if (!at('smg2')?.b) why.push('SMG の故障の答えが無い');
                    const s = JSON.stringify(faults);
                    if (!/speed|車速/i.test(s)) why.push(`故障が名前でなく生のバイト（例：${JSON.stringify(at('mss54') ?? null).slice(0, 120)}）`);
                    return why.length ? why.join('、') : true;
                },
            },
        },
        {
            check: {
                desc: '確かさを分けて残せる：AI の見立て（可能性）と事実（確か）を記録に書き、画面の CO-WORK に確かさが出る',
                run: async (page, st) => {
                    await tool(page, 'monitoring_finding', { record: st.record, kind: 'read', sure: 'mid', text: '車速の直接入力の故障（0x2A）が高回転の制御に関わる可能性' });
                    await tool(page, 'monitoring_finding', { record: st.record, kind: 'read', sure: 'low', text: 'エアコン・ボディは関係が未確認' });
                    await tool(page, 'monitoring_show', { record: st.record, parts: [{ kind: 'plan' }], replace: true });
                    await page.waitForTimeout(1000);
                    const text = await bodyText(page);
                    return /可能性|未確認|確か/.test(text) ? true : '画面に確かさ（確か・可能性・未確認）が出ない';
                },
            },
        },
        { shot: 's03-found' },
        {
            check: {
                desc: 'U8：AI の答えにも画面にも VIN が出ない',
                run: async (page) => {
                    const s = JSON.stringify(await tool(page, 'monitoring_run_overview')) + JSON.stringify(await tool(page, 'monitoring_cowork', {})) + (await bodyText(page));
                    return s.includes('JR12345') ? 'VIN が出ている' : true;
                },
            },
        },
    ]),
};

export default scenario;
