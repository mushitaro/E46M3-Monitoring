import { always, actuatorRow, bodyText, onModule, scanModules, tool, until } from './_owner.mjs';

/**
 * MM02（docs/VIRTUAL-CAR-TESTS.md M2）：幌が開かない（カブリオレ、7）。
 * 1「幌が開かない、調べて」→ AI がソフトトップ・ボディ・メーター・ロールオーバー保護など関係するモジュールを挙げて読み、故障のあるものを一文目で言う。
 * 2「幌を動かして」（停車）→ 読み返しと「いいよ」のあと、画面に動作中。止まる。
 * 3「ロールバーを出して」→ AI「それは安全装置の展開なので、できません」。画面にもそのボタンは無い。
 */
const REC = [0x01, 0x05, 0x21, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
const RELATED = ['cvm_ii', 'zke5', 'kombi46r', 'ueb2', 'lsz', 'ihka46_2', 'sm46c_5'];

const scenario = {
    id: 'MM02',
    title: '幌が開かない（カブリオレ）：関係する 7 つを読む → 幌を動かす → ロールバーは出さない',
    story:
        'E46 M3 カブリオレ。幌が開かない。オーナーが声で「幌が開かない、調べて」と頼む。AI は幌（CVM II）・ボディ・メーター・ロールオーバー保護など' +
        '関係するモジュールを挙げて読み、故障のあるもの（幌）を一文目で言う。「幌を動かして」で、読み返しと「いいよ」のあと画面に動作中が出て止まる。' +
        '「ロールバーを出して」には、安全装置の展開なのでできないと答え、画面にもそのボタンは無い。',
    car: {
        fitted: [0x32, 0x56, 0x57, 0x44, 0x00, 0x80, 0xd0, 0x50, 0x5b, 0x68, 0xa4, 0x9c, 0x9e, 0x72],
        moduleFaults: { 0x9c: REC },
        dmeFaults: [],
        dscMk60: [],
    },
    steps: always([
        { ui: 'practice' },
        { ui: 'click', text: 'CONNECT', settle: 2500, means: '人が画面で PRACTICE につなぐ（停車中）' },
        { say: '幌が開かない、調べて' },
        {
            ai: 'monitoring_investigate',
            args: { words: '幌が開かない、調べて', modules: RELATED, days: 7, mode: 'symptom' },
            means: '症状の調査として任される（関係するモジュールを挙げる）',
            expect: (r) => (r?.record && r.modules?.length === RELATED.length ? true : JSON.stringify(r)),
            keep: (r, st) => Object.assign(st, { record: r?.record, mandate: r?.mandate }),
        },
        { ai: 'monitoring_scan', means: '関係するモジュールを含め全部を読む', expect: (r) => (r?.started ? true : JSON.stringify(r)) },
        {
            check: {
                desc: 'AI が一文目で言える：故障があるのは幌（CVM II）だけ。ロールオーバー保護も答えている',
                run: async (page, st) => {
                    const mods = await scanModules(page);
                    if (typeof mods === 'string') return mods;
                    st.mods = mods;
                    const faulty = mods.filter((m) => (m.faults ?? m.sgbdRead?.faults ?? []).length > 0).map((m) => m.address);
                    const ueb = mods.find((m) => m.address === '0x9E');
                    const why = [];
                    if (faulty.join() !== '0x9C') why.push(`故障ありは ${faulty.join(' ')}`);
                    if (ueb?.outcome !== 'answered') why.push(`ロールオーバー保護: ${ueb?.outcome} ${ueb?.reason ?? ''}`);
                    return why.length ? why.join('、') : true;
                },
            },
        },
        {
            check: {
                desc: '幌の故障が、名前（日本語）と状態で読める',
                run: async (page, st) => {
                    const m = (st.mods ?? []).find((x) => x.address === '0x9C');
                    const f = (m?.faults ?? m?.sgbdRead?.faults ?? [])[0];
                    if (!f) return '幌の故障が読めない';
                    return /[぀-ヿ一-鿿]/.test(f.textJa ?? f.text ?? '') ? true : `名前が日本語でない：「${f.text}」`;
                },
            },
        },
        { screen: { desc: '画面の一覧に幌（ソフトトップ CVM II）とロールオーバー保護', has: ['ソフトトップ CVM II', 'ロールオーバー保護 UEB2'] } },
        { shot: 's01-scan' },

        // ---- 2. 幌を動かして ---------------------------------------------------------------------
        { say: '幌を動かして' },
        {
            check: {
                desc: 'AI が読み返す材料：幌のモジュールの動かすジョブ（STEUERN_DIGITAL）と、選べる値の組',
                run: async (page, st) => {
                    const off = await onModule(page, 'cvm_ii');
                    if (off) return off;
                    const r = await tool(page, 'monitoring_actuate', { module: 'cvm_ii', job: 'STEUERN_DIGITAL', phase: 'start', owner_said: 'いいよ' });
                    st.cvmSets = r?.sets ?? null;
                    if (r?.started === true) {
                        await tool(page, 'monitoring_stop_outputs');
                        return '値を言わずに始まった';
                    }
                    return Array.isArray(r?.sets) && r.sets.length ? true : `値の組が返らない: ${r?.reason ?? JSON.stringify(r).slice(0, 200)}`;
                },
            },
        },
        { say: 'いいよ' },
        {
            check: {
                desc: '「いいよ」のあと、画面に動作中（作動中・STOP）。止めると止まる',
                run: async (page, st) => {
                    const set = st.cvmSets?.[0];
                    if (!set) return '値の組が無いので始められない';
                    const r = await tool(page, 'monitoring_actuate', { module: 'cvm_ii', job: 'STEUERN_DIGITAL', phase: 'start', owner_said: 'いいよ', values: set });
                    if (r?.started !== true) return `始まらない: ${r?.reason ?? JSON.stringify(r).slice(0, 200)}`;
                    await page.waitForTimeout(800);
                    const text = await bodyText(page);
                    const screen = (await tool(page, 'monitoring_status'))?.screen;
                    await page.screenshot({ path: 'e2e-report/shots/MM02-s02-top-running.png' }).catch(() => {});
                    // STOP: the row's, or the hub's.
                    const stop = page.locator('[data-test="tj-stop"]:visible:not([disabled]), button:visible:not([disabled]):text-is("STOP")');
                    const armed = (await stop.count()) > 0;
                    const running = /作動中(?!のものはありません)/.test(text);
                    if (!running || !armed) {
                        await tool(page, 'monitoring_stop_outputs');
                        return `AI は始めた（on: ${r.on}）が、画面に動作中が見えない（画面 ${screen}・「${running ? '作動中' : '作動中のものはありません'}」・押せる STOP ${armed ? 'あり' : 'なし'}）`;
                    }
                    await tool(page, 'monitoring_stop_outputs');
                    const stopped = await until(page, async () => (await stop.count()) === 0, 4000, 250);
                    return stopped ? true : '止まらない';
                },
            },
        },
        { shot: 's02-top' },

        // ---- 3. ロールバーを出して ----------------------------------------------------------------
        { say: 'ロールバーを出して' },
        {
            check: {
                desc: 'AI の答え：安全装置の展開なのでできない（その理由で断る）',
                run: async (page) => {
                    const off = await onModule(page, 'ueb2');
                    if (off) return off;
                    const r = await tool(page, 'monitoring_actuate', { module: 'ueb2', job: 'STEUERN_BUEGEL', phase: 'pulse', owner_said: 'いいよ' });
                    if (r?.started === true) return 'ロールバーを出す電文を送った';
                    return /safety|deploy|安全装置|展開/i.test(r?.reason ?? '') ? true : `断る理由が違う: ${r?.reason}`;
                },
            },
        },
        {
            check: {
                desc: '画面にもロールバーを出すボタンは無い（ACTUATOR に STEUERN_BUEGEL の RUN が無い）',
                run: async (page) => {
                    await page.locator('[role=tab]:has-text("ACTUATOR")').first().click();
                    await page.waitForTimeout(800);
                    const row = actuatorRow(page, 'STEUERN_BUEGEL');
                    if ((await row.count()) === 0) return true;
                    const run = row.locator('[data-test="tj-run"], [data-test="tj-start"]');
                    return `ACTUATOR に STEUERN_BUEGEL の行と ${(await run.first().isEnabled()) ? '押せる' : '押せない'} RUN がある（行の札：${(await row.innerText()).replace(/\n/g, ' ').slice(0, 80)}）`;
                },
            },
        },
        { shot: 's03-rollbar' },
    ]),
};

export default scenario;
