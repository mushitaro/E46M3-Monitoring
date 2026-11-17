import { tool } from './_lib.mjs';

/** The row of a job: the nearest ancestor of its name that holds the given control. */
const rowOf = (page, job, testId) => page.getByText(job, { exact: true }).first().locator(`xpath=ancestor::*[.//*[@data-test="${testId}"]][1]`);

/**
 * SMG II's STEUERN_STELLGLIED on PRACTICE: a part chosen with a whole set of values, the frame its own
 * SGBD code builds for them — the one EdiabasLib builds — sent after the confirmation, and its stop
 * armed before anything goes.
 */
const scenario = {
    id: 'S25',
    title: 'SMG II の部品を値の組で動かす：EdiabasLib と同じ電文だけを、止める電文と一緒に（練習モード）',
    story:
        'オーナーの決定（2026-11-15）：部品を動かすジョブは、画面で選んだ値で動かす。値を取るジョブは、選んだ値の組でジョブ自身の SGBD のコードが組む電文が、' +
        'EdiabasLib の組む電文と同じになる組だけを出す。ACTUATOR の STEUERN_STELLGLIED は、部品ごとにまとめた値の組を選ぶ。選ぶまで START は押せない。' +
        '選んで START を押すと、確認に始めと止めの呼び出しが出て、実行すると送られ、止める電文が手元に置かれる。STOP で止まる。' +
        'AI には、オーナーの表が AI に開いた組（故障ランプなどの表示）だけが返り、弁の組は画面に置く道を言う。',
    steps: [
        { ui: 'module', value: 'smg2', means: 'SMG II を選ぶ' },
        { ui: 'practice' },
        { ui: 'click', text: 'CONNECT', settle: 2500, means: '練習の車につなぐ' },
        { ui: 'tab', name: 'ACTUATOR' },
        {
            check: {
                desc: '値を選ぶまで、STEUERN_STELLGLIED の START は押せない',
                run: async (page) => {
                    const row = rowOf(page, 'STEUERN_STELLGLIED', 'tj-start');
                    if ((await row.count()) === 0) return 'STEUERN_STELLGLIED の行が無い';
                    for (let i = 0; i < 20 && (await row.locator('select').count()) === 0; i++) await page.waitForTimeout(250);
                    if ((await row.locator('select').count()) === 0) return '値の組の選択が無い';
                    return (await row.locator('[data-test="tj-start"]').isDisabled()) ? true : 'START が押せてしまう';
                },
            },
        },
        {
            check: {
                desc: '値の組は名前で並び、PIN（0x05 など）は無く、止め（INAKTIV）は始めとして出ない',
                run: async (page) => {
                    const labels = await rowOf(page, 'STEUERN_STELLGLIED', 'tj-start').locator('select option').allTextContents();
                    if (!labels.some((l) => l === 'HYDROPUMPE · AKTIV · 0')) return `HYDROPUMPE · AKTIV · 0 が無い: ${labels.slice(0, 8).join(' | ')}`;
                    if (labels.some((l) => /0x[0-9A-F]{2}/.test(l))) return 'PIN が混じっている';
                    if (labels.some((l) => / · INAKTIV · /.test(l))) return 'INAKTIV が始めとして出ている';
                    return true;
                },
            },
        },
        {
            check: {
                desc: 'HYDROPUMPE · AKTIV · 0 を選んで START、確認に始めと止めの呼び出しが出て、実行すると送られて止めが置かれる',
                run: async (page) => {
                    const row = rowOf(page, 'STEUERN_STELLGLIED', 'tj-start');
                    await row.locator('select').selectOption({ label: 'HYDROPUMPE · AKTIV · 0' });
                    const start = row.locator('[data-test="tj-start"]');
                    if (await start.isDisabled()) return `選んでも START が押せない: ${(await row.innerText()).slice(0, 200)}`;
                    await start.click();
                    const dialog = page.locator('[role=dialog]').first();
                    await dialog.waitFor({ timeout: 3000 });
                    const text = await dialog.innerText();
                    if (!/STELLGL=HYDROPUMPE,STEUERART1=AKTIV,STEUERART2=0/.test(text)) return `始めの呼び出しが無い: ${text.slice(0, 400)}`;
                    if (!/STELLGL=HYDROPUMPE,STEUERART1=INAKTIV,STEUERART2=0/.test(text)) return `止めの呼び出しが無い: ${text.slice(0, 400)}`;
                    for (const box of await dialog.locator('input[type=checkbox]').all()) await box.check();
                    await page.locator('[data-test="gate-run"]').click();
                    await page.waitForTimeout(2500);
                    const s = await tool(page, 'monitoring_status');
                    if (s.error) return `送れなかった: ${s.error}`;
                    const stop = rowOf(page, 'STEUERN_STELLGLIED', 'tj-stop').locator('[data-test="tj-stop"]');
                    return (await stop.isEnabled()) ? true : '止めが置かれていない（STOP が押せない）';
                },
            },
        },
        { shot: 'smg2-actuator-values' },
        {
            check: {
                desc: 'STOP で止まる',
                run: async (page) => {
                    const stop = rowOf(page, 'STEUERN_STELLGLIED', 'tj-stop').locator('[data-test="tj-stop"]');
                    await stop.click();
                    await page.waitForTimeout(1500);
                    return (await stop.isDisabled()) ? true : 'まだ止まっていない';
                },
            },
        },
        {
            check: {
                desc: 'AI が値を渡さずに頼むと、AI に開いた組（表示）だけが返る。弁の組は返らない',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_actuate', { module: 'smg2', job: 'STEUERN_STELLGLIED', phase: 'start', owner_said: 'いいよ' });
                    if (r?.started !== false || !Array.isArray(r.sets) || !r.sets.length) return JSON.stringify(r).slice(0, 300);
                    const parts = new Set(r.sets.map((s) => s[0]));
                    if (parts.has('HYDROPUMPE') || parts.has('MAGNETVENTIL_KUPPLUNG')) return `弁の組が AI に返った: ${[...parts].join(', ')}`;
                    return parts.has('STOERANZEIGE') ? true : `表示の組が無い: ${[...parts].join(', ')}`;
                },
            },
        },
        {
            check: {
                desc: 'AI が比べていない値の組を渡すと、始めない',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_actuate', { module: 'smg2', job: 'STEUERN_STELLGLIED', phase: 'start', owner_said: 'いいよ', values: ['STOERANZEIGE', 'AKTIV', '77'] });
                    return r?.started === false ? true : JSON.stringify(r).slice(0, 300);
                },
            },
        },
    ],
};

export default scenario;
