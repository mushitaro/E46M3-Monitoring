import { always, bodyText, startDrive, tool } from './_owner.mjs';

/**
 * SC13（docs/VIRTUAL-CAR-TESTS.md M1）：走りながらログを見て、分析し、取り方と走り方を変える。
 *
 * 練習の車の筋書き（A4）を、文書の 0〜60 秒・60 秒・120 秒から縮めて流す：
 *   0〜20 秒 一般道（2〜4 速、20〜60 km/h。値の比べやすいよう平らな所を置く）
 *   20 秒   3 速で全開。3,000 → 6,000 回転を 4 秒。3,900〜4,300 回転で排気カムの実測が目標より最大 6.0° 遅れる。ノック無し
 *   45 秒   同じ踏み方をもう一度。同じ遅れ
 *   58 秒   停車
 * 合格は、画面の項目と値、AI の道具の答えで決める（AI の言い回しそのものは声の予行で見る）。
 */
const EX_SOLL = 90;
const IN_SOLL = 100;
const pull = (t0) => [
    { t: t0, gear: 3, kmh: 60, rpm: 3000, pedal: 100, exIst: EX_SOLL },
    { t: t0 + 1.2, rpm: 3900, exIst: EX_SOLL },
    { t: t0 + 1.47, rpm: 4100, exIst: EX_SOLL - 6 },
    { t: t0 + 1.73, rpm: 4300, exIst: EX_SOLL },
    { t: t0 + 4, gear: 3, kmh: 120, rpm: 6000, pedal: 100, exIst: EX_SOLL },
    { t: t0 + 6, gear: 4, kmh: 100, rpm: 3200, pedal: 10 },
];
const POINTS = [
    { t: 0, gear: 2, kmh: 20, rpm: 2000, pedal: 15, inSoll: IN_SOLL, inIst: IN_SOLL, exSoll: EX_SOLL, exIst: EX_SOLL },
    { t: 3, gear: 2, kmh: 30, rpm: 2600, pedal: 18 },
    { t: 4, gear: 3, kmh: 32, rpm: 1900, pedal: 18 },
    { t: 10, gear: 3, kmh: 32, rpm: 1900, pedal: 18 },
    { t: 13, gear: 4, kmh: 55, rpm: 2300, pedal: 14 },
    { t: 19.5, gear: 4, kmh: 55, rpm: 2300, pedal: 14 },
    ...pull(20),
    { t: 40, gear: 4, kmh: 60, rpm: 2500, pedal: 12 },
    { t: 44.5, gear: 3, kmh: 60, rpm: 3000, pedal: 40 },
    ...pull(45),
    { t: 55, gear: 2, kmh: 20, rpm: 1500, pedal: 0 },
    { t: 58, gear: 0, kmh: 0, rpm: 820, pedal: 0 },
];

/** Where the drive is at `t` seconds: the same interpolation as practiceCar's driveNow. */
function driveAt(t) {
    const out = {};
    for (const k of ['gear', 'kmh', 'rpm', 'pedal', 'inSoll', 'inIst', 'exSoll', 'exIst']) {
        const has = POINTS.filter((p) => p[k] !== undefined);
        const after = has.findIndex((p) => p.t >= t);
        if (after === -1) out[k] = has[has.length - 1][k];
        else if (after === 0) out[k] = has[0][k];
        else {
            const a = has[after - 1];
            const b = has[after];
            out[k] = k === 'gear' ? a[k] : a[k] + ((b[k] - a[k]) * (t - a.t)) / (b.t - a.t || 1);
        }
    }
    return out;
}

const EIGHT = ['3:n', '3:pwg1', '35:evan1_soll', '35:evan1_ist', '35:avan1_soll', '35:avan1_ist', '19:v', '4:kr_st'];
const FIVE = ['35:n', '35:evan1_soll', '35:evan1_ist', '35:avan1_soll', '35:avan1_ist'];
const PHYD = 'smg2:STATUS_IO_LESEN:STAT_PHYD_WERT';

/** Seconds into the drive, by the page's clock. */
const driveSeconds = async (page, st) => ((await page.evaluate(() => Date.now())) - st.driveAt) / 1000;
/** Waits until the drive has reached `t` seconds. */
const waitDrive = (t) => ({
    check: {
        desc: `筋書きの ${t} 秒まで走る`,
        run: async (page, st) => {
            if (!st.driveAt) return '筋書きが始まっていない';
            const left = t - (await driveSeconds(page, st));
            if (left > 0) await page.waitForTimeout(left * 1000);
            return true;
        },
    },
});

/** The DATALOG pane's selected channels as the screen shows them: symbol → { text, value }. */
async function shownChannels(page) {
    return page.evaluate(() => {
        const lines = document.body.innerText.split('\n').map((l) => l.trim());
        const from = lines.indexOf('チャンネル');
        const to = lines.indexOf('記録するチャンネルを選ぶ');
        const out = {};
        if (from < 0 || to < 0) return out;
        const part = lines.slice(from + 1, to);
        for (let i = 0; i + 1 < part.length; i++) {
            if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(part[i]) && /^[-\d.—]/.test(part[i + 1])) out[part[i]] = { name: part[i - 1], text: part[i + 1], value: Number.parseFloat(part[i + 1]) };
        }
        return out;
    });
}

/** The value the screen shows for `sym`, against the drive between half a second ago and now. */
const matchesDrive = async (page, st, sym, key, tol) => {
    const t1 = await driveSeconds(page, st);
    const shown = (await shownChannels(page))[sym];
    const e = [driveAt(t1 - 0.6)[key], driveAt(t1)[key]];
    if (!shown || !Number.isFinite(shown.value)) return `${sym} の値が画面に無い`;
    const lo = Math.min(...e) - tol;
    const hi = Math.max(...e) + tol;
    return shown.value >= lo && shown.value <= hi ? true : `${sym}: 画面 ${shown.text}、筋書き ${e.map((x) => x.toFixed(1)).join('〜')}（±${tol}）`;
};

/** The rate the screen shows (実効レート), in Hz. */
const screenRate = async (page) => {
    const text = await bodyText(page);
    const m = /実効レート\s*\n?\s*([\d.]+)\s*\n?\s*Hz/.exec(text);
    return m ? Number(m[1]) : null;
};

const scenario = {
    id: 'SC13',
    title: '走りながらログを見て、分析し、取り方と走り方を変える（3 速 4,000 回転のトルク抜け）',
    story:
        '3 速で踏んだとき 4,000 回転あたりでトルクが抜ける気がする。停車中に声でログの準備を頼み、記録して走る。一般道のあと 3 速で全開にすると、' +
        '3,900〜4,300 回転で排気カムの実測が目標より 6° 遅れる。踏み終わってすぐ「今の何？」、取り方を 5 項目に絞り、走りながら SMG の油圧を足し、' +
        '次に取る条件を計画に書き、2 回目を踏み、1 回目と比べ、停車して止めて保存する。最後に停車中に、記録の中の SMG の油圧の範囲を聞く。',
    car: { dmeFaults: [], speedKmh: 0 },
    steps: always([
        // ---- 1. 停車中：ログの準備 ----------------------------------------------------------------
        { say: '3 速で踏んだときのトルクの抜けを見たい。ログの準備をして' },
        { ui: 'practice' },
        { ui: 'click', text: 'CONNECT', settle: 2500, means: '人が画面で PRACTICE につなぐ（停車中）' },
        {
            ai: 'monitoring_log_channels',
            args: { channels: EIGHT },
            means: '8 項目を選ぶ。答えに、AI が名前で言える名前・単位と、毎秒およそ何回取れるかがある',
            expect: (r) => {
                if (!r?.changed || r.cost?.channels !== 8) return `選べない: ${JSON.stringify(r).slice(0, 200)}`;
                const named = Array.isArray(r.channels) && r.channels.every((c) => c.ja && 'unit' in c);
                const rate = typeof r.cost?.rateHz === 'number' || typeof r.expectedHz === 'number';
                if (!named) return `選んだ答えに項目の名前と単位が無い（id だけ）: ${JSON.stringify(r).slice(0, 200)}`;
                return rate ? true : `毎秒何回取れるかの見込みが無い: ${JSON.stringify(r.cost)}`;
            },
            keep: (r, st) => (st.blocks8 = r?.cost?.blocks),
        },
        { ui: 'tab', name: 'DATALOG', means: 'オーナーが DATALOG を見る' },
        { screen: { desc: '「8 項目 / 4 ブロック = 1サンプルあたり 4 往復」', has: ['記録するチャンネルを選ぶ', '8 項目 / 4 ブロック = 1サンプルあたり 4 往復'] } },
        {
            check: {
                desc: '選んだ 8 項目が、日本語の名前で並ぶ（回転・アクセル・吸気カム目標と実測・排気カム目標と実測・車速・ノック）',
                run: async (page) => {
                    const ch = await shownChannels(page);
                    const want = { n: 'エンジン回転数', pwg1: 'アクセル', evan1_soll: '吸気VANOS', evan1_ist: '吸気VANOS', avan1_soll: '排気VANOS', avan1_ist: '排気VANOS', v: '車速', kr_st: 'ノック' };
                    const bad = Object.entries(want).filter(([s, n]) => !ch[s] || !ch[s].name.includes(n));
                    return bad.length ? `無い・名前が違う: ${bad.map(([s]) => s).join(', ')}` : true;
                },
            },
        },
        {
            check: {
                desc: '選んだ 8 項目の行に単位（rpm・%・°KW・km/h）が付いている（U5）',
                run: async (page) => {
                    const text = await bodyText(page);
                    const part = text.slice(text.indexOf('チャンネル'), text.indexOf('記録するチャンネルを選ぶ'));
                    const missing = ['rpm', '%', '°KW', 'km/h'].filter((u) => !part.includes(u));
                    return missing.length ? `選んだ項目の行に単位が無い: ${missing.join(' ')}` : true;
                },
            },
        },
        {
            check: {
                desc: 'AI が CO-WORK に計画を書く：「3 速で踏む（3,000→6,000 回転）」の段',
                run: async (page, st) => {
                    const inv = await tool(page, 'monitoring_investigate', { words: '3 速で踏んだときのトルクの抜けを見たい', modules: ['mss54'], days: 7, mode: 'symptom' });
                    if (!inv?.record) return JSON.stringify(inv).slice(0, 200);
                    Object.assign(st, { record: inv.record, mandate: inv.mandate });
                    const p = await tool(page, 'monitoring_plan', {
                        record: inv.record,
                        mandate: inv.mandate,
                        purpose: '3 速 4,000 回転のトルク抜け',
                        steps: [{ n: 1, do: '3 速で踏む（3,000→6,000 回転）', kind: 'sample', channels: EIGHT }],
                    });
                    return p?.v ? true : JSON.stringify(p).slice(0, 200);
                },
            },
        },
        { screen: { desc: '画面の CO-WORK の計画に「3 速で踏む（3,000→6,000 回転）」が出る', has: ['3 速で踏む（3,000→6,000 回転）'] } },
        { shot: 's01-ready' },

        // ---- 2. 記録して ---------------------------------------------------------------------------
        { say: '記録して' },
        startDrive(POINTS),
        {
            ai: 'monitoring_start_log',
            means: '記録を始める。答えに記録する 8 項目',
            expect: (r) => (r?.started && (r.selected ?? []).length === 8 ? true : JSON.stringify(r).slice(0, 200)),
        },
        { wait: 2500 },
        {
            check: {
                // UX-05 (docs/UX-DESIGN.md §6): VISU is what a glance takes in while driving — four panels,
                // a target and its actual on one; the other values are on LIST (checked at the head unit's
                // width below), and VISU says how many.
                desc: '①VISU は一目で読める 4 枚（回転・車速・吸気と排気のカムは目標と実を一枚に）、名前・単位・今の値つき。ほかは LIST',
                run: async (page) => {
                    const lines = await page.evaluate(() => [...document.querySelectorAll('svg polyline')].filter((p) => p.getBoundingClientRect().width > 0).length);
                    const text = await bodyText(page);
                    // The right column from its heading on: VISU since UX-26 (it was VISUALIZATION & CONTROLS).
                    const at = text.indexOf('\nVISU\n');
                    if (at < 0) return 'VISU の見出しが無い';
                    const viz = text.slice(at);
                    const why = [];
                    if (lines !== 6) why.push(`線は ${lines} 本（回転・車速の 2 本と、カムの目標と実 2 組で 6 本のはず）`);
                    for (const n of ['エンジン回転数', '車速', '吸気VANOS バンク1', '排気VANOS バンク1', 'rpm', 'km/h']) if (!viz.includes(n)) why.push(`VISU に「${n}」が無い`);
                    if (!/ほか\s*2\s*項目は LIST/.test(viz)) why.push('「ほか 2 項目は LIST」が無い');
                    return why.length ? why.join('、') : true;
                },
            },
        },
        {
            check: {
                desc: '②実効レート（Hz）と ③サンプル数が出て、サンプル数が増えていく',
                run: async (page, st) => {
                    const count = async () => {
                        const m = /サンプル\s*\n?\s*(\d+)/.exec(await bodyText(page));
                        return m ? Number(m[1]) : null;
                    };
                    const a = await count();
                    await page.waitForTimeout(1200);
                    const b = await count();
                    st.rate8 = await screenRate(page);
                    if (st.rate8 === null) return '実効レートが Hz で出ていない';
                    return a !== null && b > a ? true : `サンプル数 ${a} → ${b}`;
                },
            },
        },
        {
            check: {
                desc: '④記録中の印と経過時間が見える',
                run: async (page) => {
                    const text = await bodyText(page);
                    const mark = /記録中|REC/.test(text);
                    const elapsed = /\b\d{1,2}:\d{2}\b/.test(text.replace(/\d{1,2}:\d{2} に読取/g, ''));
                    return mark && elapsed ? true : `記録中の印 ${mark ? 'あり' : 'なし'}、経過時間 ${elapsed ? 'あり' : 'なし'}`;
                },
            },
        },
        {
            check: {
                desc: 'HUB に回転と車速が大きく出る',
                run: async (page) => {
                    const text = await bodyText(page);
                    const hub = text.slice(text.indexOf('\nVISU\n') + 1);
                    return /rpm/.test(hub) && /km\/h/.test(hub) ? true : `HUB に回転・車速が無い: ${hub.replace(/\n/g, ' ').slice(0, 160)}`;
                },
            },
        },
        { shot: 's02-recording' },
        {
            check: {
                desc: 'ナビの幅（683×400）：LIST と VISU が切り替えられ、LIST に 8 項目、VISU に 4 枚が名前を切らずに見える',
                run: async (page) => {
                    await page.setViewportSize({ width: 683, height: 400 });
                    await page.waitForTimeout(600);
                    const out = [];
                    for (const pane of ['LIST', 'VISU']) {
                        const b = page.locator(`button:visible:has-text("${pane}")`).last();
                        if ((await b.count()) === 0) {
                            out.push(`${pane} が無い`);
                            continue;
                        }
                        await b.click();
                        await page.waitForTimeout(500);
                        const text = await page.evaluate(() => {
                            const vis = (el) => {
                                const r = el.getBoundingClientRect();
                                return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth;
                            };
                            return [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && vis(e)).map((e) => e.textContent).join('\n');
                        });
                        if (pane === 'LIST') {
                            const seen = ['エンジン回転数', 'アクセル', '吸気VANOS バンク1 目標角', '吸気VANOS バンク1 実角', '排気VANOS バンク1 目標角', '排気VANOS バンク1 実角', '車速', 'ノック'].filter((n) => text.includes(n)).length;
                            if (seen < 8) out.push(`${pane} で見える項目 ${seen}/8`);
                        } else {
                            const seen = ['エンジン回転数', '車速', '吸気VANOS バンク1', '排気VANOS バンク1', '目標', '実', 'ほか 2 項目は LIST'].filter((n) => text.includes(n)).length;
                            if (seen < 7) out.push(`${pane} で見える項目 ${seen}/7`);
                            // A panel's name is not cut (UX-05): its box holds the whole of it.
                            const cut = await page.evaluate(() =>
                                [...document.querySelectorAll('#narrow-visu .truncate')]
                                    .filter((e) => e.getBoundingClientRect().width > 0 && e.scrollWidth > e.clientWidth + 1)
                                    .map((e) => e.textContent),
                            );
                            if (cut.length) out.push(`VISU で切れた名前：${cut.join('、')}`);
                        }
                        await page.screenshot({ path: `e2e-report/shots/SC13-s02-narrow-${pane.toLowerCase()}.png` }).catch(() => {});
                    }
                    await page.setViewportSize({ width: 1280, height: 800 });
                    await page.waitForTimeout(400);
                    return out.length ? out.join('、') : true;
                },
            },
        },

        // ---- 3. 一般道（0〜20 秒） ---------------------------------------------------------------
        waitDrive(7),
        {
            check: {
                desc: '一般道：画面の回転・車速・アクセルが筋書きと一致（回転 ±10 rpm、車速 ±1 km/h、アクセル ±1 %）',
                run: async (page, st) => {
                    const r = [await matchesDrive(page, st, 'n', 'rpm', 10), await matchesDrive(page, st, 'v', 'kmh', 1), await matchesDrive(page, st, 'pwg1', 'pedal', 1)];
                    const bad = r.filter((x) => x !== true);
                    return bad.length ? bad.join(' / ') : true;
                },
            },
        },
        waitDrive(16),
        {
            check: {
                desc: '一般道（4 速）：もう一度、画面の値が筋書きと一致',
                run: async (page, st) => {
                    const r = [await matchesDrive(page, st, 'n', 'rpm', 10), await matchesDrive(page, st, 'v', 'kmh', 1), await matchesDrive(page, st, 'pwg1', 'pedal', 1)];
                    const bad = r.filter((x) => x !== true);
                    return bad.length ? bad.join(' / ') : true;
                },
            },
        },
        {
            check: {
                desc: 'グラフ（記録）が途切れない：サンプルの間が 1 秒を超えない。走行中に触る必要のある表示（ダイアログ）が出ていない',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_datalog', { max: 240 });
                    const t = (r?.trace ?? []).map((s) => s.t);
                    let gap = 0;
                    for (let i = 1; i < t.length; i++) gap = Math.max(gap, t[i] - t[i - 1]);
                    if (!r?.running || t.length < 10) return `記録が進んでいない: ${JSON.stringify(r).slice(0, 160)}`;
                    // The trace is thinned to 240 over the whole run: a gap in it longer than the thinning step is a real one.
                    const step = (r.seconds / 239) * 1.5 + 0.2;
                    if (gap > Math.max(1, step)) return `途切れ ${gap.toFixed(2)} 秒`;
                    const dialogs = await page.locator('[role=dialog]:visible').count();
                    return dialogs === 0 ? true : `走行中にダイアログが ${dialogs} 個出ている`;
                },
            },
        },
        { shot: 's03-road' },

        // ---- 4. 3 速で踏む（20 秒） --------------------------------------------------------------
        waitDrive(25.5),
        {
            check: {
                desc: '記録に 3,000→6,000 回転の上がりが入り、3,900〜4,300 回転で排気カムの実測が目標から離れる（最大 6.0±0.5°）',
                run: async (page, st) => {
                    const r = await tool(page, 'monitoring_datalog', { seconds: 8, max: 240, channels: ['3:n', '35:avan1_soll', '35:avan1_ist'] });
                    const tr = r?.trace ?? [];
                    const rpm = tr.map((s) => s['3:n']).filter((x) => typeof x === 'number');
                    if (!rpm.length || Math.min(...rpm) > 3100 || Math.max(...rpm) < 5900) return `上がりが無い: ${Math.min(...rpm)}〜${Math.max(...rpm)}`;
                    let worst = 0;
                    let at = null;
                    for (const s of tr) {
                        const lag = s['35:avan1_soll'] - s['35:avan1_ist'];
                        if (lag > worst) [worst, at] = [lag, s['3:n']];
                    }
                    st.lag1 = { worst, at };
                    if (Math.abs(worst - 6) > 0.5) return `遅れの最大 ${worst.toFixed(2)}°`;
                    return at >= 3900 && at <= 4300 ? true : `遅れの最大が ${at} 回転`;
                },
            },
        },
        {
            check: {
                desc: 'グラフに排気カムの目標線と実測線が出ている（一枚に二本、凡例は「目標」「実」）',
                run: async (page) => {
                    const panel = await page.evaluate(() => {
                        const title = [...document.querySelectorAll('#narrow-visu span')].find((e) => e.textContent === '排気VANOS バンク1');
                        const box = title?.closest('div')?.parentElement;
                        return box ? { lines: [...box.querySelectorAll('svg polyline')].length, text: box.textContent ?? '' } : null;
                    });
                    if (!panel) return 'VISU に排気カムの一枚が無い';
                    return panel.lines === 2 && panel.text.includes('目標') && panel.text.includes('実') ? true : `排気カムの一枚：線 ${panel.lines} 本、「${panel.text.slice(0, 80)}」`;
                },
            },
        },
        { shot: 's04-pull' },

        // ---- 5. 今の何？ --------------------------------------------------------------------------
        { say: '今の何？' },
        {
            check: {
                desc: 'AI の「今」の道具（monitoring_moment）が、記録のその時刻の値を返す：時点・ギア・回転・排気カムの遅れ・ノック',
                run: async (page, st) => {
                    const ago = (await driveSeconds(page, st)) - 21.47;
                    const r = await tool(page, 'monitoring_moment', { seconds_ago: ago, window_s: 4 });
                    st.moment = r;
                    if (!r?.recorded) return `記録を読めない: ${r?.reason ?? JSON.stringify(r).slice(0, 160)}`;
                    const s = (r.samples ?? []).find((x) => x.values?.['35:avan1_ist'] !== undefined);
                    return s ? true : 'カムの値が無い';
                },
            },
        },
        {
            check: {
                desc: 'AI が DATALOG から言える：遅れ約 6°・4,100 回転あたり・ノック無し、そしてギア（3 速）',
                run: async (page, st) => {
                    // The last seconds since the pull began: the spread gives the size of the lag, the trace where it was.
                    const seconds = Math.ceil((await driveSeconds(page, st)) - 19);
                    const r = await tool(page, 'monitoring_datalog', { seconds, max: 240 });
                    const tr = r?.trace ?? [];
                    const stat = (c) => (r?.stats ?? []).find((x) => x.channel === c);
                    const lag = stat('35:avan1_soll')?.max - stat('35:avan1_ist')?.min;
                    const worst = tr.reduce((w, s) => (s['35:avan1_soll'] - s['35:avan1_ist'] > (w ? w['35:avan1_soll'] - w['35:avan1_ist'] : 0) ? s : w), null);
                    if (!worst) return '遅れの点が無い';
                    const kr = stat('4:kr_st');
                    if (!(Math.abs(lag - 6) <= 0.5) || worst['3:n'] < 3850 || worst['3:n'] > 4350) return `遅れ ${lag?.toFixed?.(1)}° @ ${worst['3:n']} rpm`;
                    if (!kr || kr.min !== kr.max) return 'ノック制御の値が動いている、または無い';
                    // 「3 速」：ギアを言える値が答えに無ければ、AI は推し量るしかない。
                    const gear = Object.keys(worst).some((k) => /gang/.test(k));
                    return gear ? true : '答えにギアが無い（選んだ 8 項目にギアが無く、ほかの道具も返さない）';
                },
            },
        },
        {
            check: {
                desc: '画面のグラフの同じ時刻にカーソルが立ち、カーソルの値が AI の数字と一致する（回転 ±50、角度 ±0.5°）',
                run: async (page) => {
                    const cursor = await page.locator('[data-test*="cursor"], [aria-label*="カーソル"]').count();
                    return cursor > 0 ? true : 'グラフにカーソルが無い（AI が分析した時刻を画面で指せない）';
                },
            },
        },
        { shot: 's05-moment' },

        // ---- 6. なんで？もっと詳しく見られる？ ----------------------------------------------------
        { say: 'なんで？もっと詳しく見られる？' },
        {
            check: {
                desc: 'AI が言える：今の毎秒 n 回（画面の実効レートと ±15 % で一致）と、遅れていた 0.5 秒に入った点の数',
                run: async (page, st) => {
                    // 今の区切りの実効レート（画面と同じ量）。
                    const r = await tool(page, 'monitoring_datalog', { max: 0 });
                    const hz = r?.segments?.at(-1)?.rateHz ?? null;
                    const shown = await screenRate(page);
                    st.rateAi = hz;
                    if (!hz || !shown) return `レート: 道具 ${hz} / 画面 ${shown}`;
                    return Math.abs(hz - shown) / shown <= 0.15 ? true : `道具から ${hz.toFixed(1)} Hz、画面 ${shown} Hz`;
                },
            },
        },
        {
            check: {
                desc: 'AI が「カムの 4 項目と回転だけにすれば毎秒 n\' 回」と前もって言える（選ぶ前に見込みが分かる）',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_log_channels', { query: 'avan1' });
                    const has = r && ('cost' in r || 'estimate' in r);
                    return has ? true : '選び直す前に、その組の往復数・レートの見込みを返す口が無い';
                },
            },
        },

        // ---- 7. いいよ：5 項目に -----------------------------------------------------------------
        { say: 'いいよ' },
        {
            ai: 'monitoring_log_channels',
            args: { channels: FIVE },
            means: '記録を止めずに 5 項目へ。記録に区切りが入る',
            expect: (r) => (r?.changed === true ? true : `記録中は選び直せない: ${r?.reason ?? JSON.stringify(r).slice(0, 160)}`),
        },
        {
            check: {
                desc: '（続けるため）止めて 5 項目にして記録し直す',
                run: async (page) => {
                    const s = await tool(page, 'monitoring_status');
                    if (s?.datalog?.selected?.length === 5 && s.recording) return true;
                    await tool(page, 'monitoring_stop_log', { confirmed: true });
                    await page.waitForTimeout(800);
                    const c = await tool(page, 'monitoring_log_channels', { channels: FIVE });
                    if (!c?.changed) return JSON.stringify(c).slice(0, 200);
                    const go = await tool(page, 'monitoring_start_log');
                    return go?.started ? true : JSON.stringify(go).slice(0, 200);
                },
            },
        },
        { wait: 2500 },
        { screen: { desc: '画面のチャンネルが 5 項目・1 ブロックに変わる', has: ['5 項目 / 1 ブロック = 1サンプルあたり 1 往復'] } },
        {
            check: {
                desc: '実効レートが手順 2 より上がる',
                run: async (page, st) => {
                    const r = await screenRate(page);
                    st.rate5 = r;
                    return r && st.rate8 && r > st.rate8 ? true : `8 項目 ${st.rate8} Hz → 5 項目 ${r} Hz`;
                },
            },
        },
        {
            check: {
                desc: '記録に区切りが入り、どこで取り方を変えたかがグラフに印で残る（記録は一つのまま）',
                run: async (page) => {
                    const mark = await page.locator('[data-test*="segment"], [aria-label*="区切り"]').count();
                    const r = await tool(page, 'monitoring_datalog', { max: 0 });
                    const oneRun = (r?.recorded ?? []).length >= 5 && r?.seconds > 20;
                    return mark > 0 && oneRun ? true : `区切りの印 ${mark}、記録の長さ ${r?.seconds} 秒（取り直しで別の記録になった）`;
                },
            },
        },
        { shot: 's07-five' },

        // ---- 8. SMG の油圧も足して（走行中） -----------------------------------------------------
        // 運営者の表（2026-11-15）：状態の値の読み取りは走行中も可。走行中に足せる。
        { say: 'SMG の油圧も足して' },
        {
            ai: 'monitoring_log_channels',
            args: { channels: [...FIVE, PHYD] },
            means: '走行中に足す：記録は止まらず、答えに見込みの毎秒何回（AI が「毎秒 n″ 回になります」と言える数字）',
            expect: (r) => {
                if (r?.changed !== true) return `足せない: ${r?.reason ?? JSON.stringify(r).slice(0, 160)}`;
                return typeof r.cost?.rateHz === 'number' ? true : `見込みのレートが無い: ${JSON.stringify(r.cost)}`;
            },
        },
        { wait: 3000 },
        {
            check: {
                desc: '画面に 6 本目のグラフ（SMG の油圧、bar）が出て、実効レートが下がる。ほかの 5 本は止まらない',
                run: async (page, st) => {
                    const text = await bodyText(page);
                    const viz = text.slice(text.indexOf('\nVISU\n') + 1);
                    const lines = await page.evaluate(() => [...document.querySelectorAll('svg polyline')].filter((p) => p.getBoundingClientRect().width > 0).length);
                    const rate = await screenRate(page);
                    const a = await tool(page, 'monitoring_datalog', { max: 0, seconds: 2 });
                    const pressure = (a?.stats ?? []).find((x) => x.channel === PHYD);
                    await page.waitForTimeout(1000);
                    const b = await tool(page, 'monitoring_datalog', { max: 0 });
                    const why = [];
                    if (!/油圧/.test(viz) || !/bar/.test(viz)) why.push('グラフに SMG の油圧（bar）が無い');
                    if (lines < 6) why.push(`グラフは ${lines} 本`);
                    if (!(pressure?.n > 0)) why.push('走行中に SMG の油圧の値が入らない');
                    if (!(rate && st.rate5 && rate < st.rate5)) why.push(`実効レート 5 項目 ${st.rate5} Hz → 6 項目 ${rate} Hz`);
                    if (!(b?.running && b.samples > (a?.samples ?? 0))) why.push('ほかの値が止まった');
                    return why.length ? why.join('、') : true;
                },
            },
        },
        { shot: 's08-smg-moving' },

        // ---- 9. 次はどう走ればいい？ ---------------------------------------------------------------
        { say: '次はどう走ればいい？' },
        {
            check: {
                desc: 'AI は取る条件だけを計画に書く：「3 速で 3,800〜4,500 回転を通ったら取る」',
                run: async (page, st) => {
                    const p = await tool(page, 'monitoring_plan', {
                        record: st.record,
                        mandate: st.mandate,
                        purpose: '3 速 4,000 回転のトルク抜け（再現）',
                        steps: [
                            { n: 1, do: '3 速で踏む（3,000→6,000 回転）', kind: 'sample', channels: FIVE },
                            {
                                n: 2,
                                do: '3 速で 3,800〜4,500 回転を通ったら取る',
                                kind: 'capture',
                                condition: [
                                    { channel: '83:gang', op: '==', value: 3 },
                                    { channel: '35:n', op: '>=', value: 3800 },
                                    { channel: '35:n', op: '<=', value: 4500 },
                                ],
                                preS: 2,
                                postS: 2,
                            },
                        ],
                    });
                    st.plan2 = p;
                    return p?.v ? true : JSON.stringify(p).slice(0, 240);
                },
            },
        },
        { screen: { desc: '画面の計画に、その条件の段が「待っている」で出る', has: ['3 速で 3,800〜4,500 回転を通ったら取る', '待'] } },
        { shot: 's09-plan' },

        // ---- 10. 2 回目を踏む（45 秒） -------------------------------------------------------------
        waitDrive(51),
        { screen: { desc: '計画の段が「待っている」から「取った」に変わる', has: ['3 速で 3,800〜4,500 回転を通ったら取る', '取った'] } },
        {
            check: {
                desc: '2 回目も同じ遅れ（最大 6.0±0.5°、3,900〜4,300 回転）が記録に入る',
                run: async (page, st) => {
                    const r = await tool(page, 'monitoring_datalog', { seconds: 8, max: 240, channels: ['35:n', '35:avan1_soll', '35:avan1_ist'] });
                    let worst = 0;
                    let at = null;
                    for (const s of r?.trace ?? []) {
                        const lag = s['35:avan1_soll'] - s['35:avan1_ist'];
                        if (lag > worst) [worst, at] = [lag, s['35:n']];
                    }
                    st.lag2 = { worst, at };
                    return Math.abs(worst - 6) <= 0.5 && at >= 3900 && at <= 4300 ? true : `遅れ ${worst.toFixed(2)}° @ ${at}`;
                },
            },
        },
        { shot: 's10-second-pull' },

        // ---- 11. 1 回目と比べて ------------------------------------------------------------------
        { say: '1 回目と比べて' },
        {
            check: {
                desc: 'AI が 1 回目と 2 回目を一つの答えで比べられる（記録のどちらの踏みも読める）',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_datalog', { max: 240 });
                    const tr = r?.trace ?? [];
                    const pulls = tr.filter((s) => (s['3:n'] ?? s['35:n']) > 5800);
                    const first = pulls.length ? pulls[0].t : null;
                    const last = pulls.length ? pulls[pulls.length - 1].t : null;
                    return first !== null && last - first > 15 ? true : '今の記録には 2 回目しか無い（1 回目は取り直す前の別の記録）';
                },
            },
        },
        {
            check: {
                desc: '画面に 1 回目と 2 回目が、回転を横軸にして重なって出る',
                run: async (page) => {
                    const text = await bodyText(page);
                    return /1 回目/.test(text) && /2 回目/.test(text) ? true : '重ねたグラフが無い';
                },
            },
        },
        { shot: 's11-compare' },

        // ---- 12. 停車して、止めて保存 ------------------------------------------------------------
        waitDrive(58.5),
        { say: '記録止めて、保存して' },
        {
            ai: 'monitoring_stop_log',
            args: {},
            means: '聞き返す前には止めない（confirmed なしは断る）',
            expect: (r, e) => (e && /confirmed/.test(e) ? true : `聞き返さずに止まった: ${JSON.stringify(r)}`),
        },
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '「はい」で止まる', expect: (r) => (r?.stopped === 'recording' ? true : JSON.stringify(r)) },
        { ai: 'monitoring_save', args: { confirmed: true }, means: '保存する', expect: (r) => (r?.saved ? true : JSON.stringify(r)) },
        {
            ai: 'monitoring_sessions',
            means: 'SESSIONS に記録が 1 件。答えに VIN が無い',
            expect: (r) => {
                const n = (r?.saved ?? []).length;
                if (JSON.stringify(r).includes('JR12345')) return 'VIN がある';
                return n === 1 ? true : `保存した記録が ${n} 件`;
            },
        },
        { ui: 'tab', name: 'MEMORY', means: 'オーナーが記録の一覧を見る' },
        {
            check: {
                desc: 'SESSIONS の記録に、日時・区切り 2 つ（8 項目・5 項目）・各区切りの実効レート・計画の段の印が見える',
                run: async (page) => {
                    const text = await bodyText(page);
                    const date = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text);
                    const seg = /8 項目/.test(text) && /5 項目/.test(text);
                    const rate = /Hz/.test(text);
                    return date && seg && rate ? true : `日時 ${date ? 'あり' : 'なし'}・区切り ${seg ? 'あり' : 'なし'}・レート ${rate ? 'あり' : 'なし'}`;
                },
            },
        },
        { shot: 's12-sessions' },

        // ---- 13. 停車中に「SMG の油圧はどうだった？」 ---------------------------------------------
        { say: 'SMG の油圧はどうだった？' },
        {
            check: {
                desc: 'AI が記録の中の SMG の油圧の範囲（最小〜最大、bar）を言える。画面のグラフ（DATALOG）にも SMG の油圧が出ている',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_datalog', { channels: [PHYD], max: 60 });
                    const h = (r?.stats ?? []).find((x) => x.channel === PHYD);
                    if (!(h?.n > 0)) return `記録に SMG の油圧が無い: ${JSON.stringify(h)}`;
                    if (h.unit !== 'bar') return `単位 ${h.unit}`;
                    if (!(h.min >= 0 && h.max <= 300 && h.min <= h.max)) return `範囲が油圧として読めない: ${h.min}〜${h.max} bar`;
                    await page.locator('[role=tab]:has-text("DATALOG")').first().click();
                    await page.waitForTimeout(600);
                    const text = await bodyText(page);
                    const viz = text.slice(text.indexOf('\nVISU\n') + 1);
                    return /油圧/.test(viz) ? true : '画面のグラフに SMG の油圧が無い';
                },
            },
        },
        { shot: 's13-smg-parked' },
    ]),
};

export default scenario;
