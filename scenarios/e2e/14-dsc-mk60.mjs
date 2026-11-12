import { connectPractice, tool } from './_lib.mjs';

/**
 * DSC MK60 (operator, 2026-11-10: "read the DSC's faults first"). The car's DSC is a Conti/Teves MK60,
 * which speaks KWP2000-shaped frames on the DS2 line (wire 0xB8, target 0x29). It is read parked only
 * (in the all-module scan too: operator, 2026-11-12)
 * until a real one has answered, its codes are shown as an estimate with the bytes kept, and nothing
 * but its identity and fault read is ever sent to it.
 */
/** One all-module scan, waited for: the DSC MK60's row and the DME's, or what went wrong. */
async function scanned(page) {
    // The scan that was on the screen before this one is not this one's answer.
    const before = (await tool(page, 'monitoring_status')).scan?.at ?? null;
    const r = await tool(page, 'monitoring_scan');
    if (!r?.started) return JSON.stringify(r);
    let done = false;
    for (let i = 0; i < 240 && !done; i++) {
        await page.waitForTimeout(500);
        const s = await tool(page, 'monitoring_status');
        done = s.scan?.running === false && s.scan.at !== before;
    }
    if (!done) return 'scan did not end in 2 minutes';
    const f = await tool(page, 'monitoring_faults');
    const rows = (f?.faults ?? f)?.scan?.modules ?? [];
    const of = (id) => rows.find((x) => x.modules?.some((m) => m.id === id));
    return { mk60: of('dsc_mk60'), dme: of('mss54') };
}

const scenario = {
    id: 'S14',
    title: 'DSC MK60：停車中に故障を読む → 推定として表示 → 走行中は送らない → 全モジュール読み取りでも停車中だけ読む',
    story:
        'AI が画面のモジュールを DSC MK60 に切り替え、停車中に故障を読む。模擬車の MK60 は 0x5D90（左前の回転センサ）を一件持っていて、' +
        '画面と AI の答えに、SGBD の説明文と「推定」の注記が出る。走り出すと、読み直しは送られない（停車を測れない）。' +
        '全モジュールの読み取りは、走行中は MK60 だけ送らずに理由を出し、停車中は MK60 も読んで同じ推定の扱いで返す。',
    car: { dmeFaults: [] },
    steps: [
        { say: 'DSC の故障を読んで' },
        ...connectPractice,
        {
            ai: 'monitoring_module',
            args: { module: 'dsc_mk60' },
            means: '画面のモジュールを DSC MK60 に（同じ口でつなぎ直す）',
            expect: (r) => (JSON.stringify(r).includes('dsc_mk60') ? true : JSON.stringify(r)),
        },
        { wait: 2500 },
        { ai: 'monitoring_status', means: '画面のモジュールが DSC MK60', expect: (r) => (r?.module?.id === 'dsc_mk60' && r.link === 'connected' ? true : JSON.stringify(r).slice(0, 200)) },
        {
            ai: 'monitoring_faults',
            args: { module: 'dsc_mk60', refresh: true },
            means: '停車中に読む：KWP の形の電文 b8 29 f1 04 18 02 ff ff 7e',
            expect: (r) => {
                const f = r?.faults ?? r;
                const s = JSON.stringify(f);
                return f?.estimated === true && /0x5d90/.test(s) && /Drehzahlfuehler|wheel|speed sensor/i.test(s) && /b8 29 f1 04 18 02 ff ff 7e/.test(s) ? true : s.slice(0, 400);
            },
        },
        { screen: { desc: '画面：コード 0x5D90 と説明文、推定の注記、送った電文と答えのバイト', has: ['0x5D90', 'MK60 の実車ではまだ確かめていません', 'b8 29 f1 04 18 02 ff ff 7e'] } },
        { shot: 'faults' },
        { car: { speedKmh: 30 }, means: '走り出す' },
        {
            ai: 'monitoring_faults',
            args: { module: 'dsc_mk60', refresh: true },
            means: '走行中の読み直しは送られない（MK60 は停車中だけ）',
            expect: (r) => (/stationary|moving/.test(JSON.stringify(r)) ? true : JSON.stringify(r).slice(0, 300)),
        },
        {
            check: {
                desc: '走行中の全モジュールの読み取り：MK60 だけ送られず、理由（停車中だけ）が出る。ほかは読まれる',
                run: async (page) => {
                    const m = await scanned(page);
                    if (typeof m === 'string') return m;
                    return m.mk60?.outcome === 'refused' && /parked only/.test(m.mk60.reason ?? '') && !m.mk60.raw && m.dme?.outcome === 'answered' ? true : JSON.stringify(m).slice(0, 500);
                },
            },
        },
        { car: { speedKmh: 0 }, means: '止まる' },
        {
            check: {
                desc: '停車中の全モジュールの読み取り：MK60 も読まれ、コードは推定としてバイトと一緒に返る',
                run: async (page) => {
                    const m = await scanned(page);
                    if (typeof m === 'string') return m;
                    const s = JSON.stringify(m.mk60 ?? null);
                    return m.mk60?.outcome === 'answered' && m.mk60.estimated === true && /0x5d90/.test(s) && /b8 29 f1 04 18 02 ff ff 7e/.test(s) ? true : s.slice(0, 500);
                },
            },
        },
    ],
};

export default scenario;
