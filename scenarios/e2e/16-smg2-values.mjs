import { connectPractice, plan, startProbe, tool } from './_lib.mjs';

/**
 * SMG II's values (operator's ask, 2026-11-12: 「SMG2 の状態、健全度を診断して」「データログを取って」).
 * The first PROBE run on SMG II sat at 0/3 for two minutes with nothing to say why: its reads go
 * only with the car measured stationary, and the car was moving. Now each held step says why, a
 * fault read behind it still goes, and when the car stops the reads go and come back as values —
 * read by SMG II's own SGBD code (lib/sgbd), named, with units.
 */
const WORDS = 'SMG2 の状態、健全度を診断して。データログも取って';

const overview = (page) => tool(page, 'monitoring_run_overview');

const scenario = {
    id: 'S16',
    title: 'SMG II の値：走行中は読み取りが「停車中だけ」と待つ → 故障読取は先に行く → 止まると値と単位で返る → 学習値も',
    story:
        '40 km/h で走りながら、SMG II の入出力の値・故障メモリ・油温の記録・学習値の計画を回す。走っている間、入出力の読み取りと学習値は' +
        '「停車中だけ」と理由を付けて待ち、故障読取はその後ろからでも先に行く。油温のチャンネルは空のまま。止まると、入出力の読み取りが行き、' +
        'エンジン回転数などが名前と単位つきで返り、油温が記録され、学習値（クラッチ・変速機・変速機データ）が読まれる。',
    car: { dmeFaults: [], speedKmh: 40 },
    steps: [
        { say: WORDS },
        ...connectPractice,
        {
            ai: 'monitoring_investigate',
            args: { words: WORDS, modules: ['smg2'], days: 7, mode: 'predictive' },
            means: 'SMG II の予兆保全として任される',
            expect: (r) => (r && r.record && r.mandate ? true : JSON.stringify(r)),
            keep: (r, st) => Object.assign(st, { record: r.record, mandate: r.mandate }),
        },
        plan({
            purpose: 'SMG II の健全度の最初の定点',
            steps: [
                { n: 1, do: 'SMG II の入出力の値', kind: 'read', module: 'smg2', job: 'STATUS_IO_LESEN', when: 'any' },
                { n: 2, do: 'SMG II の故障メモリ', kind: 'faults', module: 'smg2', when: 'any' },
                { n: 3, do: '油圧ユニットの温度を記録', kind: 'sample', channels: ['smg2:STATUS_IO_LESEN:STAT_HYDRAULIKTEMPERATUR_WERT'] },
                { n: 4, do: 'SMG II の学習値', kind: 'adapt', module: 'smg2', when: 'any' },
            ],
        }),
        startProbe,
        { wait: 3000 },
        {
            check: {
                desc: '走行中：入出力と学習値は「停車中だけ」と待ち、故障読取は済み、油温は空',
                run: async (page) => {
                    const o = await overview(page);
                    const [read, faults, , adapt] = o.steps ?? [];
                    const ok =
                        o.running &&
                        read?.state === 'pending' && /parked only/.test(read.waiting ?? '') &&
                        faults?.state === 'done' &&
                        adapt?.state === 'pending' && /parked only/.test(adapt.waiting ?? '');
                    return ok ? true : JSON.stringify(o).slice(0, 600);
                },
            },
        },
        { car: { speedKmh: 0 }, means: '車が止まる' },
        {
            check: {
                desc: '止まると：入出力が読まれ、エンジン回転数が 1/min つきで返る。学習値も読まれる',
                run: async (page) => {
                    for (let i = 0; i < 40; i++) {
                        const o = await overview(page);
                        const [read, , , adapt] = o.steps ?? [];
                        const x = (o.recent ?? []).find((e) => e.what === 'STATUS_IO_LESEN' && e.outcome === 'ok' && e.values);
                        const rpm = x?.values.find((v) => v.name === 'STAT_MOTORDREHZAHL_WERT');
                        if (read?.state === 'done' && adapt?.state === 'done' && rpm?.unit === '1/min') return true;
                        await page.waitForTimeout(500);
                    }
                    return JSON.stringify(await overview(page)).slice(0, 800);
                },
            },
        },
        {
            check: {
                desc: '止まってからのサンプルに油温が入っている（PRACTICE の答えは 0 の並び：その値の目盛りの 0）',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_moment', { seconds_ago: 0, window_s: 6 });
                    const vals = (r.samples ?? []).map((s) => s.values?.['smg2:STATUS_IO_LESEN:STAT_HYDRAULIKTEMPERATUR_WERT']);
                    return vals.some((v) => typeof v === 'number') ? true : JSON.stringify(r).slice(0, 500);
                },
            },
        },
        { shot: 'smg2-values' },
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '止める（復唱のあと）', expect: (r) => (JSON.stringify(r).includes('probe') ? true : JSON.stringify(r)) },
        { wait: 1500 },
    ],
};

export default scenario;
