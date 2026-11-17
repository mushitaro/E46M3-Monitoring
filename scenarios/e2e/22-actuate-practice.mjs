import { connectPractice, tool } from './_lib.mjs';

/** Runs one ACTUATOR row by its SGBD job name through the confirmation; returns the link's error, or null. */
const runRow = async (page, job) => {
    // The row's own RUN: the nearest ancestor of the job's name that holds one.
    const name = page.getByText(job, { exact: true }).first();
    if ((await name.count()) === 0) return `no row for ${job}`;
    const button = name.locator('xpath=ancestor::*[.//*[@data-test="tj-run"]][1]//*[@data-test="tj-run"]').first();
    if ((await button.count()) === 0) return `no RUN on ${job}`;
    if (await button.isDisabled()) return `RUN on ${job} is disabled`;
    await button.click();
    const run = page.locator('[data-test="gate-run"]');
    await run.waitFor({ timeout: 3000 });
    for (const box of await page.locator('[role=dialog] input[type=checkbox]').all()) await box.check();
    await run.click();
    await page.waitForTimeout(2500);
    return (await tool(page, 'monitoring_status')).error ?? null;
};

/** The owner's decision of 2026-11-15, on the screen: a part is driven after a confirmation, with the car measured first. */
const scenario = {
    id: 'S22',
    title: '作動テスト：確認のあと、電圧とエンジンの状態を測ってから動かす（練習モード）',
    story:
        'オーナーの決定（2026-11-15）：部品を動かすものは停車中に画面の人が実行する。練習モードで一度動かしたものが実車で動く。' +
        'ACTUATOR で RUN を押すと確認が出て、確かめる項目に印を付けると実行できる。送る直前に車速・電圧・エンジンの状態を測る。' +
        'エンジン停止を条件にする点火コイルは、エンジンがかかっていると送られない。止めると送られる。電圧が 12 V を切ると何も送られない。' +
        'AI が始める口（monitoring_actuate）はあるが、画面の人と決めた項目は断り、画面に置く道（monitoring_stage）を言う。',
    steps: [
        ...connectPractice,
        { ui: 'tab', name: 'ACTUATOR', means: 'ACTUATOR を開く' },
        {
            check: {
                desc: 'VANOS の弁を一度動かす：確認のあと、電圧とエンジンを測ってから送る',
                run: async (page) => {
                    const err = await runRow(page, 'STEUERN_AVANOS1_SPAET_VENTIL');
                    return err ? err : true;
                },
            },
        },
        {
            check: {
                desc: 'エンジンがかかっている間、点火コイル（エンジン停止が条件）は送られない',
                run: async (page) => {
                    const err = await runRow(page, 'STEUERN_ZS1');
                    return err && /engine stopped/.test(err) ? true : `expected a refusal, got ${err}`;
                },
            },
        },
        { car: { engineRunning: false }, means: 'エンジンを止める' },
        {
            check: {
                desc: 'エンジンを止めると点火コイルは送られる',
                run: async (page) => {
                    const err = await runRow(page, 'STEUERN_ZS1');
                    return err ? err : true;
                },
            },
        },
        { car: { batteryV: 11.4 }, means: 'バッテリーが弱る' },
        {
            check: {
                desc: '12 V を切ると何も送られない',
                run: async (page) => {
                    const err = await runRow(page, 'STEUERN_ZS1');
                    return err && /under 12 V/.test(err) ? true : `expected a refusal, got ${err}`;
                },
            },
        },
        { shot: 'actuator' },
        {
            check: {
                desc: '画面の人が押すと決めた項目（点火コイル）は、AI が頼まれても始めず、画面に置く道を言う',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_actuate', { module: 'mss54', job: 'STEUERN_ZS1', phase: 'pulse', owner_said: 'いいよ' });
                    return r?.started === false && /monitoring_stage/.test(r.reason ?? '') ? true : JSON.stringify(r).slice(0, 200);
                },
            },
        },
    ],
};

export default scenario;
