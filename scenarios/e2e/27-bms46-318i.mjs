import { connectPractice, scanAndWait, tool } from './_lib.mjs';

/**
 * PRACTICE playing a 318i with the M43 (GREN BLUE SUITE's test plan §7.2, item 1): the DME's IDENT
 * (`61`/`10`) chooses BMS46DS0 as D_0012 does, the BMS46's own fault read is sent, and its answer is read
 * where BMS46DS0's own FS_LESEN reads it (19-byte records; fault-layouts.json) — named from its own fault
 * text and said to be unconfirmed on a car. A clear on the practice car empties it, as on the MS43.
 */
const scenario = {
    id: 'S27',
    title: '318i（M43）：BMS46 を IDENT が選ぶ → その SGBD の読み方で故障を読む → 名前と実車未確認',
    story:
        '店の 318i（M43、BMS46）。AI が全モジュールを読むと、0x12 は BMS46DS0 と選ばれ、BMS46 自身の故障読取が送られる。' +
        'AI が画面を BMS46 に切り替えて読むと、0x64 が「現在あり」で 4 回、0x70 が 1 回、SGBD の故障文と実車未確認の注記つきで並ぶ。',
    car: {
        idents: { 18: { hw: '61', diag: '10' } },
        dmeFaults: [],
        nonM3DmeFaults: [
            { code: 0x64, present: true, count: 4 },
            { code: 0x70, present: false, count: 1 },
        ],
    },
    steps: [
        { say: 'この 318i の故障を全部見て' },
        ...connectPractice,
        ...scanAndWait,
        {
            check: {
                desc: '0x12 は BMS46DS0 と選ばれ、自身の故障読取に答え、コードに SGBD の故障文と「未検証」が付く',
                run: async (page) => {
                    const f = await tool(page, 'monitoring_faults');
                    const mods = f?.faults?.scan?.modules ?? f?.scan?.modules ?? [];
                    const dme = mods.find((m) => m.address === '0x12');
                    const ok =
                        dme?.outcome === 'answered' && dme?.variant?.sgbd === 'BMS46DS0' && dme?.variant?.carried === true && dme?.unverified === true &&
                        dme?.codes?.some((c) => c.code === '0x64' && c.count === 4 && c.present === true && typeof c.text === 'string' && c.text.length > 0) &&
                        dme?.codes?.some((c) => c.code === '0x70' && c.count === 1 && c.present === false);
                    return ok ? true : `0x12: ${JSON.stringify(dme).slice(0, 500)}`;
                },
            },
        },
        { screen: { desc: '全モジュール：0x12 に故障 2（実車未確認）', has: ['故障 2（実車未確認）'] } },
        { shot: 'bms46-scan' },
        {
            ai: 'monitoring_module',
            args: { module: 'bms46ds0' },
            means: '画面のモジュールを BMS46 に（同じ口でつなぎ直す）',
            expect: (r) => (JSON.stringify(r).includes('bms46ds0') ? true : JSON.stringify(r)),
        },
        { wait: 2500 },
        {
            ai: 'monitoring_faults',
            args: { module: 'bms46ds0', refresh: true },
            means: 'BMS46 自身の故障読取を送り直す（停車を待たない読取）',
            expect: (r) => {
                const f = r?.faults ?? r;
                return f?.unverified === true && f?.codes?.some((c) => c.code === '0x64' && c.present === true) ? true : JSON.stringify(f).slice(0, 400);
            },
        },
        { screen: { desc: '画面：コード 0x64、「現在あり」、実車未確認の注記', has: ['0x64', '現在あり', '実車ではまだ確かめていません'] } },
        { shot: 'bms46-faults' },
    ],
};

export default scenario;
