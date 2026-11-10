import { connectPractice, scanAndWait, tool } from './_lib.mjs';

/**
 * The VIN from the instrument cluster (operator, 2026-11-10: "the engine reads it from KOMBI by
 * itself"), in the scan of every module. The cluster's IDENT says KOMBI46R (D_0080), its fault read
 * goes, and then its own VIN read, once: AIF block 2, `80 05 02 02`. Its answer keeps the VIN's last
 * seven, two characters and five digits in BCD — so no mask that looks for ASCII would catch it, and
 * the scan keeps it apart from every answer the assistant reads (lib/probe/scan `vin`). The comms log
 * says it was read and that a real cluster has not confirmed the read yet; never what it said.
 * Putting it into the intake report is the next step. The VIN here is made up.
 */
const SHORT = 'XY98765';
const ANSWER = ['58 59 98 76 5', '5859987650', '58599876'];
const spells = (text) => [SHORT, ...ANSWER].filter((v) => text.toLowerCase().includes(v.toLowerCase()));

/** Every tool that reads, with arguments a driver's assistant would pass. */
const READS = [
    ['monitoring_status', {}],
    ['monitoring_faults', {}],
    ['monitoring_faults', { module: 'kombi46r' }],
    ['monitoring_sessions', { limit: 50 }],
    ['monitoring_ledger', {}],
    ['monitoring_catalog', { module: 'kombi46r', limit: 80 }],
    ['monitoring_datalog', {}],
    ['monitoring_run_overview', {}],
    ['monitoring_save', {}],
];

const scenario = {
    id: 'S17',
    title: 'メーター（KOMBI）の VIN：IDENT → 故障 → VIN の読取を一度 → 通信ログは「読んだ・実車未確認」だけ → AI には出ない',
    story:
        '店の人が全モジュールを読む。メーターは KOMBI46R と分かり、故障のあとに VIN の読取が一度だけ送られる。' +
        '通信ログは、VIN の下 7 桁を読んだこと、実車ではまだ確かめていないことを言い、VIN そのものは出さない。' +
        'AI の道具の返り値には、文字でもバイトでも現れない。',
    car: { clusterVin: SHORT, clusterVinReads: 0 },
    steps: [
        { say: '全部のモジュールを読んで' },
        ...connectPractice,
        ...scanAndWait,
        {
            ai: 'monitoring_status',
            means: 'メーターの IDENT が KOMBI46R を選んだ（D_0080）',
            expect: (r) => (r?.variants?.['0x80'] === 'KOMBI46R' ? true : JSON.stringify(r?.variants ?? r).slice(0, 300)),
        },
        {
            check: {
                desc: 'メーターに VIN の読取がちょうど一度届いた（模擬実車の側から数える）',
                run: async (page) => {
                    const n = await page.evaluate(() => window.__monitoringE2E.car.get().clusterVinReads);
                    return n === 1 ? true : `the cluster was asked ${n} time(s)`;
                },
            },
        },
        { ui: 'click', selector: 'button[title="COMMS LOG"]', settle: 500, means: '人が通信ログを開く' },
        {
            screen: {
                desc: '通信ログが、VIN の下 7 桁を読んだこと（実車未確認）を言う。VIN そのものは出さない',
                has: ['VIN (last seven) read by STATUS_AIF_FG_NR_LESEN — not confirmed on a car yet.'],
                hasNot: [SHORT, '58 59 98 76'],
            },
        },
        {
            check: {
                desc: 'VIN（下 7 桁の文字、メーターの答えのバイト）は、どの道具の返り値にも無い',
                run: async (page) => {
                    for (const [name, args] of READS) {
                        const r = await tool(page, name, args);
                        const found = spells(JSON.stringify(r));
                        if (found.length > 0) return `${name}(${JSON.stringify(args)}) returned ${found.join(', ')}`;
                    }
                    return true;
                },
            },
        },
    ],
};

export default scenario;
