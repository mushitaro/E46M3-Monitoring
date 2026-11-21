import { NAVI, all, ask, carNow, connect, faultsByAddress, noVin, openNavi, scanRows, screenText, waitScan, wire } from './_sc01-07.mjs';

/**
 * SC02 警告灯が点いた（事後保全・声と画面）。docs/VIRTUAL-CAR-TESTS.md M1。
 * 車：走行中 40 km/h。DSC（運営者の車の DSC MK60）に 2 件、エンジン（MSS54）に 1 件。
 * MK60 の 0x5D8C は「今は無いが記録あり」（状態 0x24）、0x5D96 は「今出ている」（0x60）。
 */
const CAR = {
    speedKmh: 40,
    dmeFaults: [{ code: 0x2a, type: 0x08, frequency: 3 }],
    dscMk60: [
        { code: 0x5d8c, status: 0x24 },
        { code: 0x5d96, status: 0x60 },
    ],
};

/**
 * 画面の名前。MSS54 の 0x2A には読める日本語の名がある。MK60 の二つは表の日本語がドイツ語の混ざった半訳
 * （「センサ・Cluster・タイムアウトCAN」）なので、名前の位置には「故障（訳なし）」が出て、SGBD のドイツ語がその隣に出る
 * （UX-22、docs/UX-DESIGN.md §3：推し量った訳を本物の顔で出さない）。
 */
const JA = { '0x2A': '車速直接入力' };
const GERMAN = { '0x5D8C': 'Sensor-Cluster Timeout CAN', '0x5D96': 'Sensor-Cluster CAN Bus-Off' };
const HALF = /センサ・Cluster|Cluster・/;

const scenario = {
    id: 'SC02',
    title: '警告灯が点いた：走行中に読む → ナビで見る → 走行中は消せない → 停車して残してから消す',
    story:
        '40 km/h で走行中、DSC のランプが点く。オーナーが声で言うと、AI が全モジュールを読み、DSC に 2 件、エンジンに 1 件と、' +
        '一件ずつ名前と「今出ている／散発」を言う。ナビの DIAGNOSIS にも同じ 3 件が日本語の名前と記録時の条件つきで出る。走行中の「消して」は断られ、' +
        '画面の消去も押せない。停車して「消して」と言うと、AI が何が消えるかを読み返し、「残して、いいよ」で保存してから消し、読み直して 0 件。',
    viewport: NAVI,
    steps: all([
        openNavi(CAR),
        ...connect,
        // 1. 声で「DSC のランプが点いた」
        { say: 'DSC のランプが点いた' },
        {
            check: {
                desc: '手順 1：AI が走行中に全モジュールを読み、DSC に 2 件・エンジンに 1 件が答えに入る',
                run: async (page, st) => {
                    const r = await ask(page, st, 'monitoring_scan');
                    if (!r.started) return `読み始めない：${JSON.stringify(r).slice(0, 200)}`;
                    st.scan = await waitScan(page);
                    st.faults = await ask(page, st, 'monitoring_faults');
                    const n = faultsByAddress(st.faults);
                    return n['0xB8'] === 2 && n['0x12'] === 1 ? true : `DSC MK60 ${n['0xB8']} 件、DME ${n['0x12']} 件`;
                },
            },
        },
        {
            check: {
                desc: '手順 1：答えの一件ずつに、画面と同じ日本語の名前がある（AI が画面と同じ名前で言える。言い方は声の稽古で確かめる）',
                run: async (_page, st) => {
                    const s = JSON.stringify(st.faults ?? {});
                    const missing = Object.entries(JA).filter(([, ja]) => !s.includes(ja));
                    return missing.length ? `日本語の名前が答えに無い：${missing.map(([c, ja]) => `${c} ${ja}`).join('、')}（答えはドイツ語・英語の文）` : true;
                },
            },
        },
        {
            check: {
                desc: '手順 1：答えの一件ずつに、今出ているか散発かが、読める形である',
                run: async (_page, st) => {
                    const mods = st.faults?.faults?.scan?.modules ?? [];
                    const dme = mods.find((m) => m.address === '0x12')?.faults ?? [];
                    const mk60 = mods.find((m) => m.address === '0xB8')?.sgbdRead?.faults ?? [];
                    const why = [];
                    if (!dme.every((f) => typeof f.present === 'boolean' || /present|今|散発/.test(JSON.stringify(f)))) why.push(`DME：今か散発かの項目が無い（${JSON.stringify(dme[0]).slice(0, 120)}）`);
                    if (!mk60.every((f) => typeof f.present === 'boolean')) why.push(`DSC：今か散発かは SGBD のドイツ語の文だけ（${(mk60[0]?.kinds ?? []).join(' / ')}）`);
                    return why.length ? why.join('。') : true;
                },
            },
        },
        // 2. ナビを見る
        { shot: 's01-scan-moving' },
        {
            check: {
                desc: '手順 2：DIAGNOSIS に同じ 3 件（DSC 2、エンジン 1）',
                run: async (page) => {
                    const rows = await scanRows(page);
                    return rows['0xB8']?.tag === '故障 2' && rows['0x12']?.tag === '故障 1' ? true : `DSC MK60 ${rows['0xB8']?.tag}、DME ${rows['0x12']?.tag}`;
                },
            },
        },
        {
            check: {
                desc: '手順 2：一件ずつ開くと、日本語の名前と、その故障の SGBD が記録した条件（回転・負荷・車速・電圧など）が単位つきで読める',
                run: async (page, st) => {
                    await page.getByText('故障 1', { exact: true }).first().click();
                    await page.waitForTimeout(500);
                    await page.getByText('故障 2', { exact: true }).first().click();
                    await page.waitForTimeout(500);
                    const t = await screenText(page);
                    const why = [];
                    // Each fault reads as what it is: a Japanese name where there is one, else「故障（訳なし）」with the
                    // SGBD's German beside it — never the half-translation in the name's place.
                    const named = Object.entries(JA).filter(([, ja]) => t.includes(ja)).map(([c]) => c);
                    const german = Object.entries(GERMAN).filter(([, de]) => t.includes(de)).map(([c]) => c);
                    const untranslated = (t.match(/故障（訳なし）/g) ?? []).length;
                    if (named.length < 1) why.push('0x2A の日本語の名前が無い');
                    if (german.length < 2 || untranslated < 2) why.push(`DSC の二つが「故障（訳なし）」と SGBD のドイツ語で出ない（ドイツ語 ${german.join(', ') || 'なし'}、訳なし ${untranslated}）`);
                    if (HALF.test(t)) why.push('半訳（センサ・Cluster…）が名前の位置に出ている');
                    // The conditions each fault's own SGBD recorded with it, as the answer carries them (the DME's
                    // freeze frames; a module's own job's values that have a unit). Each must read on the screen
                    // with its unit. A fault whose SGBD records none (MK60's 0x18 read holds code and status only)
                    // has none to show.
                    const mods = st.faults?.faults?.scan?.modules ?? [];
                    const recorded = [];
                    for (const m of mods) {
                        for (const f of m.faults ?? []) for (const set of f.conditions ?? []) for (const c of set) if (c.unit) recorded.push(`${c.value} ${c.unit}`);
                        for (const f of m.sgbdRead?.faults ?? []) for (const v of f.values ?? []) if (v.unit && typeof v.value === 'number') recorded.push(`${v.value} ${v.unit}`);
                    }
                    if (recorded.length === 0) why.push('答えに記録した条件が一つも無い（DME の故障は回転・負荷・車速・電圧を記録する）');
                    // A value and its unit stand apart by a no-break space (ui.tsx UNIT_GAP).
                    const flat = t.replace(/[\s\u00a0]+/g, ' ');
                    const unseen = recorded.filter((x) => !flat.includes(x));
                    if (unseen.length) why.push(`記録した条件が単位つきで画面に無い：${unseen.slice(0, 6).join('、')}`);
                    return why.length ? why.join('。') : true;
                },
            },
        },
        { shot: 's02-detail' },
        // 3. 走行中に「消して」
        { say: '消して' },
        {
            check: {
                desc: '手順 3：走行中、AI の消去は送られず、答えの理由が「走行中」（止まってから消せる）',
                run: async (page, st) => {
                    const t0 = Date.now();
                    const r = await ask(page, st, 'monitoring_actuate', { module: 'mss54', job: 'FS_LOESCHEN', owner_said: '消して' });
                    const sent = (await wire(page, t0)).filter((h) => /^12 04 05 /.test(h));
                    if (r.started !== false) return `走行中に始まった：${JSON.stringify(r).slice(0, 200)}`;
                    if (sent.length) return `消去の電文が出た：${sent.join(' | ')}`;
                    return /moving|stationary|走行|停車/.test(r.reason ?? '') ? true : `理由が走行中でない：「${r.reason}」`;
                },
            },
        },
        {
            check: {
                desc: '手順 3：走行中、画面の消去（CLEAR FAULTS）は押せず、札は「走行中」',
                run: async (page, st) => {
                    await ask(page, st, 'monitoring_display', { show: 'diagnosis', pane: 'list' });
                    await page.waitForTimeout(800);
                    const clear = page.locator('button:visible:has-text("CLEAR FAULTS")').last();
                    if ((await clear.count()) === 0) return 'CLEAR FAULTS が無い';
                    const disabled = await clear.isDisabled();
                    const t = await screenText(page);
                    if (disabled && t.includes('走行中')) return true;
                    return `${disabled ? '' : '押せる。'}${t.includes('走行中') ? '' : '「走行中」の札が無い'}`;
                },
            },
        },
        {
            check: {
                desc: '手順 3：走行中に押しても、確認ダイアログに走行中で送れないと出る（押せてしまう場合）',
                run: async (page) => {
                    const clear = page.locator('button:visible:has-text("CLEAR FAULTS")').last();
                    if ((await clear.count()) === 0 || (await clear.isDisabled())) return true;
                    await clear.click();
                    await page.waitForTimeout(600);
                    const d = page.locator('[role=dialog]').first();
                    const text = (await d.count()) ? await d.innerText() : '';
                    await page.keyboard.press('Escape');
                    const cancel = page.locator('[role=dialog] button:has-text("キャンセル")');
                    if (await cancel.count()) await cancel.first().click();
                    return /走行中|停車/.test(text) ? true : `ダイアログに走行中の言葉が無い：${text.replace(/\n/g, ' ').slice(0, 160)}`;
                },
            },
        },
        { shot: 's03-moving-clear' },
        // 4. 停車して「消して」
        { car: { speedKmh: 0 }, means: '停車' },
        { wait: 6000, means: '停車して、話しかけるまでの間' },
        {
            check: {
                desc: '手順 4：止まったあと、タブが「走行中」のままでない（状態の car が moving でない）',
                run: async (page, st) => {
                    const s = await ask(page, st, 'monitoring_status');
                    return s.car !== 'moving' ? true : `止まって 6 秒たっても car: ${s.car}、speedKmh: ${s.speedKmh}`;
                },
            },
        },
        { say: '消して' },
        {
            check: {
                desc: '手順 4：読み返しの材料が答えにある：消すモジュールと件数、消去のジョブの日本語名、記録した条件も消えること',
                run: async (page, st) => {
                    const dme = await ask(page, st, 'monitoring_catalog', { module: 'mss54', query: 'FS_LOESCHEN' });
                    const mk60 = await ask(page, st, 'monitoring_catalog', { module: 'dsc_mk60', query: 'FS_LOESCHEN' });
                    const jobs = [dme, mk60].map((c) => c.jobs?.find((j) => j.job === 'FS_LOESCHEN'));
                    const why = [];
                    if (jobs.some((j) => !j?.nameJa)) why.push('FS_LOESCHEN の日本語名が無い');
                    if (!/freeze|フリーズ|環境|condition/i.test(JSON.stringify(jobs))) why.push('記録した条件（フリーズフレーム）も消えることが答えに無い（画面の確認ダイアログには有る）');
                    const practiceReason = jobs.map((j) => j?.reason).find((x) => /PRACTICE first/.test(x ?? ''));
                    if (practiceReason) why.push(`練習モードなのに「先に PRACTICE で」と答える：「${practiceReason}」`);
                    return why.length ? why.join('。') : true;
                },
            },
        },
        // 5. 「残して、いいよ」
        { say: '残して、いいよ' },
        {
            check: {
                desc: '手順 5：保存した記録に、消す前の 3 件（DSC 2、エンジン 1）が入る',
                run: async (page, st) => {
                    const r = await ask(page, st, 'monitoring_save', { confirmed: true });
                    st.saved = r;
                    return r.saved && r.faultCount === 3 ? true : `保存の答え：${JSON.stringify(r)}`;
                },
            },
        },
        {
            check: {
                desc: '手順 5：AI が DME と DSC MK60 の故障を消す（モジュールを切り替え、どちらも送られる）',
                run: async (page, st) => {
                    const t0 = Date.now();
                    const a = await ask(page, st, 'monitoring_actuate', { module: 'mss54', job: 'FS_LOESCHEN', owner_said: '残して、いいよ' });
                    await page.waitForTimeout(800);
                    const m = await ask(page, st, 'monitoring_module', { module: 'dsc_mk60' });
                    await page.waitForTimeout(2500);
                    const b = await ask(page, st, 'monitoring_actuate', { module: 'dsc_mk60', job: 'FS_LOESCHEN', owner_said: '残して、いいよ' });
                    await page.waitForTimeout(800);
                    const heard = await wire(page, t0);
                    const why = [];
                    if (a.started !== true) why.push(`DME：${JSON.stringify(a).slice(0, 160)}`);
                    if (m.switched !== true) why.push(`切り替え：${JSON.stringify(m).slice(0, 160)}`);
                    if (b.started !== true) why.push(`DSC：${JSON.stringify(b).slice(0, 160)}`);
                    if (!heard.some((h) => /^12 04 05 /.test(h))) why.push('DME の消去の電文が車に届いていない');
                    if (!heard.some((h) => /^b8 29 f1 03 14 /.test(h))) why.push('DSC MK60 の消去（KWP 14）が車に届いていない');
                    return why.length ? why.join('。') : true;
                },
            },
        },
        {
            check: {
                desc: '手順 5：読み直すと 0 件（AI の答え）',
                run: async (page, st) => {
                    await ask(page, st, 'monitoring_scan');
                    st.scan2 = await waitScan(page);
                    const n = faultsByAddress(await ask(page, st, 'monitoring_faults'));
                    const total = Object.values(n).reduce((a, b) => a + b, 0);
                    if (total === 0) return true;
                    const car = await carNow(page);
                    return `読み直しても ${total} 件（DME ${n['0x12']}、DSC MK60 ${n['0xB8']}）。練習の車の MK60 の記録：${(car.dscMk60 ?? []).length} 件のまま`;
                },
            },
        },
        {
            check: {
                desc: '手順 5：画面も 0 件',
                run: async (page, st) => {
                    await ask(page, st, 'monitoring_display', { show: 'diagnosis', pane: 'list' });
                    await page.waitForTimeout(800);
                    const rows = await scanRows(page);
                    const left = Object.entries(rows).filter(([, r]) => /故障 \d/.test(r.tag));
                    return left.length ? `故障が残って見える：${left.map(([a, r]) => `${a} ${r.tag}`).join(', ')}` : true;
                },
            },
        },
        { shot: 's05-after-clear' },
        {
            check: {
                desc: '手順 5：SESSIONS（MEMORY）に、消す前の記録が日時つきで残り、故障 3 件と読める',
                run: async (page, st) => {
                    await ask(page, st, 'monitoring_display', { show: 'memory' });
                    await page.waitForTimeout(800);
                    const t = await screenText(page);
                    const label = st.saved?.label;
                    if (!label || !t.includes(label)) return `記録「${label}」が画面に無い`;
                    if (!/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(label)) return `日時が無い：${label}`;
                    return /故障 3/.test(t) ? true : `記録の故障の数が 3 でない：${/故障 \d+/.exec(t)?.[0] ?? 'なし'}`;
                },
            },
        },
        { shot: 's05-sessions' },
        noVin,
    ]),
};

export default scenario;
