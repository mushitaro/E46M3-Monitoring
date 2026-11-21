import { NAVI, all, ask, connect, noVin, openNavi, rowOf, rowText, screenText, wire } from './_sc01-07.mjs';

/**
 * SC07 部品を動かす（声）。docs/VIRTUAL-CAR-TESTS.md M1。
 * 停車中、PRACTICE の練習の車。AI は monitoring_catalog で探し、monitoring_module で SMG II に切り替え、
 * monitoring_actuate で値の組を受け取って読み返し、「いいよ」のあとに動かす。止めるのは monitoring_stop_outputs。
 */
const JOB = 'STEUERN_STELLGLIED';
const SET = ['HYDROPUMPE', 'AKTIV', '0'];
const START_FRAME = /^32 07 0c 05 01 00 3d$/;
const STOP_FRAME = /^32 07 0c 05 00 00 3c$/;
const row = (page) => rowOf(page, JOB, 'tj-pick');

/** 自分で止まるまで待つ：止まった ms（75 秒たっても止まらなければ null）。 */
async function untilOff(page, t0) {
    while (Date.now() - t0 < 75000) {
        await page.waitForTimeout(1000);
        const s = await page.evaluate(() => window.__monitoringE2E.tool('monitoring_status'));
        const on = await rowText(row(page)).catch(() => '');
        if (!on.includes('作動中') && s.link === 'connected') return Date.now() - t0;
    }
    return null;
}

const scenario = {
    id: 'SC07',
    title: '部品を動かす（声）：「SMG の油圧ポンプを動かして」→ 読み返し →「いいよ」→「止めて」→「一回だけ動かして」',
    story:
        '停車して「SMG の油圧ポンプを動かして」。AI が何を何秒動かすか、前提（停車・12 V 以上）を読み返し、まだ動かさない。「いいよ」で動かし、' +
        'ナビが ACTUATOR に切り替わって動作中が出る。3 秒後の「止めて」は読み返さずにすぐ止まる。「一回だけ動かして」も同じに動き、10 秒で止まる。',
    viewport: NAVI,
    steps: all([
        openNavi(),
        ...connect,
        // 1. 「SMG の油圧ポンプを動かして」
        { say: 'SMG の油圧ポンプを動かして' },
        {
            check: {
                desc: '手順 1：AI が「油圧ポンプ」でカタログを引くと、動かすジョブ（STEUERN_STELLGLIED の HYDROPUMPE）に行き着く',
                run: async (page, st) => {
                    const c = await ask(page, st, 'monitoring_catalog', { module: 'smg2', query: '油圧ポンプ' });
                    const jobs = (c.jobs ?? []).map((j) => j.job);
                    if (jobs.includes(JOB)) return true;
                    return `「油圧ポンプ」で出るのは ${jobs.join(', ') || 'なし'}。STEUERN_STELLGLIED は出ない（HYDROPUMPE は値の組の中にだけある）`;
                },
            },
        },
        {
            check: {
                desc: '手順 1：AI が SMG II に切り替え、値なしで頼むと組が返り、油圧ポンプの組（HYDROPUMPE · AKTIV · 0）がある。まだ動かない',
                run: async (page, st) => {
                    const m = await ask(page, st, 'monitoring_module', { module: 'smg2' });
                    if (!m.switched) return `切り替わらない：${JSON.stringify(m).slice(0, 200)}`;
                    await page.waitForTimeout(2500);
                    const t0 = Date.now();
                    const r = await ask(page, st, 'monitoring_actuate', { module: 'smg2', job: JOB, phase: 'start', owner_said: '' });
                    st.sets = r;
                    const heard = await wire(page, t0);
                    if (r.started !== false) return `値なしで始まった：${JSON.stringify(r).slice(0, 200)}`;
                    if (heard.some((h) => START_FRAME.test(h))) return '読み返しの前に始めの電文が出た';
                    return (r.sets ?? []).some((x) => x.join() === SET.join()) ? true : `組に HYDROPUMPE · AKTIV · 0 が無い：${JSON.stringify(r).slice(0, 200)}`;
                },
            },
        },
        {
            check: {
                desc: '手順 1：読み返しの材料が答えにある：部品の日本語名（油圧ポンプ）',
                run: async (_page, st) => (/油圧ポンプ/.test(JSON.stringify(st.sets ?? {})) ? true : '組は SGBD のドイツ語の名前だけ（HYDROPUMPE）。日本語の名前が無い'),
            },
        },
        {
            check: {
                desc: '手順 1：読み返しの材料が答えにある：動かす秒数と、前提（停車・12 V 以上）。始める前に分かる',
                run: async (page, st) => {
                    const c = await ask(page, st, 'monitoring_catalog', { module: 'smg2', query: JOB });
                    const job = (c.jobs ?? []).find((j) => j.job === JOB);
                    const s = JSON.stringify({ sets: st.sets, job });
                    const why = [];
                    if (!/stopsByItselfAfterS|timeoutS|seconds/.test(s)) why.push('止まるまでの秒数は、始めたあとの答え（stopsByItselfAfterS）にしか無い');
                    if (!(job?.preconditions ?? []).includes('stationary')) why.push('停車が前提に無い');
                    if (!/12\s*V|12 V|"minV":\s*12/.test(s)) why.push(`電圧は「${(job?.preconditions ?? []).find((p) => /volt/.test(p))}」だけで、12 V の数が無い`);
                    return why.length ? why.join('。') : true;
                },
            },
        },
        // 2. 「いいよ」
        { say: 'いいよ' },
        {
            check: {
                desc: '手順 2：AI が動かす。答えに「始めた」と「10 秒で止まる」',
                run: async (page, st) => {
                    st.t2 = Date.now();
                    const r = await ask(page, st, 'monitoring_actuate', { module: 'smg2', job: JOB, phase: 'start', owner_said: 'いいよ', values: SET });
                    st.run1 = r;
                    if (r.started !== true || r.on !== true) return `始まらない：${JSON.stringify(r).slice(0, 200)}`;
                    return r.stopsByItselfAfterS === 10 ? true : `止まるまで ${r.stopsByItselfAfterS} 秒（合格は 10 秒）`;
                },
            },
        },
        { wait: 800 },
        {
            check: {
                desc: '手順 2：始めの電文が車に届き、ナビが ACTUATOR に切り替わって動作中が出る',
                run: async (page, st) => {
                    const heard = await wire(page, st.t2);
                    const s = await ask(page, st, 'monitoring_status');
                    const t = await rowText(row(page)).catch(() => '');
                    const why = [];
                    if (!heard.some((h) => START_FRAME.test(h))) why.push('始めの電文が無い');
                    if (s.screen !== 'actuator') why.push(`画面は ${s.screen}`);
                    if (!t.includes('作動中')) why.push('動作中が出ない');
                    return why.length ? why.join('、') : true;
                },
            },
        },
        {
            check: {
                desc: '手順 2：ナビの動作中の表示に、何が（油圧ポンプ）・残り秒数・STOP が見える（U4）',
                run: async (page) => {
                    const t = await screenText(page);
                    const r = await rowText(row(page)).catch(() => '');
                    const why = [];
                    if (!/油圧ポンプ|HYDROPUMPE/.test(r)) why.push('何が動いているかが行に無い');
                    if (!/残り\s*\d+\s*秒/.test(t)) why.push('残り秒数が無い');
                    // STOP is the hub's ring while something is on (UX-01): at the head unit's width too.
                    if (!(await page.locator('[data-test="tj-stop"]:visible').isEnabled().catch(() => false))) why.push('STOP が押せない');
                    return why.length ? why.join('、') : true;
                },
            },
        },
        { shot: 's02-running' },
        // 3. 3 秒後に「止めて」
        { wait: 2200 },
        { say: '止めて' },
        {
            check: {
                desc: '手順 3：読み返さずにすぐ止まる：止めの電文が届き、答えが止めたものを言う',
                run: async (page, st) => {
                    const t0 = Date.now();
                    const r = await ask(page, st, 'monitoring_stop_outputs');
                    const ms = Date.now() - t0;
                    const heard = await wire(page, t0);
                    const why = [];
                    if (!(r.stopped ?? []).includes(JOB)) why.push(`答え：${JSON.stringify(r)}`);
                    if (!heard.some((h) => STOP_FRAME.test(h))) why.push('止めの電文が無い');
                    if (ms > 1500) why.push(`止まるまで ${ms} ms`);
                    return why.length ? why.join('、') : true;
                },
            },
        },
        { wait: 600 },
        {
            check: {
                desc: '手順 3：画面の動作中が消え、「止まった」が残る（U4）',
                run: async (page) => {
                    const r = await rowText(row(page));
                    const t = await screenText(page);
                    const why = [];
                    if (r.includes('作動中')) why.push('作動中のまま');
                    if (!/止まりました|止めました|停止しました|止まった/.test(t)) why.push('「止まった」が出ない');
                    return why.length ? why.join('、') : true;
                },
            },
        },
        { shot: 's03-stopped' },
        // 4. 「一回だけ動かして」
        { say: '一回だけ動かして' },
        {
            check: {
                desc: '手順 4：一回だけ（pulse）でも、手順 1〜2 と同じに動く（止めの支度つき）',
                run: async (page, st) => {
                    st.t4 = Date.now();
                    const r = await ask(page, st, 'monitoring_actuate', { module: 'smg2', job: JOB, phase: 'pulse', owner_said: '一回だけ動かして。いいよ', values: SET });
                    st.run2 = r;
                    const heard = await wire(page, st.t4);
                    if (r.started !== true || r.on !== true) return `始まらない、または止めの支度が無い：${JSON.stringify(r).slice(0, 200)}`;
                    return heard.some((h) => START_FRAME.test(h)) ? true : '始めの電文が無い';
                },
            },
        },
        { shot: 's04-pulse' },
        {
            check: {
                desc: '手順 4：10 秒で自分で止まり、止めの電文が届き、画面に「時間切れで止まった」',
                run: async (page, st) => {
                    const off = await untilOff(page, st.t4);
                    const heard = await wire(page, st.t4);
                    const t = await screenText(page);
                    const why = [];
                    if (off === null) why.push('75 秒たっても止まらない');
                    else if (off > 12000) why.push(`止まったのは ${Math.round(off / 1000)} 秒後（合格は 10 秒）`);
                    if (!heard.some((h) => STOP_FRAME.test(h))) why.push('止めの電文が無い');
                    if (!/時間切れ/.test(t)) why.push('「時間切れで止まった」が出ない');
                    return why.length ? why.join('、') : true;
                },
            },
        },
        { shot: 's04-timed-out' },
        noVin,
    ]),
};

export default scenario;
