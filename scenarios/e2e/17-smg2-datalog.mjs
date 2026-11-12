import { connectPractice, tool } from './_lib.mjs';

/**
 * DATALOG with SMG II (operator's ask, 2026-11-12: 「データログを取って」 for SMG II). Its values are
 * channels beside the DME's — smg2:JOB:RESULT — read once per sample by SMG II's own SGBD code,
 * parked unless the owner cleared that read for a moving car.
 */
const HYD = 'smg2:STATUS_IO_LESEN:STAT_HYDRAULIKTEMPERATUR_WERT';
const RPM = 'smg2:STATUS_IO_LESEN:STAT_MOTORDREHZAHL_WERT';

const stat = (r, c) => (r?.stats ?? []).find((x) => x.channel === c);

const scenario = {
    id: 'S17',
    title: 'DATALOG と SMG II：油圧ユニット温度を探して選ぶ → 走行中は空 → 止まると値と単位が入る → 画面にも出る',
    story:
        'オーナーが「SMG の油温もログに入れて」と頼む。AI は DATALOG のチャンネルを探し、SMG II の油圧ユニット温度とエンジン回転数を、' +
        'DME のエンジン回転数と一緒に選ぶ。40 km/h で走っている間に記録を始めると、DME の値は入り、SMG II の値は空のまま。止まると SMG II の値が入り、' +
        '要約に名前と単位が付く。画面の DATALOG にも SMG II の欄と値が出る。',
    car: { dmeFaults: [], speedKmh: 40 },
    steps: [
        { say: 'SMG の油温もログに入れて' },
        ...connectPractice,
        {
            ai: 'monitoring_log_channels',
            args: { query: 'smg2 hydraulik' },
            means: 'SMG II の油圧ユニット温度が見つかる',
            expect: (r) => ((r?.found ?? []).some((c) => c.channel === HYD) ? true : JSON.stringify(r).slice(0, 400)),
        },
        {
            ai: 'monitoring_log_channels',
            args: { channels: ['3:n', HYD, RPM] },
            means: 'DME の回転数と、SMG II の 2 つを選ぶ（SMG II は 1 サンプルに 1 回の読み取り）',
            expect: (r) => (r && r.changed && (r.otherModules?.channels ?? []).length === 2 && r.cost?.blocks === 1 ? true : JSON.stringify(r).slice(0, 400)),
        },
        { ai: 'monitoring_start_log', means: '記録を始める', expect: (r) => (r && r.started ? true : JSON.stringify(r).slice(0, 300)) },
        { wait: 3000 },
        {
            check: {
                desc: '走行中：DME の回転数は入り、SMG II の値は空（停車中だけ）',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_datalog', { max: 5 });
                    return r.running && stat(r, '3:n')?.n > 0 && stat(r, HYD)?.n === 0 ? true : JSON.stringify(r).slice(0, 500);
                },
            },
        },
        { car: { speedKmh: 0 }, means: '車が止まる' },
        {
            check: {
                desc: '止まると SMG II の値が入り、要約に名前と単位（Grad C、1/min）が付く',
                run: async (page) => {
                    for (let i = 0; i < 30; i++) {
                        const r = await tool(page, 'monitoring_datalog', { max: 5, seconds: 3 });
                        const h = stat(r, HYD);
                        const n = stat(r, RPM);
                        if (h?.n > 0 && n?.n > 0 && h.unit && n.unit === '1/min' && h.name) return true;
                        await page.waitForTimeout(500);
                    }
                    return JSON.stringify(await tool(page, 'monitoring_datalog', { max: 2 })).slice(0, 600);
                },
            },
        },
        { ui: 'tab', name: 'DATALOG', means: 'オーナーが DATALOG を開く' },
        { screen: { desc: 'DATALOG に SMG II の欄と、選んだ SMG II の値', has: ['SMG II の値', 'STAT_HYDRAULIKTEMPERATUR_WERT', '1/min'] } },
        { shot: 'smg2-datalog' },
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '復唱のあと止める', expect: (r) => (r && r.stopped === 'recording' ? true : JSON.stringify(r)) },
        { wait: 1000 },
    ],
};

export default scenario;
