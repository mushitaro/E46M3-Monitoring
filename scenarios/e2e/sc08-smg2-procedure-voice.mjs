import { always, bodyText, dialogText, onModule, tool, until } from './_owner.mjs';

/**
 * SC08（docs/VIRTUAL-CAR-TESTS.md M1）：SMG II の手順を声で。停車中に「クラッチの学習をして」→ AI が手順の名前・前提・時間を
 * 読み返して「いいよ」を待つ → 画面に手順のダイアログ、段階ごとの進み具合とオーナーがすること → 「完了」と結果、AI も同じ結果を言う。
 * ほかの 13 の手順も同じに。ギアを選ぶ手順は、AI が「何速ですか？」と聞く。
 * AI の言い回しそのものは声の予行で見る。ここでは、AI が言うべきことが道具の答えにあるかを見る。
 */

/** Runs one procedure the way the owner asks for it by voice, and follows its dialog to the end. */
async function runProcedure(page, p, gear) {
    // The owner does what the precondition asks of the engine (ENGINE on the screen is the practice car's key).
    await page.evaluate((on) => window.__monitoringE2E.car.set({ engineRunning: on }), p.engine === 'run');
    const t0 = Date.now();
    const r = await tool(page, 'monitoring_procedure', { procedure: p.procedure, owner_said: 'いいよ', ...(gear !== undefined ? { gear } : {}) });
    if (r?.started !== true) return { ok: false, why: `始まらない: ${r?.reason ?? JSON.stringify(r).slice(0, 160)}` };
    const shown = await until(page, async () => (await dialogText(page)).includes(p.nameJa), 3000, 100);
    const shownMs = Date.now() - t0;
    if (!shown) return { ok: false, why: 'ダイアログが出ない' };
    const progress = await until(page, async () => /経過/.test(await dialogText(page)) && /いま何をしているか/.test(await dialogText(page)), 4000, 200);
    const end = await until(page, async () => {
        const t = await dialogText(page);
        return /正常に終了しました|正常には終了しませんでした|中止しました/.test(t) ? t : null;
    }, 60000, 500);
    const why = [];
    if (shownMs > 1500) why.push(`ダイアログまで ${shownMs} ms`);
    if (!progress) why.push('段階ごとの進み具合（経過・いま何をしているか）が出ない');
    if (!end) why.push('終わらない');
    else if (!/正常に終了しました/.test(end)) why.push(`正常に終わらない: ${end.replace(/\n/g, ' ').slice(0, 160)}`);
    const close = page.locator('[role=dialog] button:has-text("CLOSE")');
    if (await close.count()) await close.first().click();
    await page.waitForTimeout(400);
    return { ok: why.length === 0, why: why.join('、'), end };
}

const scenario = {
    id: 'SC08',
    title: 'SMG II の手順（声）：クラッチの学習 → ほかの 13 の手順も',
    story:
        '停車中にオーナーが声で「クラッチの学習をして」と頼む。AI は手順の名前・前提（手順のデータが持つもの：エンジンの状態など）・時間を読み返し、「いいよ」を待つ。' +
        '「いいよ」で画面に手順のダイアログが開き、段階ごとに進み具合とオーナーがすることが出る。最後に「完了」と結果が出て、「どうだった？」に AI が同じ結果を言う。' +
        'ほかの 13 の手順も同じに通る。ギアを選ぶ手順は、AI が「何速ですか？」と聞く。',
    car: { speedKmh: 0 },
    steps: always([
        { ui: 'module', value: 'smg2', means: 'SMG II を選ぶ' },
        { ui: 'practice' },
        { ui: 'click', text: 'CONNECT', settle: 2500, means: '人が画面で PRACTICE につなぐ（停車中）' },
        { say: 'クラッチの学習をして' },
        {
            ai: 'monitoring_catalog',
            args: { module: 'smg2', query: 'クラッチ' },
            means: 'AI が読み返す材料：手順の名前（日本語）・前提（手順のデータが持つもの：エンジンの状態など）・時間',
            expect: (r) => {
                const p = (r?.procedures ?? []).find((x) => x.procedure === '0x02');
                if (!p) return `クラッチ食いつき点の学習が無い: ${JSON.stringify(r?.procedures ?? r).slice(0, 200)}`;
                const why = [];
                if (!p.nameJa) why.push('日本語の名前が無い');
                if (!p.longest) why.push('時間が無い');
                if (p.engine !== 'run' || !(p.preconditions ?? []).some((x) => /engine running|エンジン始動/i.test(x))) why.push('前提にエンジン始動が無い');
                if (!(p.preconditions ?? []).length) why.push('前提が無い（読み返す材料が無い）');
                return why.length ? why.join('、') : true;
            },
        },
        {
            ai: 'monitoring_procedure',
            args: { procedure: '0x02', owner_said: '' },
            means: '「いいよ」の前には始めない',
            expect: (r) => (r?.started === false ? true : `「いいよ」なしで始まった: ${JSON.stringify(r).slice(0, 160)}`),
        },
        { screen: { desc: 'まだダイアログは出ていない', hasNot: ['手順: クラッチ食いつき点の学習'] } },
        { say: 'いいよ' },
        {
            check: {
                desc: '画面に手順のダイアログ（1 秒以内）。段階ごとの進み具合と、オーナーがすること（ブレーキを踏むなど）が出る',
                run: async (page, st) => {
                    await page.evaluate(() => window.__monitoringE2E.car.set({ engineRunning: true }));
                    const t0 = Date.now();
                    const r = await tool(page, 'monitoring_procedure', { procedure: '0x02', owner_said: 'いいよ' });
                    if (r?.started !== true) return `始まらない: ${JSON.stringify(r).slice(0, 200)}`;
                    const open = await until(page, async () => (await dialogText(page)).includes('クラッチ食いつき点の学習'), 3000, 100);
                    if (!open) return 'ダイアログが出ない';
                    const ms = Date.now() - t0;
                    await page.waitForTimeout(1200);
                    const text = await dialogText(page);
                    st.sc08running = text;
                    const why = [];
                    if (ms > 1000) why.push(`ダイアログまで ${ms} ms`);
                    if (!/経過/.test(text) || !/いま何をしているか/.test(text)) why.push('進み具合が無い');
                    if (!/ブレーキ|踏んで|してください/.test(text)) why.push('オーナーがすること（ブレーキを踏むなど）が出ない');
                    return why.length ? why.join('、') : true;
                },
            },
        },
        { shot: 's02-dialog' },
        {
            check: {
                desc: '最後まで待つ：「完了」（正常に終了しました）と結果が出る',
                run: async (page, st) => {
                    const end = await until(page, async () => {
                        const t = await dialogText(page);
                        return /正常に終了しました|正常には終了しませんでした|中止しました/.test(t) ? t : null;
                    }, 30000, 500);
                    st.sc08end = end;
                    if (!end) return '終わらない';
                    return /正常に終了しました/.test(end) && /結果/.test(end) ? true : end.replace(/\n/g, ' ').slice(0, 200);
                },
            },
        },
        { shot: 's03-done' },
        { say: 'どうだった？' },
        {
            check: {
                desc: 'AI の道具の答えに、いま終わった手順の名前と結果（正常に終了）がある（画面と同じ）',
                run: async (page) => {
                    const answers = { status: await tool(page, 'monitoring_status'), sessions: await tool(page, 'monitoring_sessions'), overview: await tool(page, 'monitoring_run_overview') };
                    const s = JSON.stringify(answers);
                    return /0x02|bite|食いつき/i.test(s) && /finished|completed|正常|ok/i.test(s) ? true : '手順の結果を返す道具が無い（status・sessions・run_overview のどれにも無い）';
                },
            },
        },
        {
            check: {
                desc: 'ダイアログを閉じる',
                run: async (page) => {
                    const close = page.locator('[role=dialog] button:has-text("CLOSE")');
                    if (await close.count()) await close.first().click();
                    await page.waitForTimeout(400);
                    return true;
                },
            },
        },
        {
            check: {
                desc: 'U2：前提が合わないとき（エンジンが回っているのに「エンジン停止」の手順）、ダイアログが理由と、どうすれば動くかを言う',
                run: async (page) => {
                    await page.evaluate(() => window.__monitoringE2E.car.set({ engineRunning: true }));
                    const r = await tool(page, 'monitoring_procedure', { procedure: '0x03', owner_said: 'いいよ' });
                    if (r?.started === false) return /engine|エンジン/i.test(r.reason ?? '') ? true : `理由が違う: ${r.reason}`;
                    const end = await until(page, async () => {
                        const t = await dialogText(page);
                        return /正常に終了しました|正常には終了しませんでした|中止しました|エンジン/.test(t) ? t : null;
                    }, 10000, 300);
                    const close = page.locator('[role=dialog] button:has-text("CLOSE")');
                    const text = end ?? '';
                    if (await close.count()) await close.first().click();
                    await page.waitForTimeout(400);
                    return /エンジンを(止め|切)/.test(text) ? true : `理由が出ない: ${text.replace(/\n/g, ' ').slice(0, 200)}`;
                },
            },
        },
        { say: 'ほかの手順も同じにやって' },
        {
            check: {
                desc: 'ギアを選ぶ手順（0x0A）：ギアを言わずに頼むと、AI が「何速ですか？」と聞ける答えが返る（始めない）',
                run: async (page) => {
                    await page.evaluate(() => window.__monitoringE2E.car.set({ engineRunning: false }));
                    const r = await tool(page, 'monitoring_procedure', { procedure: '0x0A', owner_said: 'いいよ' });
                    if (r?.started === true) {
                        await tool(page, 'monitoring_stop_outputs');
                        await page.waitForTimeout(1500);
                        const close = page.locator('[role=dialog] button:has-text("CLOSE")');
                        if (await close.count()) await close.first().click();
                        return 'ギアを聞かずに始まった';
                    }
                    return /gear|ギア/i.test(r?.reason ?? '') ? true : `理由が違う: ${r?.reason}`;
                },
            },
        },
        {
            check: {
                desc: '14 本とも：始まり → ダイアログ（1 秒以内）→ 進み具合 → 正常に終了',
                run: async (page, st) => {
                    const off = await onModule(page, 'smg2');
                    if (off) return off;
                    const cat = await tool(page, 'monitoring_catalog', { module: 'smg2', kind: 'calibration', limit: 40 });
                    const all = cat?.procedures ?? [];
                    if (all.length !== 14) return `手順が ${all.length} 本`;
                    const bad = [];
                    for (const p of all) {
                        const r = await runProcedure(page, p, p.takesGear ? '1' : undefined);
                        if (!r.ok) bad.push(`${p.procedure} ${p.nameJa}: ${r.why}`);
                    }
                    st.sc08bad = bad;
                    return bad.length ? `${14 - bad.length}/14 本。${bad.join(' / ')}` : true;
                },
            },
        },
        { shot: 's04-all' },
        {
            check: {
                desc: 'U8：画面にも AI の答えにも VIN が出ない',
                run: async (page) => {
                    const s = JSON.stringify(await tool(page, 'monitoring_status')) + (await bodyText(page));
                    return s.includes('JR12345') ? 'VIN が出ている' : true;
                },
            },
        },
    ]),
};

export default scenario;
