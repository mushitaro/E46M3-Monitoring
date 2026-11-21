import { all, ask, pressAndTime, rowOf, rowText, screenText, wire } from './_sc01-07.mjs';

/**
 * SC06 部品を動かす（画面）— SMG II の油圧ポンプ。docs/VIRTUAL-CAR-TESTS.md M1。
 * テスト用のビルドは実車につながらない。実車モードでつながっていない画面で札を見て、PRACTICE で動かし、
 * 実車モードに戻って札が消えるかを見る。実車で START → 実行（手順 7）は実車のみ（FINDINGS に書く）。
 * 時間切れで止まるところは、PRACTICE で確かめる。
 */
const JOB = 'STEUERN_STELLGLIED';
const SET = 'HYDROPUMPE · AKTIV · 0';
const START_FRAME = /^32 07 0c 05 01 00 3d$/;
const STOP_FRAME = /^32 07 0c 05 00 00 3c$/;

const row = (page) => rowOf(page, JOB, 'tj-start');

const scenario = {
    id: 'SC06',
    title: '部品を動かす（画面）：SMG II の油圧ポンプ — 「練習から」→ PRACTICE で値を選んで START → 確認 → 動作中 → STOP → 実車モードで札が消える',
    story:
        '実車モード・停車で SMG II の ACTUATOR を開くと、油圧ポンプの行に「練習から」。PRACTICE にして値を選び、START の確認に何が動くか・前提・秒数が出る。' +
        '実行すると「動作中 残り n 秒」と STOP、結果欄に送信と応答。STOP で「止まった」。実車モードに戻ると札が消え、START が押せる。実車では測ってから動き、時間切れで止まる。',
    steps: all([
        // 1. 実車モード・停車で、SMG II の ACTUATOR を開く
        { ui: 'module', value: 'smg2', means: 'SMG II を選ぶ（実車モード：PRACTICE は入れない）' },
        { ui: 'tab', name: 'ACTUATOR', settle: 1500 },
        {
            check: {
                desc: '手順 1：油圧ポンプを選ぶと、行に「練習から」の札、START は押せない',
                run: async (page) => {
                    const r = row(page);
                    for (let i = 0; i < 20 && (await r.locator('select').count()) === 0; i++) await page.waitForTimeout(250);
                    await r.locator('select').selectOption({ label: SET });
                    await page.waitForTimeout(400);
                    const t = await rowText(r);
                    const disabled = await r.locator('[data-test="tj-start"]').isDisabled();
                    return t.includes('練習から') && disabled ? true : `札：${t.replace(/\n/g, ' / ')}、START ${disabled ? '押せない' : '押せる'}`;
                },
            },
        },
        { shot: 's01-practice-first' },
        {
            check: {
                desc: '手順 1：「練習から」に触ると「PRACTICE でこの項目を一度実行してください」と出る（U2）',
                run: async (page) => {
                    const chip = row(page).getByText('練習から').first();
                    const title = (await chip.getAttribute('title')) ?? (await chip.locator('xpath=ancestor-or-self::*[@title][1]').getAttribute('title').catch(() => null));
                    await chip.click();
                    await page.waitForTimeout(600);
                    const t = await screenText(page);
                    return t.includes('PRACTICE でこの項目を一度実行してください') ? true : `触っても画面に説明が出ない（マウスを重ねたときの title だけ：「${title}」。ナビは触るだけでマウスが無い）`;
                },
            },
        },
        { shot: 's01-chip-touched' },
        // 2. PRACTICE にして、値を選ぶ
        { ui: 'practice' },
        { ui: 'click', text: 'CONNECT', settle: 2500, means: '練習の車につなぐ' },
        { ui: 'tab', name: 'ACTUATOR', settle: 800 },
        {
            check: {
                desc: '手順 2：選ぶまで START は押せない',
                run: async (page) => {
                    const r = row(page);
                    await r.locator('select').selectOption({ index: 0 });
                    await page.waitForTimeout(300);
                    return (await r.locator('[data-test="tj-start"]').isDisabled()) ? true : 'START が押せる';
                },
            },
        },
        {
            check: {
                desc: '手順 2：選べるものが部品の名前で並ぶ（番号ではない）',
                run: async (page) => {
                    const labels = await row(page).locator('select option').allTextContents();
                    if (!labels.includes(SET)) return `「${SET}」が無い`;
                    return labels.some((l) => /0x[0-9A-F]{2}/i.test(l)) ? 'PIN の番号が混じる' : true;
                },
            },
        },
        {
            check: {
                desc: '手順 2：部品の名前が日本語で読める（「油圧ポンプ」。HYDROPUMPE のままでない）',
                run: async (page) => {
                    const labels = await row(page).locator('select option').allTextContents();
                    const n = labels.length - 1;
                    return labels.some((l) => l.includes('油圧ポンプ')) ? true : `${n} 個の組がすべて SGBD のドイツ語（${labels.slice(1, 3).join(' | ')} …）`;
                },
            },
        },
        // 3. START
        {
            check: {
                desc: '手順 3：値を選んで START、1 秒以内に確認が出る（U1）',
                run: async (page, st) => {
                    const r = row(page);
                    await r.locator('select').selectOption({ label: SET });
                    await page.waitForTimeout(300);
                    const ms = await pressAndTime(page, r.locator('[data-test="tj-start"]'));
                    await page.locator('[role=dialog]').first().waitFor({ timeout: 3000 });
                    st.dialog = await page.locator('[role=dialog]').first().innerText();
                    return ms !== null && ms <= 1000 ? true : `${ms} ms`;
                },
            },
        },
        { shot: 's03-confirm' },
        {
            check: {
                desc: '手順 3：確認に、何が動くか（油圧ポンプ）が出る',
                run: async (_page, st) => (/油圧ポンプ/.test(st.dialog ?? '') ? true : `確認：${(st.dialog ?? '').slice(0, 200)}`),
            },
        },
        {
            check: {
                desc: '手順 3：確認に、前提（停車・12 V 以上）が出る',
                run: async (_page, st) => {
                    const d = st.dialog ?? '';
                    const why = [];
                    if (!/停車/.test(d)) why.push('停車が無い');
                    if (!/12\s*V/.test(d)) why.push('「12 V 以上」が無い（「電圧」だけ）');
                    return why.length ? why.join('、') : true;
                },
            },
        },
        {
            check: {
                desc: '手順 3：確認に、止まるまでの秒数（このアプリが自分で止めるまで）が出る',
                run: async (_page, st) => {
                    const d = st.dialog ?? '';
                    return /\d+\s*秒(後|で|たつと)[^。\n]{0,8}止/.test(d) ? true : 'アプリが止めるまでの秒数が無い（SGBD の「最大60秒」「タイムアウト10秒」の文はある）';
                },
            },
        },
        {
            check: {
                desc: '手順 3：確認の読む順が「何が → いつまで → 押すと何が起きる」（D3-3）。何が（油圧ポンプ）が電文より先',
                run: async (_page, st) => {
                    const d = st.dialog ?? '';
                    const what = d.indexOf('油圧ポンプ');
                    const frame = d.search(/32 07 0c/);
                    return what >= 0 && (frame < 0 || what < frame) ? true : '電文（32 07 0c …）と SGBD の呼び出しが、何が動くかより先に出る';
                },
            },
        },
        // 4. 実行
        {
            check: {
                desc: '手順 4：実行すると、始めの電文が車に届き、動作中になる',
                run: async (page, st) => {
                    const dialog = page.locator('[role=dialog]').first();
                    for (const box of await dialog.locator('input[type=checkbox]').all()) await box.check();
                    st.t0 = Date.now();
                    await page.locator('[data-test="gate-run"]').click();
                    await page.waitForTimeout(1200);
                    const heard = await wire(page, st.t0);
                    const t = await rowText(row(page));
                    if (!heard.some((h) => START_FRAME.test(h))) return `始めの電文が無い：${heard.join(' | ')}`;
                    return t.includes('作動中') ? true : `行：${t.replace(/\n/g, ' / ')}`;
                },
            },
        },
        { shot: 's04-running' },
        {
            check: {
                desc: '手順 4：「動作中 残り n 秒」と STOP が見える（U4：何が・残り秒数・STOP）',
                run: async (page) => {
                    const t = await screenText(page);
                    const why = [];
                    if (!/残り\s*\d+\s*秒/.test(t)) why.push('残り秒数が無い');
                    // STOP is the hub's ring while something is on (UX-01); the row says 作動中.
                    if (!(await page.locator('[data-test="tj-stop"]').isEnabled())) why.push('STOP が押せない');
                    if (!(await rowText(row(page))).includes('作動中')) why.push('行が作動中と言わない');
                    if (!/油圧ポンプ|HYDROPUMPE/.test(await rowText(row(page)))) why.push('何が動いているか（油圧ポンプ）が行に無い（選択は「値を選ぶ」に戻る）');
                    return why.length ? why.join('、') : true;
                },
            },
        },
        {
            check: {
                desc: '手順 4：結果欄に「送信」「応答 OK」',
                run: async (page) => {
                    const t = await screenText(page);
                    return /送信/.test(t) && /応答/.test(t) ? true : '結果欄（送信・応答）が出ない';
                },
            },
        },
        // 5. STOP
        {
            check: {
                desc: '手順 5：STOP で止めの電文が届き、動作中の表示が消える',
                run: async (page, st) => {
                    const t0 = Date.now();
                    const before = await row(page).locator('[data-test="tj-start"]').boundingBox();
                    await page.locator('[data-test="tj-stop"]').click();
                    await page.waitForTimeout(1200);
                    st.afterStop = await screenText(page);
                    const after = await row(page).locator('[data-test="tj-start"]').boundingBox();
                    const heard = await wire(page, t0);
                    const why = [];
                    if (!heard.some((h) => STOP_FRAME.test(h))) why.push(`止めの電文が無い：${heard.join(' | ')}`);
                    if ((await rowText(row(page))).includes('作動中')) why.push('作動中のまま');
                    if (before && after && (Math.abs(before.x - after.x) > 1 || Math.abs(before.y - after.y) > 1)) why.push(`START の位置が動いた（U7）：${JSON.stringify([before, after])}`);
                    return why.length ? why.join('、') : true;
                },
            },
        },
        {
            check: {
                desc: '手順 5：「止まった」と出る（U4：止まったら「止まった」が残る）',
                run: async (_page, st) => (/止まりました|止めました|停止しました|止まった/.test(st.afterStop ?? '') ? true : '「止まった」が出ない（「作動中のものはありません」だけ）'),
            },
        },
        { shot: 's05-stopped' },
        // 時間切れ（PRACTICE で確かめる）
        {
            check: {
                desc: '手順 7（PRACTICE で）：もう一度動かすと、自分で止まり「時間切れで止まった」と出る（合格は 10 秒）',
                run: async (page) => {
                    const r = row(page);
                    await r.locator('select').selectOption({ label: SET });
                    await r.locator('[data-test="tj-start"]').click();
                    const dialog = page.locator('[role=dialog]').first();
                    await dialog.waitFor({ timeout: 3000 });
                    for (const box of await dialog.locator('input[type=checkbox]').all()) await box.check();
                    const t0 = Date.now();
                    await page.locator('[data-test="gate-run"]').click();
                    let off = null;
                    while (Date.now() - t0 < 75000) {
                        await page.waitForTimeout(1000);
                        if (!(await rowText(r)).includes('作動中')) {
                            off = Date.now() - t0;
                            break;
                        }
                    }
                    const heard = await wire(page, t0);
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
        { shot: 's07-timeout' },
        // 6. 実車モードに戻る
        { ui: 'click', text: 'DISCONNECT', settle: 1500, means: '練習の車を離す' },
        { ui: 'practice', means: 'PRACTICE を外す（実車モード）' },
        { ui: 'tab', name: 'ACTUATOR', settle: 800 },
        {
            check: {
                desc: '手順 6：実車モードで同じ行の「練習から」の札が消える',
                run: async (page) => {
                    const r = row(page);
                    await r.locator('select').selectOption({ label: SET });
                    await page.waitForTimeout(400);
                    const t = await rowText(r);
                    return t.includes('練習から') ? `札が残る：${t.replace(/\n/g, ' / ')}` : true;
                },
            },
        },
        { shot: 's06-vehicle-mode' },
        {
            check: {
                desc: '台帳に「練習で動かした」が残る（AI からも読める）',
                run: async (page, st) => {
                    const l = await ask(page, st, 'monitoring_ledger', { module: 'smg2' });
                    const rec = (l.records ?? []).find((x) => x.id.startsWith('smg2:STEUERN_STELLGLIED'));
                    return rec ? true : `台帳に STEUERN_STELLGLIED が無い：${JSON.stringify(l).slice(0, 300)}`;
                },
            },
        },
    ]),
};

export default scenario;
