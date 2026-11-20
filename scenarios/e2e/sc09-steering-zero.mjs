import { always, bodyText, confirmRun, tool, until } from './_owner.mjs';

/**
 * SC09（docs/VIRTUAL-CAR-TESTS.md M1）：調整（画面）— 舵角のゼロ点。
 * ADAPTATION で舵角のゼロ点を選ぶと前提（ハンドルをまっすぐ・停車）が出て、実行すると「完了」、続けて舵角を読み 0° 付近を表示する。
 * 後期 M3 の練習の車では、舵角のゼロ点は DSC（0x56、DSC_E46）の ABGLEICH_LWS_AQ_SENSOREN（舵角センサに直接アクセスしゼロ点較正）。
 */
const JOB = 'ABGLEICH_LWS_AQ_SENSOREN';
const NAME = '舵角センサ(LWS)に直接アクセスしゼロ点較正を実行';

const scenario = {
    id: 'SC09',
    title: '調整（画面）：舵角のゼロ点 → 前提 → 実行 → 完了と 0° 付近',
    story:
        '停車中、オーナーが PC で DSC を選んでつなぎ、ADAPTATION で舵角のゼロ点を選ぶ。前提（ハンドルをまっすぐ・停車）が出る。' +
        '実行すると「完了」と出て、続けて舵角の値を読み、0° 付近になったことを表示する。',
    car: { speedKmh: 0 },
    steps: always([
        { ui: 'module', value: 'dsc_e46', means: 'DSC を選ぶ（舵角のゼロ点は DSC が持つ）' },
        { ui: 'practice' },
        { ui: 'click', text: 'CONNECT', settle: 2500, means: '人が画面で PRACTICE につなぐ（停車中）' },
        { ui: 'tab', name: 'ADAPTATION', means: 'ADAPTATION を開く' },
        { shot: 's01-adaptation' },
        {
            check: {
                desc: 'ADAPTATION に舵角のゼロ点が出て、選べる',
                run: async (page) => {
                    const text = await bodyText(page);
                    if (!/舵角/.test(text)) return `ADAPTATION に舵角のゼロ点が無い: ${text.slice(text.indexOf('適応値'), text.indexOf('適応値') + 160).replace(/\n/g, ' ')}`;
                    const row = page.locator(`text=${NAME}`).first();
                    if ((await row.count()) === 0) return '舵角の行が押せない';
                    await row.click();
                    await page.waitForTimeout(600);
                    return true;
                },
            },
        },
        {
            check: {
                desc: '（ADAPTATION に無いときは、AI が SERVICE に置く口で同じジョブを出す）',
                run: async (page) => {
                    const text = await bodyText(page);
                    if (/ハンドル|まっすぐ/.test(text)) return true;
                    const r = await tool(page, 'monitoring_stage', { module: 'dsc_e46', job: JOB });
                    return r?.staged ? true : JSON.stringify(r).slice(0, 200);
                },
            },
        },
        { screen: { desc: '前提（ハンドルをまっすぐ・停車）が出る', has: ['まっすぐ', '停車'] } },
        { shot: 's01-preconditions' },
        {
            check: {
                desc: '実行できる：実行のボタンが押せる。押せないなら、理由とどうすれば動くかが日本語で出る（U2）',
                run: async (page) => {
                    const start = page.locator('button.rounded-full:not([disabled])').filter({ hasText: /^(Start|Run|実行)$/ }).first();
                    const can = await until(page, async () => (await start.count()) > 0, 3000, 250);
                    if (can) return true;
                    const text = await bodyText(page);
                    // The DSC's zero point also writes the sensor's calibration (ABGLEICH_SCHREIBEN at 0x57), and
                    // writes are off in the owner's table: the screen says so and where it can be done instead.
                    if (/書き込み|書込/.test(text) && /ディーラー|INPA/.test(text)) return true;
                    const reason = /送りません|確定していません/.test(text) ? text.match(/[^\n]*(送りません|確定していません)[^\n]*/)?.[0] : null;
                    return `実行できない。画面の理由：「${reason ?? 'なし'}」（どうすれば動くかは言っていない）`;
                },
            },
        },
        {
            check: {
                desc: '実行 → 「完了」と出る',
                run: async (page) => {
                    const start = page.locator('button.rounded-full:not([disabled])').filter({ hasText: /^(Start|Run|実行)$/ }).first();
                    if ((await start.count()) === 0) return /書き込み|書込/.test(await bodyText(page)) ? true : '実行のボタンが無いので実行できない';
                    await start.click();
                    if (!(await confirmRun(page))) return '確認が出ない';
                    const done = await until(page, async () => /完了/.test(await bodyText(page)), 8000, 300);
                    const s = await tool(page, 'monitoring_status');
                    return done && !s.error ? true : `完了が出ない（${s.error ?? ''}）`;
                },
            },
        },
        {
            check: {
                desc: '続けて舵角の値を読み、0° 付近（±2°）を単位つきで表示する',
                run: async (page) => {
                    const text = await bodyText(page);
                    if (/書き込み|書込/.test(text) && /ディーラー|INPA/.test(text)) return true;
                    const m = /舵角[^\n]*\n?\s*(-?[\d.]+)\s*°/.exec(text);
                    return m && Math.abs(Number(m[1])) <= 2 ? true : '舵角の値が画面に無い';
                },
            },
        },
        { shot: 's02-done' },
        {
            ai: 'monitoring_catalog',
            args: { module: 'dsc_mk60', query: 'LENKWINKEL' },
            means: '（参考）DSC MK60 の舵角の較正（LENKWINKEL_DSC_ABGLEICHEN）も、送れるかと理由が分かる',
            expect: (r) => {
                const j = (r?.jobs ?? []).find((x) => x.job === 'LENKWINKEL_DSC_ABGLEICHEN');
                if (!j) return `ジョブが無い: ${JSON.stringify(r).slice(0, 200)}`;
                return j.mayRunNow || j.reason ? true : JSON.stringify(j).slice(0, 200);
            },
        },
    ]),
};

export default scenario;
