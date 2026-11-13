/**
 * 事後保全 (operator, 2026-11-01): a warning light, the assistant reads every module, takes the
 * investigation, plans reads around the code, and PROBE catches the moment the car moves off.
 */
const WORDS = 'エンジンのランプが点いた。原因を調べて';

const scenario = {
    id: 'S02',
    title: 'AI 事後保全：ランプ → 全モジュール → 調査を任される → PROBE が走り出しを捉える',
    story:
        'ランプが点いたとオーナーが言う。AI は全モジュールの故障を読み、DME の 0x2A（車速入力）と DSC の故障を見つける。' +
        'オーナーの言葉のまま調査を任され、計画（故障の読み直し、車速の二系統、走り出しの捕捉）を書き、PROBE を始める。' +
        '車が 40 km/h で走り出すと PROBE がその瞬間を捉え、停車後に AI が結果を読む。',
    car: { moduleFaults: { 0x56: [0x01, 0x5d, 0x21, 0x00] } },
    steps: [
        { say: WORDS },
        {
            check: {
                desc: 'AI が読む手順書（reactive）が配られている',
                run: async (page) => {
                    const text = await page.evaluate(() => fetch('/guide/reactive.md').then((r) => r.text()));
                    return text.includes('事後保全') ? true : 'reactive.md に「事後保全」が無い';
                },
            },
        },
        { ui: 'practice' },
        { ui: 'click', text: 'CONNECT', settle: 2000, means: '走る前に人がつなぐ' },
        { ai: 'monitoring_status', means: 'つながっていて、止まっている', expect: (r) => (JSON.stringify(r).includes('connected') ? true : 'connected と言わない') },
        {
            ai: 'monitoring_scan',
            means: '全モジュールの故障を順に読み始める（停車中だけ）。答えは「始めた」と、かかる時間',
            expect: (r) => (r && r.started && r.addresses > 10 ? true : JSON.stringify(r)),
        },
        {
            check: {
                desc: '読み終わるまで待つ（monitoring_status の scan）',
                run: async (page, st) => {
                    for (let i = 0; i < 120; i++) {
                        const s = await page.evaluate(() => window.__monitoringE2E.tool('monitoring_status', {}));
                        if (s.scan && s.scan.running === false) {
                            st.scanCounts = s.scan.counts;
                            return s.scan.end === 'done' ? true : `scan ended: ${s.scan.end}`;
                        }
                        await page.waitForTimeout(1000);
                    }
                    return 'scan did not end in 2 minutes';
                },
            },
        },
        {
            check: {
                desc: '答えたモジュールが模擬実車の数だけある（DME＋16）',
                run: async (_page, st) => (st.scanCounts && st.scanCounts.answered >= 10 ? true : JSON.stringify(st.scanCounts)),
            },
        },
        {
            ai: 'monitoring_faults',
            means: 'モジュールを指定せず、全部の答え：DME は 0x2A と 0xD1、DSC はバイトのまま',
            expect: (r) => {
                const s = JSON.stringify(r);
                if (!/0x2A/i.test(s)) return 'DME の 0x2A が無い';
                if (!/dsc|0x56/i.test(s)) return 'DSC の答えが無い';
                return true;
            },
            keep: (r, st) => (st.allFaults = r),
        },
        {
            check: {
                desc: 'メーター（0x80）は自身の SGBD の故障読取のコードで最後まで読まれ、故障なし',
                run: async (_page, st) => {
                    const s = JSON.stringify(st.allFaults);
                    return /"sgbdRead":\{"sgbd":"kombi46r?","complete":true,"faults":\[\]/.test(s) ? true : s.slice(0, 600);
                },
            },
        },
        { screen: { desc: 'DIAGNOSIS に全モジュールの一覧', has: ['全モジュール', '故障 2', '故障なし'] } },
        { shot: 'scan' },
        {
            ai: 'monitoring_faults',
            args: { module: 'mss54' },
            means: 'DME の故障を説明つきで',
            expect: (r) => (JSON.stringify(r).includes('2A') ? true : '0x2A が無い'),
        },
        {
            ai: 'monitoring_investigate',
            args: { words: WORDS, modules: ['mss54'], days: 7, mode: 'reactive', focus: ['mss54:0x2A'] },
            means: '任された調査の記録が始まる',
            expect: (r) => (r && r.record && r.mandate ? true : `record/mandate が無い: ${JSON.stringify(r)}`),
            keep: (r, st) => Object.assign(st, { record: r.record, mandate: r.mandate }),
        },
        {
            check: {
                desc: 'AI が計画を書く（読むだけ、委任の範囲）',
                run: async (page, st) => {
                    const r = await page.evaluate(
                        (a) =>
                            window.__monitoringE2E.tool('monitoring_plan', {
                                record: a.record,
                                mandate: a.mandate,
                                purpose: '車速入力の故障 0x2A を、走り出しで確かめる',
                                hypotheses: [{ id: 'H1', text: '車速の直接入力が途切れている', refutedBy: '走行中、19:v が 19:v_asc と同じく動く' }],
                                criteria: '走行中に直接入力の車速が出ていること',
                                judge: [{ id: 'J1', hypothesis: 'H1', channel: '19:v', stat: 'max', op: '>', value: 0, provenance: 'authored', note: '動いている間に直接入力が 0 のままなら H1' }],
                                steps: [
                                    { n: 1, do: 'DME の故障を読み直す', kind: 'faults', module: 'mss54', when: 'parked' },
                                    { n: 2, do: '車速を直接と CAN の二系統で記録', kind: 'sample', channels: ['19:v', '19:v_asc'] },
                                    { n: 3, do: '走り出しを捉える', kind: 'capture', condition: [{ channel: '19:v', op: '>', value: 20 }], preS: 2, postS: 3 },
                                ],
                            }),
                        st,
                    ).catch((e) => ({ error: String(e.message ?? e) }));
                    st.plan = r;
                    return r && !r.error ? true : JSON.stringify(r).slice(0, 300);
                },
            },
        },
        {
            check: {
                desc: 'AI が PROBE を始める',
                run: async (page, st) => {
                    const r = await page.evaluate((rec) => window.__monitoringE2E.tool('monitoring_probe', { record: rec }), st.record).catch((e) => ({ error: String(e.message ?? e) }));
                    st.probe = r;
                    return r && r.started ? true : JSON.stringify(r).slice(0, 300);
                },
            },
        },
        { wait: 3000 },
        { screen: { desc: 'ハブが STOP、通知行に PROBE の進み', has: ['PROBE v1', 'STOP'] } },
        { shot: 'probe-parked' },
        { car: { speedKmh: 40 }, means: '走り出す（40 km/h）' },
        { wait: 6000 },
        { car: { speedKmh: 0 }, means: '止まる' },
        { wait: 3000 },
        {
            ai: 'monitoring_run_overview',
            means: '走行中に聞くと、走っている PROBE の量（秒、サンプル）',
            expect: (r) => (r && r.running === true && r.samples > 0 ? true : JSON.stringify(r).slice(0, 200)),
        },
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '「止めますか？」に「はい」のあと、PROBE を止める', expect: (r) => (JSON.stringify(r).includes('probe') ? true : 'PROBE を止めたと言わない') },
        { wait: 1500 },
        {
            ai: 'monitoring_run_overview',
            means: '止めたあと：走り出しの捕捉が 1 回以上、判定 J1 は合格（直接入力の車速が出ていた）',
            expect: (r) => {
                if (!r || r.running !== false) return JSON.stringify(r).slice(0, 200);
                if (!(r.captures >= 1)) return `captures ${r.captures}`;
                const s = JSON.stringify(r);
                return /J1/.test(s) ? true : '判定 J1 が無い';
            },
            keep: (r, st) => (st.overview = r),
        },
        { shot: 'probe-after-drive' },
        { screen: { desc: 'ハブが戻る', hasNot: ['PROBE v1 ·'] } },
    ],
};

export default scenario;
