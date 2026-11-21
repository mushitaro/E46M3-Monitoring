import { connectPractice, pickActuator, tool } from './_lib.mjs';

/** Opens one ACTUATOR row's confirmation by its SGBD job name; returns an error, or null. */
const openRow = async (page, job) => {
    // The row chosen by its name; the ring is then its RUN (UX-01: one entrance).
    const ring = await pickActuator(page, job);
    if (!ring) return `no row for ${job}`;
    const button = page.locator('[data-test="tj-run"]').first();
    if ((await button.count()) === 0) return `the ring is not ${job}'s RUN`;
    if (await button.isDisabled()) return `RUN on ${job} is disabled`;
    await button.click();
    await page.locator('[data-test="gate-run"]').waitFor({ timeout: 3000 });
    return null;
};

/** The confirmation's measured lines (電圧・停車・エンジン), as shown. */
const measuredLines = async (page) => (await page.locator('[role=dialog] [data-test="gate-measured"]').allInnerTexts()).join(' / ');

/**
 * Runs one ACTUATOR row through the confirmation; returns the link's error, or null. Nothing measured
 * is ticked: the battery, the standstill and the engine are lines the app measures (operator, 2026-11-21).
 * Only an acknowledgement of what cannot be undone or stopped is a box, and the owner ticks it.
 */
const runRow = async (page, job) => {
    const opened = await openRow(page, job);
    if (opened) return opened;
    const run = page.locator('[data-test="gate-run"]');
    if ((await page.locator('[role=dialog] [data-test="gate-cond"]').count()) > 0) {
        await page.locator('[data-test="gate-cancel"]').click();
        return `${job}: a measured precondition is still a box`;
    }
    for (const box of await page.locator('[role=dialog] [data-test="gate-ack"]').all()) await box.check();
    // A failing measurement taken just now holds RUN, and its line says why: a refusal before the press.
    if (await run.isDisabled()) {
        const lines = await measuredLines(page);
        await page.locator('[data-test="gate-cancel"]').click();
        return `held: ${lines}`;
    }
    await run.click();
    await page.waitForTimeout(2500);
    return (await tool(page, 'monitoring_status')).error ?? null;
};

/** A short DATALOG of the battery, the engine and the speed: the car measured, as a recording does. */
const measureByRecording = [
    { ai: 'monitoring_log_channels', args: { channels: ['3:ub', '3:n', '19:v'] }, means: '電圧・回転・車速を選ぶ', expect: (r) => (r?.changed !== false ? true : JSON.stringify(r).slice(0, 200)) },
    { ai: 'monitoring_start_log', means: '短く記録する（車を測る）', expect: (r) => (r?.started ? true : JSON.stringify(r).slice(0, 200)) },
    { wait: 2500 },
    { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '記録を止める', expect: (r) => (r?.stopped === 'recording' ? true : JSON.stringify(r)) },
    { ui: 'tab', name: 'ACTUATOR', means: 'ACTUATOR に戻る' },
];

/** The owner's decision of 2026-11-15, on the screen: a part is driven after a confirmation, with the car measured first. */
const scenario = {
    id: 'S22',
    title: '作動テスト：確認のあと、電圧とエンジンの状態を測ってから動かす（練習モード）',
    story:
        'オーナーの決定（2026-11-15、誰がは 11-16 に AI も）：部品を動かすものは停車中に実行する。練習モードで一度動かしたものが実車で動く。' +
        'ACTUATOR で行を選んでハブの RUN を押すと確認が出る。電圧・停車・エンジンの状態はアプリが測るので印ではなく、最後に測った値が出て、印を付けずに実行できる。送る直前に車速・電圧・エンジンの状態を測る。' +
        '最後に測った電圧が 12 V を切っていれば、確認はその値を赤で出し、RUN は押せない。' +
        'エンジン停止を条件にする点火コイルは、エンジンがかかっていると送られない。止めると送られる。電圧が 12 V を切ると何も送られない。' +
        'AI も始められる（決定 2026-11-16）が、AI の頼みも同じ測りを通る：12 V を切っていれば送られない。',
    steps: [
        ...connectPractice,
        ...measureByRecording,
        {
            check: {
                desc: '確認は、測った電圧・停車・エンジンを値で言い、前提の印が無い。エンジン停止が条件の点火コイルは、回っている測定を赤で言う（運営者 2026-11-21）',
                run: async (page) => {
                    const opened = await openRow(page, 'STEUERN_ZS1');
                    if (opened) return opened;
                    const lines = await measuredLines(page);
                    const boxes = await page.locator('[role=dialog] [data-test="gate-cond"]').count();
                    const engine = page.locator('[role=dialog] [data-test="gate-measured"]', { hasText: 'エンジン' }).first();
                    const engineText = (await engine.count()) ? await engine.innerText() : '';
                    const engineRed = (await engine.count()) ? /text-red/.test((await engine.getAttribute('class')) ?? '') : false;
                    const held = await page.locator('[data-test="gate-run"]').isDisabled();
                    const why = [];
                    if (!/電圧 1[2-9]\.\d V（前回の測定）/.test(lines)) why.push(`測った電圧が無い：${lines}`);
                    if (!/停車中（0 km\/h、前回の測定）/.test(lines)) why.push(`測った停車が無い：${lines}`);
                    if (boxes > 0) why.push(`前提の印が ${boxes} 個`);
                    if (!/エンジンが回っています（\d+ rpm、前回の測定）：止めてから動かせます/.test(engineText) || !engineRed) why.push(`エンジンの行が赤で理由を言わない：${engineText}`);
                    // Taken just now it holds RUN; a few seconds older, RUN stays and the line says the press measures again.
                    if (!held && !/押すと測り直してから送ります/.test(engineText)) why.push('RUN が押せるのに「押すと測り直してから送ります」が無い');
                    return why.length ? why.join('、') : true;
                },
            },
        },
        { shot: 'measured-confirm' },
        { ui: 'click', selector: '[data-test="gate-cancel"]', means: '一度閉じる' },
        {
            check: {
                desc: 'VANOS の弁を一度動かす：電圧は測った値の行で、印を付けずに RUN が押せ、電圧とエンジンを測ってから送る',
                run: async (page) => {
                    const opened = await openRow(page, 'STEUERN_AVANOS1_SPAET_VENTIL');
                    if (opened) return opened;
                    const lines = await measuredLines(page);
                    await page.locator('[data-test="gate-cancel"]').click();
                    if (!/電圧 1[2-9]\.\d V（前回の測定）/.test(lines)) return `測った電圧が無い：${lines}`;
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
                    // Refused at the wire (the engine measured on the press), or held by the dialog's own measurement.
                    return err && /engine stopped|held: .*エンジンが回っています/.test(err) ? true : `expected a refusal, got ${err}`;
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
                    // The dialog's last battery reading is from before it weakened: the press measures and refuses.
                    return err && /under 12 V|held: .*電圧 11\.4 V/.test(err) ? true : `expected a refusal, got ${err}`;
                },
            },
        },
        { shot: 'actuator' },
        ...measureByRecording,
        {
            check: {
                desc: '最後に測った電圧が 12 V を切っていると、確認はその値を赤で出し、理由を言い、RUN は押せない',
                run: async (page) => {
                    const opened = await openRow(page, 'STEUERN_ZS1');
                    if (opened) return opened;
                    const line = page.locator('[role=dialog] [data-test="gate-measured"]', { hasText: '電圧' }).first();
                    const text = (await line.count()) ? await line.innerText() : '';
                    const red = (await line.count()) ? /text-red/.test((await line.getAttribute('class')) ?? '') : false;
                    const why = [];
                    if (!/電圧 11\.4 V（前回の測定）：12 V 以上で動かせます/.test(text)) why.push(`電圧の行：${text || '無い'}`);
                    if (!red) why.push('赤でない');
                    if (!(await page.locator('[data-test="gate-run"]').isDisabled())) why.push('RUN が押せる');
                    return why.length ? why.join('、') : true;
                },
            },
        },
        { shot: 'low-voltage-confirm' },
        { ui: 'click', selector: '[data-test="gate-cancel"]', means: '閉じる' },
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
