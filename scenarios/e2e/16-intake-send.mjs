import { connectPractice, scanAndWait, tool } from './_lib.mjs';

/**
 * The intake check (operator, 2026-11-10, D5 and D6): a scan of every module, then SEND, one press.
 * Here no MAINTENANCE tab opened MONITORING, so the report is saved as JSON and the notice line says
 * so once. The practice car's instrument cluster spells a VIN in its answer, and the report may use
 * it to match the car — but no tool the assistant has returns it, in words or in bytes.
 */
const VIN = 'WBSBL93060JR12345';
const SHORT = 'JR12345';
const asciiHex = (s) => Array.from(s, (c) => c.charCodeAt(0).toString(16).padStart(2, '0'));
const spells = (text) => [VIN, SHORT, asciiHex(VIN).join(' '), asciiHex(VIN).join(''), asciiHex(SHORT).join(' '), asciiHex(SHORT).join('')].filter((v) => text.toLowerCase().includes(v.toLowerCase()));

/** Every tool that reads, with arguments a driver's assistant would pass. */
const READS = [
    ['monitoring_status', {}],
    ['monitoring_faults', {}],
    ['monitoring_faults', { module: 'kombi46' }],
    ['monitoring_sessions', { limit: 50 }],
    ['monitoring_ledger', {}],
    ['monitoring_catalog', { module: 'kombi46', limit: 50 }],
    ['monitoring_datalog', {}],
    ['monitoring_log_channels', { query: 'speed' }],
    ['monitoring_run_overview', {}],
    ['monitoring_guide', {}],
    ['monitoring_save', {}],
    ['monitoring_sessions', { limit: 50 }],
];

const scenario = {
    id: 'S16',
    title: '入庫点検：全モジュールを読む → SEND 一回 → MAINTENANCE が開いていなければ JSON で保存 → VIN はどの道具にも出ない',
    story:
        '店の人が車のそばで全モジュールを読み、SEND を一回押す。この画面を開いた MAINTENANCE のタブは無いので、報告は JSON で保存され、' +
        '通知行がそう一度だけ言う。メーターの答えには VIN が書かれているが、AI の道具の返り値には、文字でもバイトでも現れない。',
    car: { moduleFaults: { 128: [0x01, ...Array.from(VIN, (c) => c.charCodeAt(0)), 0x00] } },
    steps: [
        { say: '入庫点検。全部のモジュールを読んで、MAINTENANCE に送って' },
        ...connectPractice,
        ...scanAndWait,
        { screen: { desc: '読み終わると SEND が出る', has: ['SEND'] } },
        { ui: 'click', text: 'Send', settle: 1500, means: '人が SEND を一回押す' },
        {
            screen: {
                desc: 'MAINTENANCE が開いていないので JSON で保存し、そう一度だけ言う。ボタンは SAVED',
                has: ['MAINTENANCE のタブが開いていないので、報告を JSON で保存しました。', 'SAVED'],
            },
        },
        {
            ai: 'monitoring_status',
            means: 'AI には送ったかどうかだけ（報告そのものは無い）',
            expect: (r) => (r?.intakeReport?.phase === 'saved' && !('report' in (r?.intakeReport ?? {})) ? true : JSON.stringify(r?.intakeReport ?? r).slice(0, 300)),
        },
        {
            check: {
                desc: 'VIN（全体・下 7 桁、文字・バイト）は、どの道具の返り値にも無い',
                run: async (page) => {
                    for (const [name, args] of READS) {
                        const r = await tool(page, name, args);
                        const text = JSON.stringify(r);
                        const found = spells(text);
                        if (found.length > 0) return `${name}(${JSON.stringify(args)}) returned ${found.join(', ')}`;
                    }
                    return true;
                },
            },
        },
        {
            check: {
                desc: 'それでも KOMBI の答えは読めている（伏せた形で、長さは同じ）',
                run: async (page) => {
                    const f = await tool(page, 'monitoring_faults');
                    const kombi = (f?.scan?.modules ?? f?.faults?.scan?.modules ?? []).find((m) => m.address === '0x80');
                    const raw = kombi?.raw?.[0]?.response ?? '';
                    return raw.split(' ').length === VIN.length + 2 && raw.includes('2a 2a 2a') ? true : JSON.stringify(kombi).slice(0, 300);
                },
            },
        },
    ],
};

export default scenario;
