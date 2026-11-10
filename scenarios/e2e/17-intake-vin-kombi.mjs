import { readFileSync } from 'node:fs';
import { connectPractice, scanAndWait, tool } from './_lib.mjs';

/**
 * The intake report's VIN, read from the instrument cluster (operator, 2026-11-10: "MONITORING reads
 * it from KOMBI by itself"). The cluster's IDENT says KOMBI46R (D_0080), its fault read goes, and
 * then its own VIN read, once: AIF block 2, `80 05 02 02`. Its answer keeps the VIN's last seven,
 * two characters and five digits in BCD — so no mask that looks for ASCII would catch it, and it is
 * kept apart from every answer the assistant reads. The report carries those seven as `vinShort`
 * (the whole seventeen are not in the cluster: `vin` stays null), and the screen says where they
 * came from and that a real cluster has not confirmed the read yet. The VIN here is made up.
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
    title: '入庫点検の VIN：メーター（KOMBI）の IDENT → 故障 → VIN の読取を一度 → 報告の vinShort に下 7 桁 → 画面は「実車未確認」 → AI には出ない',
    story:
        '店の人が全モジュールを読み、SEND を一回押す。メーターは KOMBI46R と分かり、故障のあとに VIN の読取が一度だけ送られる。' +
        '保存された報告には、メーターが持つ VIN の下 7 桁が入り、17 桁は分からないので空のまま。通知行は、VIN を KOMBI から読んだこと、' +
        '実車ではまだ確かめていないことを言う。AI の道具の返り値には、文字でもバイトでも現れない。',
    car: { clusterVin: SHORT },
    steps: [
        { say: '入庫点検。全部読んで、VIN も入れて報告にして' },
        ...connectPractice,
        ...scanAndWait,
        {
            ai: 'monitoring_status',
            means: 'メーターの IDENT が KOMBI46R を選んだ（D_0080）',
            expect: (r) => (r?.variants?.['0x80'] === 'KOMBI46R' ? true : JSON.stringify(r?.variants ?? r).slice(0, 300)),
        },
        {
            check: {
                desc: '人が SEND を一回押す → MAINTENANCE が開いていないので JSON で保存。その報告の vinShort は KOMBI の下 7 桁、vin は空',
                run: async (page, st) => {
                    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.locator('button:visible:has-text("SEND")').last().click()]);
                    const path = await download.path();
                    const report = JSON.parse(readFileSync(path, 'utf8'));
                    st.report = report;
                    if (report.schema !== 'e46.intake-check.v1') return `schema: ${report.schema}`;
                    if (report.vinShort !== SHORT) return `vinShort: ${report.vinShort}`;
                    if (report.vin !== null) return 'vin should be null: the cluster keeps the last seven only';
                    if (report.practice !== true) return 'a practice report must say so';
                    const kombi = report.modules.find((m) => m.address === '0x80');
                    if (kombi?.sgbd !== 'KOMBI46R' || kombi?.basis !== 'identified') return JSON.stringify(kombi).slice(0, 300);
                    // The VIN read's answer is not among the module's fault bytes.
                    if (spells(JSON.stringify(kombi)).length > 0) return `the VIN read leaked into the module: ${JSON.stringify(kombi).slice(0, 300)}`;
                    return true;
                },
            },
        },
        {
            screen: {
                desc: '通知行が、保存したことと、VIN を KOMBI から読んだこと（実車未確認）を一度言う。VIN そのものは出さない',
                has: ['MAINTENANCE のタブが開いていないので、報告を JSON で保存しました。', 'VIN は KOMBI から下 7 桁を読みました（実車未確認）。', 'SAVED'],
                hasNot: [SHORT],
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
