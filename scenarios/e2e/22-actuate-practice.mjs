import { connectPractice, pickActuator, tool } from './_lib.mjs';

/** Runs one ACTUATOR row by its SGBD job name through the confirmation; returns the link's error, or null. */
const runRow = async (page, job) => {
    // The row chosen by its name; the ring is then its RUN (UX-01: one entrance).
    const ring = await pickActuator(page, job);
    if (!ring) return `no row for ${job}`;
    const button = page.locator('[data-test="tj-run"]').first();
    if ((await button.count()) === 0) return `the ring is not ${job}'s RUN`;
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
        'オーナーの決定（2026-11-15、誰がは 11-16 に AI も）：部品を動かすものは停車中に実行する。練習モードで一度動かしたものが実車で動く。' +
        'ACTUATOR で行を選んでハブの RUN を押すと確認が出て、確かめる項目に印を付けると実行できる。送る直前に車速・電圧・エンジンの状態を測る。' +
        'エンジン停止を条件にする点火コイルは、エンジンがかかっていると送られない。止めると送られる。電圧が 12 V を切ると何も送られない。' +
        'AI も始められる（決定 2026-11-16）が、AI の頼みも同じ測りを通る：12 V を切っていれば送られない。',
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
                desc: 'AI が「いいよ」のあとに頼んでも、12 V を切っていれば点火コイルは送られない',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_actuate', { module: 'mss54', job: 'STEUERN_ZS1', phase: 'pulse', owner_said: 'いいよ' });
                    return r?.started === false && /under 12 V|battery/.test(r.reason ?? '') ? true : JSON.stringify(r).slice(0, 200);
                },
            },
        },
    ],
};

export default scenario;
