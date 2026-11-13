import { connectPractice, scanAndWait, tool } from './_lib.mjs';

/**
 * A DS2 E46 that is not an M3 (Phase 4-1, 2026-11-10; the MS43 and GS20 carried since 2026-11-11). On
 * this car 0x12 is an MS43 and 0x32 a GS20 automatic. Each address is asked its IDENT first, and its
 * group file's rule says which SGBD answered: nothing built for the MSS54 or the SMG II goes to them,
 * only their own SGBDs' fault reads, and every address the rules cannot name stays `?` with its IDENT only.
 */
const scenario = {
    id: 'S19',
    title: 'M3 でない E46：IDENT で MS43 と GS20 と分かる → M3 の電文は送らない → ほかは「?」で IDENT だけ',
    story:
        '店の E46（MS43、GS20 の AT）に、人が画面でつなぐ。AI が全モジュールを読むと、0x12 は MS430DS0、0x32 は GS20 と出て、' +
        'それぞれ自身の SGBD の故障読取だけが送られる（MSS54 として解かない）。規則で名前の付かないアドレスは「?」で、IDENT のほかは送られない。' +
        'AI がエンジン（MSS54）の故障を読もうとしても、送られずに理由が返る。',
    car: { idents: { 18: { hw: '19', diag: '10' }, 50: { hw: '29', diag: '00' } }, dmeFaults: [], ms43Faults: [] },
    steps: [
        { say: 'この車、全部のモジュールを見て' },
        ...connectPractice,
        ...scanAndWait,
        {
            ai: 'monitoring_status',
            means: 'IDENT が選んだ変種：0x12 は MS430DS0、0x32 は GS20',
            expect: (r) => (r?.variants?.['0x12'] === 'MS430DS0' && r?.variants?.['0x32'] === 'GS20' ? true : JSON.stringify(r?.variants ?? r).slice(0, 300)),
        },
        {
            check: {
                desc: '故障読取まで行くのは、IDENT が選んだ SGBD をこのアプリが載せているアドレスだけ。0x12 を MSS54 として解かない',
                run: async (page) => {
                    const f = await tool(page, 'monitoring_faults');
                    const mods = f?.faults?.scan?.modules ?? f?.scan?.modules ?? [];
                    if (mods.length === 0) return JSON.stringify(f).slice(0, 400);
                    const beyond = mods.filter((m) => m.outcome === 'answered' && m.variant && m.variant.carried !== true);
                    if (beyond.length) return `read beyond IDENT where nothing is carried: ${JSON.stringify(beyond).slice(0, 300)}`;
                    const dme = mods.find((m) => m.address === '0x12');
                    const gs = mods.find((m) => m.address === '0x32');
                    if (dme?.faults) return `0x12 read as an MSS54: ${JSON.stringify(dme).slice(0, 300)}`;
                    return dme?.outcome === 'answered' && dme?.variant?.sgbd === 'MS430DS0' && dme?.variant?.carried === true && gs?.variant?.sgbd === 'GS20' && gs?.variant?.carried === true
                        ? true
                        : JSON.stringify({ dme, gs }).slice(0, 400);
                },
            },
        },
        {
            ai: 'monitoring_faults',
            args: { module: 'mss54', refresh: true },
            means: 'エンジンの故障を MSS54 の電文で読もうとしても、送られない（理由つき）',
            expect: (r) => (/MS430DS0/.test(JSON.stringify(r)) && !/"refreshed":true/.test(JSON.stringify(r)) ? true : JSON.stringify(r).slice(0, 300)),
        },
    ],
};

export default scenario;
