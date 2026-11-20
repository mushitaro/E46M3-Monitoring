import { connectPractice, tool } from './_lib.mjs';
import { always, check, screenText } from './_ij.mjs';

const YEARS_20 = 20 * 365 * 86_400_000;
const HOUR = 3_600_000;

/** The DATALOG screen's effective rate (実効レート), Hz. */
const screenRate = async (page) => {
    const lines = (await screenText(page)).split('\n').map((l) => l.trim());
    const i = lines.indexOf('実効レート');
    const v = i >= 0 ? lines.slice(i + 1, i + 3).map((l) => /^([\d.]+)\s*Hz$/.exec(l)).find(Boolean) : null;
    return v ? Number(v[1]) : null;
};

/** The recording's trace, its time steps checked: never back, never a hole. */
const traceOk = async (page, maxGapS) => {
    const r = await tool(page, 'monitoring_datalog', { max: 240 });
    const t = (r?.trace ?? []).map((x) => x.t);
    if (t.length < 5) return { ok: false, why: `サンプル ${t.length}`, r };
    let back = 0;
    let gap = 0;
    for (let i = 1; i < t.length; i++) {
        if (t[i] < t[i - 1]) back++;
        gap = Math.max(gap, t[i] - t[i - 1]);
    }
    return { ok: back === 0 && gap <= maxGapS, why: `戻り ${back} 回、最大の間 ${gap.toFixed(2)} 秒、長さ ${r.seconds} 秒`, r };
};

/**
 * IJ14・IJ24（いじわる：記録中に時計が飛ぶ・チャンネルを増やす）。
 */
const scenario = {
    id: 'IJ14-24',
    title: '記録中にナビの時計が飛ぶ・記録中にチャンネルを 30 項目まで増やす',
    story:
        'IJ14：記録中にナビの時計が 2006 年から今日へ飛び、走行中に 1 時間戻る。画面の記録の時刻が前後しない。グラフが途切れない。' +
        'IJ24：記録中に、チャンネルを 30 項目まで増やす。画面に、増やすと実効レートが下がること（数字）が出る。AI も同じ数字で言う。記録は止まらず、区切りが入る。',
    // The practice car answers at once; a K-line at 9600 baud does not. Each DME answer 25 ms late, so a
    // block costs about what it does on a car and the effective rate means something.
    car: { inject: [{ to: 0x12, kind: 'slow', delayMs: 25, times: 1e9 }] },
    steps: always([
        check('IJ14：ページはまだサーバーの時刻を聞いていない（ナビの時計のまま）', async (page) => {
            await page.evaluate(() => window.__monitoringE2E.clock.forget());
            return true;
        }),
        ...connectPractice,
        { ai: 'monitoring_log_channels', args: { channels: ['3:n', '3:toel'] }, means: '回転と油温', expect: (r) => (r?.changed ? true : JSON.stringify(r)) },
        { ai: 'monitoring_start_log', means: '記録を始める', expect: (r) => (r?.started ? true : JSON.stringify(r).slice(0, 200)) },
        { car: { speedKmh: 40 }, means: '走っている' },
        { wait: 3000 },
        { shot: 's01-recording' },
        check('IJ14：記録中にサーバーの時刻を聞く：時計が 20 年進む（2006 年 → 今日）', async (page, st) => {
            const now = await page.evaluate(() => window.__monitoringE2E.clock.now());
            st.step1 = await page.evaluate((iso) => window.__monitoringE2E.clock.hear(iso), new Date(now + YEARS_20).toISOString());
            return true;
        }),
        { wait: 3000 },
        check('IJ14：走行中に時計が 1 時間戻る', async (page, st) => {
            const now = await page.evaluate(() => window.__monitoringE2E.clock.now());
            st.step2 = await page.evaluate((iso) => window.__monitoringE2E.clock.hear(iso), new Date(now - HOUR).toISOString());
            return true;
        }),
        { wait: 3000 },
        check('IJ14：記録の時刻が前後せず、途切れない（間は 1 秒以内）', async (page, st) => {
            const v = await traceOk(page, 1);
            st.trace14 = v.r;
            return v.ok ? true : v.why;
        }),
        check('IJ14：記録の長さは実際に経った秒数（20 年や 1 時間を足していない）', async (page, st) => {
            const s = st.trace14?.seconds ?? -1;
            return s > 5 && s < 60 ? true : `長さ ${s} 秒`;
        }),
        { ui: 'tab', name: 'DATALOG' },
        check('IJ14：画面の記録は動いている（サンプルが増える）', async (page) => {
            const a = (await tool(page, 'monitoring_datalog', { max: 0 })).samples;
            await page.waitForTimeout(1500);
            const b = (await tool(page, 'monitoring_datalog', { max: 0 })).samples;
            return b > a ? true : `${a} → ${b}`;
        }),
        check('IJ14：画面に 2006 年の時刻が出ない', async (page) => (!/2006/.test(await screenText(page)) ? true : '2006 が見える')),
        { shot: 's02-clock-jumped' },

        // ---- IJ24 ----
        check('IJ24：記録中の実効レート（2 項目）を読む', async (page, st) => {
            st.rate2 = await screenRate(page);
            return st.rate2 ? true : '実効レートが画面に無い';
        }),
        { say: 'チャンネルを 30 項目に増やして' },
        check('IJ24：30 項目を選ぶ（いろいろなブロックから）', async (page, st) => {
            const found = [];
            for (const q of ['vanos', 'lambda', 'temperature', 'voltage', 'throttle', 'knock', 'speed', 'pedal', 'ignition', 'air']) {
                const r = await tool(page, 'monitoring_log_channels', { query: q });
                for (const c of r?.found ?? []) if (/^\d+:/.test(c.channel) && !found.includes(c.channel)) found.push(c.channel);
            }
            st.thirty = found.slice(0, 30);
            return st.thirty.length === 30 ? true : `${st.thirty.length} 項目しか見つからない`;
        }),
        check('IJ24：記録中に 30 項目へ変えると、記録は止まらず、変わる（区切りが入る）', async (page, st) => {
            st.change = await tool(page, 'monitoring_log_channels', { channels: st.thirty });
            const d = await tool(page, 'monitoring_datalog', { max: 0 });
            if (!d.running) return '記録が止まった';
            return st.change?.changed === true ? true : `変わらない: ${st.change?.reason}`;
        }),
        check('IJ24：記録中に頼んだときの AI の答えに、増やしたあとのブロック数（画面と同じ数字）がある', async (page, st) => {
            const j = JSON.stringify(st.change ?? {});
            return /blocks/.test(j) ? true : `答え: ${j.slice(0, 200)}`;
        }),
        { shot: 's03-thirty-while-recording' },
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '（変えられないので）止める', expect: (r) => (r?.stopped ? true : JSON.stringify(r)) },
        { wait: 800 },
        check('IJ24：止めてから 30 項目を選ぶと、答えにブロック数が出る', async (page, st) => {
            st.change2 = await tool(page, 'monitoring_log_channels', { channels: st.thirty });
            return st.change2?.changed && st.change2.cost?.blocks > 1 ? true : JSON.stringify(st.change2).slice(0, 300);
        }),
        check('IJ24：画面に「30 項目 / n ブロック = 1 サンプルあたり n 往復」が出る', async (page, st) => {
            await page.waitForTimeout(500);
            const text = await screenText(page);
            const m = /30\s*項目\s*\/\s*(\d+)\s*ブロック/.exec(text);
            return m && Number(m[1]) === st.change2?.cost?.blocks ? true : `画面: ${(/\d+\s*項目\s*\/\s*\d+\s*ブロック[^\n]*/.exec(text) ?? ['無し'])[0]}`;
        }),
        { ai: 'monitoring_start_log', means: '30 項目で記録', expect: (r) => (r?.started ? true : JSON.stringify(r).slice(0, 200)) },
        { wait: 4000 },
        check('IJ24：30 項目の実効レートは 2 項目のときより低い（画面の数字）', async (page, st) => {
            st.rate30 = await screenRate(page);
            return st.rate30 && st.rate2 && st.rate30 < st.rate2 ? true : `2 項目 ${st.rate2} Hz、30 項目 ${st.rate30} Hz`;
        }),
        check('IJ24：AI が読む記録の数字（サンプル ÷ 秒）が画面の実効レートと同じ（±15 %）', async (page, st) => {
            const d = await tool(page, 'monitoring_datalog', { max: 0 });
            const hz = d.seconds > 0 ? d.samples / d.seconds : null;
            st.aiRate = hz;
            const screen = await screenRate(page);
            return hz && screen && Math.abs(hz - screen) / screen <= 0.15 ? true : `AI ${hz?.toFixed(1)} Hz、画面 ${screen} Hz`;
        }),
        { shot: 's04-thirty' },
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '止める', expect: (r) => (r?.stopped ? true : JSON.stringify(r)) },
    ]),
};

export default scenario;
