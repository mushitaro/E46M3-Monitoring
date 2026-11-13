import { connectPractice, scanAndWait, tool } from './_lib.mjs';

/**
 * A DS2 E46 that is not an M3, its faults named (plan Phase 4-3/4, 2026-11-11). The engine carries the
 * MS43 and the GS20 now: once each address's IDENT has chosen them, each is sent its own SGBD's fault
 * read, and the answer is read where that SGBD's own FS_LESEN reads it (fault-layouts.json, checked
 * against EDIABAS in simulation) — named from its own fault text, and said to be unconfirmed on a car.
 * The speed on such a car is not read from anything trusted yet, so a parked-only read is not sent.
 */
const GS20_RECORD = [0x01, 0x80, 0x02, ...new Array(16).fill(0)];
const scenario = {
    id: 'S21',
    title: 'M3 でない E46：MS43 と GS20 の故障を、その SGBD の読み方で読む → 名前が付く → 実車未確認と言う',
    story:
        '店の E46（MS43、GS20 の AT）。AI が全モジュールを読むと、0x12 は MS430DS0、0x32 は GS20 と選ばれ、それぞれ自身の故障読取が送られる。' +
        'AI が画面を MS43 に切り替えて読むと、0x01 が「現在あり」で 3 回、SGBD の故障文と実車未確認の注記つきで並ぶ。' +
        '全モジュールを読むと、MS43 と GS20（0x01 を 2 回）がそれぞれ自身の読取で読まれ、一覧に「故障 1（実車未確認）」と出る。' +
        '停車を測れないので、停車が要る読取は送られない。',
    car: {
        idents: { 18: { hw: '19', diag: '10' }, 50: { hw: '29', diag: '00' } },
        dmeFaults: [],
        ms43Faults: [{ code: 0x01, present: true, count: 3 }],
        moduleFaults: { 50: [0x01, ...GS20_RECORD] },
    },
    steps: [
        { say: 'この車の故障を全部見て' },
        ...connectPractice,
        {
            ai: 'monitoring_module',
            args: { module: 'ms430ds0' },
            means: '画面のモジュールを MS43 に（同じ口でつなぎ直す）',
            expect: (r) => (JSON.stringify(r).includes('ms430ds0') ? true : JSON.stringify(r)),
        },
        { wait: 2500 },
        {
            ai: 'monitoring_faults',
            args: { module: 'ms430ds0', refresh: true },
            means: 'MS43 自身の故障読取を送り直す（停車を待たない読取）',
            expect: (r) => {
                const f = r?.faults ?? r;
                return f?.unverified === true && f?.codes?.some((c) => c.code === '0x01' && c.present === true) ? true : JSON.stringify(f).slice(0, 400);
            },
        },
        { screen: { desc: '画面：コード 0x01、「現在あり」、実車未確認の注記', has: ['0x01', '現在あり', '実車ではまだ確かめていません'] } },
        { shot: 'non-m3-faults' },
        ...scanAndWait,
        {
            check: {
                desc: '0x12（MS43）と 0x32（GS20）は自身の故障読取に答え、コードに SGBD の故障文と「未検証」が付く',
                run: async (page) => {
                    const f = await tool(page, 'monitoring_faults');
                    const mods = f?.faults?.scan?.modules ?? f?.scan?.modules ?? [];
                    const at = (a) => mods.find((m) => m.address === a);
                    const dme = at('0x12');
                    const gs = at('0x32');
                    const ok = (m, sgbd, code, count) =>
                        m?.outcome === 'answered' && m?.variant?.sgbd === sgbd && m?.variant?.carried === true && m?.unverified === true &&
                        m?.codes?.some((c) => c.code === code && c.count === count && typeof c.text === 'string' && c.text.length > 0) && !m?.faults;
                    if (!ok(dme, 'MS430DS0', '0x01', 3)) return `0x12: ${JSON.stringify(dme).slice(0, 400)}`;
                    if (dme.codes[0].present !== true) return `0x12 present: ${JSON.stringify(dme.codes)}`;
                    if (!ok(gs, 'GS20', '0x01', 2)) return `0x32: ${JSON.stringify(gs).slice(0, 400)}`;
                    return true;
                },
            },
        },
        { screen: { desc: '全モジュール：0x12 と 0x32 に故障 1（実車未確認）', has: ['故障 1（実車未確認）'] } },
        { shot: 'non-m3-scan' },
        {
            ai: 'monitoring_status',
            means: '停車を測れない（M3 でない車の速度源は閉じたまま）',
            expect: (r) => (r?.car !== 'parked' ? true : JSON.stringify(r).slice(0, 200)),
        },
    ],
};

export default scenario;
