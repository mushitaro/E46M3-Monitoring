import { NAVI, all, ask, faultsByAddress, inView, noVin, openNavi, pressAndTime, scanRows, screenText, waitScan } from './_sc01-07.mjs';

/**
 * SC01 はじめてつなぐ（ナビ）。docs/VIRTUAL-CAR-TESTS.md M1。
 * 練習の車は既定の後期 E46 M3（DME に 2 件、DSC MK60 に 1 件、ほかは故障なし）。
 */
const scenario = {
    id: 'SC01',
    title: 'はじめてつなぐ（ナビ）：開く → PRACTICE でつなぐ → 全モジュールを読む → 声で「今どうなってる？」',
    story:
        'オーナーがナビで MONITORING を初めて開く。何をすればよいかが一行で分かり、PRACTICE でつなぎ、全モジュールを読む。' +
        '載っているモジュールが日本語の名前で並び、最後に「n モジュール、故障 m 件」。声で聞くと、AI が画面と同じ数で答える。',
    viewport: NAVI,
    steps: all([
        // 1. ナビで MONITORING を開く
        openNavi(),
        { shot: 's01-open' },
        {
            check: {
                desc: '手順 1：MANUAL の画面で開き（運営者 2026-11-02）、何をすればよいかが一行で書いてある（PRACTICE を入れて CONNECT、または実車で CONNECT）',
                run: async (page) => {
                    const t = await screenText(page);
                    const manual = (await page.locator('button[data-mode="manual"][aria-pressed="true"]').count()) > 0;
                    const oneLine = t.split('\n').some((l) => /PRACTICE/.test(l) && /CONNECT/.test(l) && /(押|選|して|ください)/.test(l));
                    if (manual && oneLine) return true;
                    return `${manual ? '' : 'MANUAL で開いていない。'}${oneLine ? '' : '何をすればよいかの一行が無い。'}画面：${t.split('\n').slice(0, 8).join(' / ')}`;
                },
            },
        },
        // 2. PRACTICE を押し、CONNECT
        { ui: 'practice', means: 'PRACTICE を入れる' },
        {
            check: {
                desc: '手順 2：CONNECT を押すと 1 秒以内に画面が変わる（U1）',
                run: async (page) => {
                    const ms = await pressAndTime(page, page.locator('button:visible:has-text("CONNECT")').last());
                    await page.waitForTimeout(2000);
                    return ms !== null && ms <= 1000 ? true : `変わるまで ${ms ?? '3000 ms 以上'} ms`;
                },
            },
        },
        { shot: 's02-connected' },
        {
            check: {
                desc: '手順 2：「PRACTICE」と接続中の印、選んでいるモジュールの名前が見える',
                run: async (page) => {
                    const dot = await page.locator('header span.rounded-full[title]').first().getAttribute('title').catch(() => null);
                    const practice = await inView(page, 'PRACTICE');
                    const connected = await inView(page, 'CONNECTED');
                    const moduleName = await page.locator('select:has(option[value="mss54"])').first().evaluate((s) => s.options[s.selectedIndex]?.text ?? '');
                    const why = [];
                    if (!practice) why.push('「PRACTICE」が見えない');
                    if (!connected) why.push('接続中の文字が見えない');
                    if (!dot || /未接続|DISCONNECTED/i.test(dot)) why.push(`ヘッダの印が接続中でない（${dot}）`);
                    if (!moduleName) why.push('モジュールの名前が無い');
                    return why.length ? why.join('、') : true;
                },
            },
        },
        {
            check: {
                desc: '手順 2：ヘッダに「PRACTICE」の文字がある（M1 の合格の文言どおり）',
                run: async (page) => {
                    const h = await page.locator('header').first().innerText();
                    return /PRACTICE|練習/.test(h) ? true : `ヘッダの文字：${h.replace(/\n/g, ' ')}`;
                },
            },
        },
        // 3. ALL MODULES で読む
        {
            check: {
                desc: '手順 3：ALL MODULES のまま READ を押すと 1 秒以内に読み始め、進み具合が出る',
                run: async (page, st) => {
                    const ms = await pressAndTime(page, page.locator('button:visible:has-text("READ")').last());
                    await page.waitForTimeout(400);
                    const t = await screenText(page);
                    st.progress = /読取中\s*\d+\s*\/\s*\d+/.exec(t)?.[0] ?? null;
                    if (ms === null || ms > 1000) return `変わるまで ${ms ?? '3000 ms 以上'} ms`;
                    return st.progress ? true : '進み具合（読取中 n / N）が出ない';
                },
            },
        },
        { shot: 's03-reading' },
        {
            check: {
                desc: '手順 3：読み終わる',
                run: async (page, st) => {
                    st.scan = await waitScan(page);
                    await page.waitForTimeout(600);
                    return st.scan?.end === 'done' ? true : `終わらない：${JSON.stringify(st.scan)}`;
                },
            },
        },
        { shot: 's03-read' },
        {
            check: {
                desc: '手順 3：載っていないモジュールは「応答なし」',
                run: async (page) => {
                    const rows = await scanRows(page);
                    const silent = ['0x08', '0x9C', '0xED'].filter((a) => rows[a]?.tag !== '応答なし');
                    return silent.length ? `応答なしでない：${silent.map((a) => `${a} ${rows[a]?.tag}`).join(', ')}` : true;
                },
            },
        },
        {
            check: {
                desc: '手順 3：載っているモジュールは、IDENT が決めた一つの日本語の名前で並ぶ（候補の羅列でない）',
                run: async (page) => {
                    const rows = await scanRows(page);
                    const listed = Object.entries(rows).filter(([, r]) => r.tag !== '応答なし' && r.tag !== '送らない');
                    // A name may itself hold ' / ' in its parentheses (「MSS54 (S54 / E46 M3 エンジン)」): one name, not a list.
                    const many = listed.filter(([, r]) => r.name.replace(/\([^)]*\)/g, '').includes(' / ')).map(([a, r]) => `${a} ${r.name}`);
                    const english = listed.filter(([, r]) => !/[ぁ-んァ-ヶ一-龠]/.test(r.name) && !/^(DSC MK60|DSC \(E46\)|SMG II.*)$/.test(r.name)).map(([a, r]) => `${a} ${r.name}`);
                    const why = [];
                    if (many.length) why.push(`候補が並んだまま（${many.length} 行）：${many.slice(0, 4).join(' | ')}`);
                    if (english.length) why.push(`日本語でない：${english.join(' | ')}`);
                    return why.length ? why.join('。') : true;
                },
            },
        },
        {
            check: {
                desc: '手順 3：練習の車で故障の無いモジュールは「故障なし」（GM5・DSC が「未解読」でない）',
                run: async (page) => {
                    const rows = await scanRows(page);
                    const bad = Object.entries(rows)
                        .filter(([a]) => !['0x12', '0xB8'].includes(a))
                        .filter(([, r]) => !['故障なし', '応答なし', '送らない', '故障読取なし（SGBD に無い）'].includes(r.tag))
                        .map(([a, r]) => `${a} ${r.name.slice(0, 24)}：${r.tag}`);
                    return bad.length ? bad.join(' | ') : true;
                },
            },
        },
        {
            check: {
                desc: '手順 3：最後に「n モジュール、故障 m 件」が出る（応答したモジュールの数と、故障の合計）',
                run: async (page, st) => {
                    const t = await screenText(page);
                    const rows = await scanRows(page);
                    st.screenFaults = Object.values(rows).reduce((s, r) => s + Number(/故障 (\d+)/.exec(r.tag)?.[1] ?? 0), 0);
                    const m = /(\d+)\s*モジュール[^\n]{0,12}故障\s*(\d+)\s*件/.exec(t);
                    if (!m) return `まとめの一行が無い（画面の頭：${t.split('\n').slice(3, 7).join(' / ')}）。一覧の故障の合計は ${st.screenFaults} 件`;
                    return Number(m[1]) === st.scan?.counts?.answered && Number(m[2]) === st.screenFaults ? true : `まとめ「${m[0]}」が一覧（応答 ${st.scan?.counts?.answered}、故障 ${st.screenFaults}）と違う`;
                },
            },
        },
        { ui: 'click', text: 'VISU', settle: 600, means: 'VISU も見る' },
        { shot: 's03-visu' },
        { ui: 'click', text: 'LIST', settle: 400 },
        // 4. 声で「今どうなってる？」
        { say: '今どうなってる？' },
        {
            check: {
                desc: '手順 4：AI の答えに、練習モード・接続中・全モジュール・故障の数が、画面と同じ数で入っている（言い方は声の稽古で確かめる）',
                run: async (page, st) => {
                    const s = await ask(page, st, 'monitoring_status');
                    const f = await ask(page, st, 'monitoring_faults');
                    const byAddr = faultsByAddress(f);
                    const total = Object.values(byAddr).reduce((a, b) => a + b, 0);
                    const why = [];
                    if (s.practice !== true) why.push('practice でない');
                    if (s.link !== 'connected') why.push(`link ${s.link}`);
                    if (!s.module?.all) why.push(`module ${JSON.stringify(s.module)}`);
                    if (s.scan?.counts?.answered !== st.scan?.counts?.answered) why.push('応答の数が画面と違う');
                    if (total !== st.screenFaults) why.push(`故障の合計：答え ${total}、画面 ${st.screenFaults}`);
                    return why.length ? why.join('、') : true;
                },
            },
        },
        noVin,
        { shot: 's04-end' },
        // 5. 一覧から一つを開く（UX-23：OPEN のサブアクションは消え、行の名前を押す）
        {
            check: {
                desc: '手順 5：全モジュールの一覧で SMG II の行の名前を押すと、DISCONNECT → CONNECT で SMG II が画面に出る（OPEN と同じ道）',
                run: async (page) => {
                    const name = page.locator('button[title$="を画面に出す"]', { hasText: 'SMG' }).first();
                    if ((await name.count()) === 0) return 'SMG II の行の名前が押せない';
                    await name.click();
                    let s = null;
                    for (let i = 0; i < 40; i++) {
                        await page.waitForTimeout(250);
                        s = await page.evaluate(() => window.__monitoringE2E.tool('monitoring_status'));
                        if (s?.module?.id === 'smg2' && s.link === 'connected' && s.showing === 'module') break;
                    }
                    if (s?.module?.id !== 'smg2' || s.showing !== 'module') return `画面は ${JSON.stringify(s?.module)}・${s?.showing}`;
                    return s.link === 'connected' ? true : `つながっていない（${s.link}）`;
                },
            },
        },
        { shot: 's05-opened' },
    ]),
};

export default scenario;
