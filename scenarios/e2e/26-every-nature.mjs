import { connectPractice, tool } from './_lib.mjs';

/**
 * Every nature the owner's table opens (policy.ts, 2026-11-15/16), both ways (completion criteria,
 * 2026-11-18): one job of each started by the assistant after the owner's OK, and one run from the
 * screen after its confirmation — on the practice car, which answers what EdiabasLib's simulation
 * answered. Jobs without values and with them, one that sends several frames (a VANOS check), the DSC
 * MK60 (KWP on DS2) and an SMG II procedure.
 */
const NATURES = [
    { nature: 'a_engine', module: 'mss54', job: 'STEUERN_AVANOS1_SPAET_VENTIL', actuator: true },
    { nature: 'c_check', module: 'mss54', job: 'STEUERN_EVANOS1_VERSTELLZEIT', actuator: true, note: '2 通以上' },
    { nature: 'c_adapt', module: 'mss54', job: 'ADAPT_LOESCHEN' },
    { nature: 'c_setup', module: 'mss54', job: 'DIAGNOSE_ERHALTEN' },
    { nature: 'c_clear', module: 'smg2', job: 'FS_LOESCHEN' },
    { nature: 'a_smg', module: 'smg2', job: 'ANSTEUERUNG_VORBEREITEN' },
    { nature: 'a_brake', module: 'dsc_e46', job: 'DSC_SIM_VA', actuator: true },
    { nature: 'c_mode', module: 'dsc_mk60', job: 'BET_AKTIV', note: 'MK60' },
    { nature: 'a_disp', module: 'kombi46r', job: 'STEUERN_GONG3', actuator: true },
    { nature: 'a_body', module: 'zke5', job: 'STEUERN_DIGITAL', actuator: true, values: true },
    { nature: 'a_av', module: 'radio', job: 'STEUERN_FADER_LV', actuator: true },
    { nature: 'a_comfort', module: 'ihka46', job: 'STEUERN_TASTE_HECKSCHEIBE', actuator: true },
    { nature: 'a_chassis', module: 'lws5', job: 'STEUERN_DIGITAL', actuator: true, values: true },
    { nature: 'c_sim', module: 'lsz', job: 'STEUERN_DIMMER', actuator: true, values: true },
];

/** The module on the screen, connected (the same door as DISCONNECT and CONNECT). */
const onModule = async (page, module) => {
    const s = await tool(page, 'monitoring_status');
    if (s?.module?.id === module && s.link === 'connected') return null;
    const r = await tool(page, 'monitoring_module', { module });
    if (r?.error) return `monitoring_module ${module}: ${r.error}`;
    for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(300);
        const t = await tool(page, 'monitoring_status');
        if (t?.module?.id === module && t.link === 'connected') return null;
    }
    return `${module} did not connect`;
};

/** The assistant starts it after the owner's OK: once, or on and then stopped. */
const byAssistant = async (page, { module, job, values }) => {
    const off = await onModule(page, module);
    if (off) return off;
    let args = { module, job, phase: 'pulse', owner_said: 'いいよ' };
    if (values) {
        const sets = await tool(page, 'monitoring_actuate', args);
        if (!Array.isArray(sets?.sets) || !sets.sets.length) return `no sets for ${job}: ${JSON.stringify(sets).slice(0, 200)}`;
        args = { ...args, values: sets.sets[0] };
    }
    const r = await tool(page, 'monitoring_actuate', args);
    if (r?.started !== true) return `${module}.${job}: ${JSON.stringify(r).slice(0, 240)}`;
    if (r.on) await tool(page, 'monitoring_stop_outputs');
    await page.waitForTimeout(1200);
    return true;
};

/** A person runs it on the screen: its ACTUATOR row, or SERVICE's start once it is placed there. */
const byScreen = async (page, { module, job, values, actuator }) => {
    const off = await onModule(page, module);
    if (off) return off;
    // A test job is a row on ACTUATOR; the rest are placed on SERVICE and started from the hub.
    if (actuator) {
        await page.locator('[role=tab]:has-text("ACTUATOR")').first().click();
        await page.waitForTimeout(600);
        // The innermost element holding both the job's name and a RUN: its row.
        const row = page
            .locator(`xpath=//*[.//*[@data-test="tj-run" or @data-test="tj-start"]][.//*[normalize-space(text())="${job}"]]`)
            .last();
        if ((await row.count()) === 0) return `${job}: no ACTUATOR row`;
        if (values) {
            const select = row.locator('select').first();
            for (let i = 0; i < 20 && (await select.count()) === 0; i++) await page.waitForTimeout(250);
            const options = await select.locator('option').allTextContents();
            if (options.length < 2) return `${job}: no set to choose`;
            await select.selectOption({ index: 1 });
        }
        const button = row.locator('[data-test="tj-run"], [data-test="tj-start"]').first();
        if (await button.isDisabled()) return `${job}: RUN is disabled — ${(await row.innerText()).slice(0, 200)}`;
        await button.click();
    } else {
        const staged = await tool(page, 'monitoring_stage', { module, job });
        if (!staged?.staged) return `${job}: not placed — ${JSON.stringify(staged).slice(0, 200)}`;
        const start = page.locator('button.rounded-full:not([disabled])').filter({ hasText: /^(Start|Run)$/ }).first();
        try {
            await start.waitFor({ timeout: 8000 });
        } catch {
            const hub = await page.locator('button.rounded-full').allTextContents();
            return `${job}: no Start on the hub (${hub.join(' / ').slice(0, 160)})`;
        }
        await start.click();
    }
    const run = page.locator('[data-test="gate-run"]');
    await run.waitFor({ timeout: 3000 });
    for (const box of await page.locator('[role=dialog] input[type=checkbox]').all()) await box.check();
    await run.click();
    await page.waitForTimeout(2500);
    const s = await tool(page, 'monitoring_status');
    await tool(page, 'monitoring_stop_outputs');
    return s?.error ? `${module}.${job}: ${s.error}` : true;
};

const scenario = {
    id: 'S26',
    title: '性質ごとに一つ、AI と画面の人の両方の道で動かす（練習モード）',
    story:
        '完了の基準（運営者、2026-11-18）：表で「実行」の性質は全部、AI が「いいよ」のあとに始められ、画面の人が確認のあとに動かせる。' +
        '値を取らないもの・値を取るもの・2 通以上送るもの（VANOS の検査）・DSC MK60・SMG II の手順を含めて、練習の車で一つずつ確かめる。',
    steps: [
        ...connectPractice,
        ...NATURES.flatMap((n) => [
            { check: { desc: `${n.nature}：AI が「いいよ」のあとに始める（${n.module}.${n.job}${n.note ? `、${n.note}` : ''}）`, run: (page) => byAssistant(page, n) } },
            { check: { desc: `${n.nature}：画面の人が確認のあとに動かす（${n.module}.${n.job}）`, run: (page) => byScreen(page, n) } },
        ]),
        {
            check: {
                desc: 'p_smg：AI が SMG II の手順を始め、画面の手順のダイアログが最後まで走らせる（monitoring_procedure）',
                run: async (page) => {
                    const off = await onModule(page, 'smg2');
                    if (off) return off;
                    // The catalogue leads there: the start job names its tool, the procedures carry the number
                    // (car, 2026-11-19: a bare "takes values" and no list read as "nothing can be run").
                    const cat = await tool(page, 'monitoring_catalog', { module: 'smg2', query: 'TESTPRG_STARTEN bleeding' });
                    const start = cat?.jobs?.find((j) => j.job === 'TESTPRG_STARTEN');
                    if (!/^monitoring_procedure/.test(start?.runWith ?? '')) return `catalogue: no route for TESTPRG_STARTEN: ${JSON.stringify(start).slice(0, 200)}`;
                    const listed = cat?.procedures?.find((p) => p.procedure === '0x01');
                    if (!listed?.assistantMayStart) return `catalogue: procedure 0x01 not listed for the assistant: ${JSON.stringify(cat?.procedures).slice(0, 200)}`;
                    const bare = await tool(page, 'monitoring_actuate', { module: 'smg2', job: 'TESTPRG_STARTEN', owner_said: 'いいよ' });
                    if (bare?.started !== false || !/monitoring_procedure/.test(bare?.reason ?? '')) return `monitoring_actuate did not send TESTPRG_STARTEN to monitoring_procedure: ${JSON.stringify(bare).slice(0, 200)}`;
                    const r = await tool(page, 'monitoring_procedure', { procedure: listed.procedure, owner_said: 'いいよ' });
                    if (r?.started !== true) return JSON.stringify(r).slice(0, 240);
                    const dialog = page.locator('[role=dialog]').first();
                    await dialog.waitFor({ timeout: 4000 });
                    for (let i = 0; i < 60; i++) {
                        const text = await dialog.innerText();
                        if (/finished|完了|終了/i.test(text)) return true;
                        await page.waitForTimeout(500);
                    }
                    return `the procedure did not finish: ${(await dialog.innerText()).slice(0, 300)}`;
                },
            },
        },
        { shot: 'every-nature' },
    ],
};

export default scenario;
