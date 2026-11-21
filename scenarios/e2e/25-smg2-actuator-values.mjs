import { actuatorRowOf, chooseSet, openDetails, pickActuator, setsOf, tool } from './_lib.mjs';

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
        'EdiabasLib の組む電文と同じになる組だけを出す。ACTUATOR の STEUERN_STELLGLIED は、部品ごとにまとめた値の組を選ぶ。行を選ぶとハブがその START になり、値を選ぶまで押せない。' +
        '選んで START を押すと、確認に始めと止めの呼び出しが出て、実行すると送られ、止める電文が手元に置かれる。STOP で止まる。' +
        'オーナーの決定（2026-11-16）で、部品を動かすものは AI も始められる。AI が値を渡さずに頼むと、EdiabasLib と比べた組が返り、比べていない組では始めない。',
    steps: [
        { ui: 'module', value: 'smg2', means: 'SMG II を選ぶ' },
        { ui: 'practice' },
        { ui: 'click', text: 'CONNECT', settle: 2500, means: '練習の車につなぐ' },
        { ui: 'tab', name: 'ACTUATOR' },
        {
            check: {
                desc: '値を選ぶまで、STEUERN_STELLGLIED の START は押せない',
                run: async (page) => {
                    const row = actuatorRowOf(page, 'STEUERN_STELLGLIED');
                    if ((await row.count()) === 0) return 'STEUERN_STELLGLIED の行が無い';
                    for (let i = 0; i < 20 && (await row.locator('select').count()) === 0; i++) await page.waitForTimeout(250);
                    if ((await row.locator('select').count()) === 0) return '値の組の選択が無い';
                    // The row chosen: the ring is its START, and it waits for the values.
                    await pickActuator(page, 'STEUERN_STELLGLIED');
                    const start = page.locator('[data-test="tj-start"]');
                    if ((await start.count()) === 0) return 'ハブが STEUERN_STELLGLIED の START にならない';
                    return (await start.isDisabled()) ? true : 'START が押せてしまう';
                },
            },
        },
        {
            check: {
                desc: '値の組は部品の名前の下に人の語で並び（油圧ポンプ › オン · 0）、PIN（0x05 など）も SGBD の独語も無く、止め（INAKTIV＝オフ）は始めとして出ない',
                run: async (page) => {
                    const row = actuatorRowOf(page, 'STEUERN_STELLGLIED');
                    const labels = await row.locator('select option').allTextContents();
                    const sets = await setsOf(row);
                    if (!sets.includes('油圧ポンプ › オン · 0')) return `油圧ポンプ › オン · 0 が無い: ${sets.slice(0, 8).join(' | ')}`;
                    if (labels.some((l) => /0x[0-9A-F]{2}/.test(l))) return 'PIN が混じっている';
                    if (labels.some((l) => /HYDROPUMPE|AKTIV/.test(l))) return `SGBD の独語が残っている: ${labels.filter((l) => /HYDROPUMPE|AKTIV/.test(l)).slice(0, 3).join(' | ')}`;
                    if (sets.some((l) => / › オフ( · |$)/.test(l))) return 'INAKTIV（オフ）が始めとして出ている';
                    return true;
                },
            },
        },
        {
            check: {
                desc: '油圧ポンプ › オン · 0（HYDROPUMPE · AKTIV · 0）を選んで START、確認の詳細に始めと止めの呼び出しが出て、実行すると送られて止めが置かれる',
                run: async (page) => {
                    const row = actuatorRowOf(page, 'STEUERN_STELLGLIED');
                    if (!(await chooseSet(row, '油圧ポンプ', 'オン · 0'))) return '油圧ポンプ › オン · 0 が選べない';
                    await pickActuator(page, 'STEUERN_STELLGLIED');
                    const start = page.locator('[data-test="tj-start"]');
                    if (await start.isDisabled()) return `選んでも START が押せない: ${(await row.innerText()).slice(0, 200)}`;
                    await start.click();
                    const dialog = page.locator('[role=dialog]').first();
                    await dialog.waitFor({ timeout: 3000 });
                    // The call lines are the confirmation's, under its 詳細 (UX-11): opened, they are on the dialog.
                    await openDetails(page);
                    const text = await dialog.innerText();
                    if (!/STELLGL=HYDROPUMPE,STEUERART1=AKTIV,STEUERART2=0/.test(text)) return `始めの呼び出しが無い: ${text.slice(0, 400)}`;
                    if (!/STELLGL=HYDROPUMPE,STEUERART1=INAKTIV,STEUERART2=0/.test(text)) return `止めの呼び出しが無い: ${text.slice(0, 400)}`;
                    // The battery, the standstill and the engine are measured, not ticked (operator, 2026-11-21): only an acknowledgement is a box.
                    for (const box of await dialog.locator('[data-test="gate-ack"]').all()) await box.check();
                    await page.locator('[data-test="gate-run"]').click();
                    await page.waitForTimeout(2500);
                    const s = await tool(page, 'monitoring_status');
                    if (s.error) return `送れなかった: ${s.error}`;
                    // STOP is the hub's ring while something is on (UX-01): one place to stop it.
                    const stop = page.locator('[data-test="tj-stop"]');
                    return (await stop.count()) && (await stop.isEnabled()) ? true : '止めが置かれていない（STOP が押せない）';
                },
            },
        },
        { shot: 'smg2-actuator-values' },
        {
            check: {
                desc: 'STOP で止まる',
                run: async (page) => {
                    const stop = page.locator('[data-test="tj-stop"]');
                    await stop.click();
                    await page.waitForTimeout(1500);
                    // Stopped: the ring is no longer a STOP, and the row no longer says it is on.
                    const row = await actuatorRowOf(page, 'STEUERN_STELLGLIED').innerText();
                    return (await stop.count()) === 0 && !row.includes('作動中') ? true : 'まだ止まっていない';
                },
            },
        },
        {
            check: {
                desc: 'AI が値を渡さずに頼むと、EdiabasLib と比べた組が返る（弁の組も。決定 2026-11-16）',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_actuate', { module: 'smg2', job: 'STEUERN_STELLGLIED', phase: 'start', owner_said: 'いいよ' });
                    if (r?.started !== false || !Array.isArray(r.sets) || !r.sets.length) return JSON.stringify(r).slice(0, 300);
                    const parts = [...new Set(r.sets.map((s) => s[0]))];
                    return parts.some((p) => /^MAGNETVENTIL_|^HYDROPUMPE$/.test(p)) ? true : `弁の組が無い: ${parts.join(', ')}`;
                },
            },
        },
        {
            check: {
                desc: 'AI が「一度だけ」（pulse）で頼んでも、入れて止める形のジョブなので組が返り、選んだ組で始まって止まる（実車 2026-11-19 の不具合）',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_actuate', { module: 'smg2', job: 'STEUERN_STELLGLIED', phase: 'pulse', owner_said: 'いいよ' });
                    if (r?.started !== false || !Array.isArray(r.sets) || !r.sets.length) return `組が返らない: ${JSON.stringify(r).slice(0, 300)}`;
                    const set = r.sets.find((x) => x[0] === 'HYDROPUMPE') ?? r.sets[0];
                    const go = await tool(page, 'monitoring_actuate', { module: 'smg2', job: 'STEUERN_STELLGLIED', phase: 'pulse', owner_said: 'いいよ', values: set });
                    if (go?.started !== true || go.on !== true) return `始まらない、または止める支度が無い: ${JSON.stringify(go).slice(0, 300)}`;
                    await tool(page, 'monitoring_stop_outputs');
                    return true;
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
