import { connectPractice, plan, startProbe, tool } from './_lib.mjs';
import { always, check, screenText } from './_ij.mjs';

/** A steady cruise in fourth: nothing happens in it. */
const CRUISE = {
    points: [
        { t: 0, gear: 4, kmh: 60, rpm: 2400, pedal: 15, inSoll: 20, inIst: 20, exSoll: -8, exIst: -8 },
        { t: 600, gear: 4, kmh: 60, rpm: 2400, pedal: 15, inSoll: 20, inIst: 20, exSoll: -8, exIst: -8 },
    ],
};
const WORDS = '走りながら、VANOS と回転を見て';
const CHANNELS = ['3:n', '35:evan1_ist', '35:evan1_soll', '35:avan1_ist', '35:avan1_soll'];

/** A second device: the head unit, opened by the launcher, in a browser profile of its own. */
const openHeadUnit = async (page) => {
    const ctx = await page.context().browser().newContext({ viewport: { width: 683, height: 400 }, locale: 'ja-JP' });
    const nav = await ctx.newPage();
    await nav.goto(`${new URL(page.url()).origin}/?from=manifold`);
    await nav.waitForFunction(() => !!window.__monitoringE2E, null, { timeout: 15000 });
    const agree = nav.locator('button:has-text("同意")');
    if (await agree.count()) await agree.first().click();
    return { ctx, nav };
};

/**
 * IJ17・IJ18・IJ25（いじわる：二つの端末・電波が無い・何も起きていないのに「今の何？」）。
 */
const scenario = {
    id: 'IJ17-18-25',
    title: 'ナビと PC の両方で ASSISTANT・電波の無い所で「上げて」・巡航中に「今の何？」',
    story:
        'IJ17：ナビと PC の両方で ASSISTANT をオン。AI が「いま答えているのは PC です」と最初に言う。' +
        'IJ18：電波の無い所で「上げて」。AI「電波が戻ったら送ります」。戻ると送られ、送った印が付く。' +
        'IJ25：「今の何？」を、踏んでいない時（一般道の巡航中）に聞く。AI が、その時点では目立った変化が無いと言う。無い遅れを作らない。',
    steps: always([
        ...connectPractice,

        // ---- IJ17 ----
        check('IJ17：この端末（PC）の状態は device: PC', async (page, st) => {
            st.pc = (await tool(page, 'monitoring_status')).device;
            return st.pc === 'PC' ? true : `device: ${st.pc}`;
        }),
        check('IJ17：ランチャーから開いたナビの状態は device: ナビ（二つの端末が名前で分かれる）', async (page, st) => {
            const { ctx, nav } = await openHeadUnit(page);
            try {
                st.nav = await nav.evaluate(async () => (await window.__monitoringE2E.tool('monitoring_status')).device);
            } finally {
                await ctx.close();
            }
            return st.nav === 'ナビ' && st.nav !== st.pc ? true : `ナビ: ${st.nav}、PC: ${st.pc}`;
        }),
        check(
            'IJ17：AI が読む手順書が「ナビ以外が答えているなら、最初にそう言う」と言う',
            async (page) => {
                const text = await page.evaluate(async () => (await fetch('/guide/index.md')).text());
                return /ナビ以外が答えているなら、最初にそう言う/.test(text) ? true : '手順書にその決まりが無い';
            },
            'どちらのタブが答えるかは中継が決める（実車のみ・FINDINGS-ij.md）。言い回しは声のリハーサル',
        ),
        { shot: 's01-pc' },

        // ---- IJ18 ----
        { ai: 'monitoring_faults', args: { refresh: true }, means: '故障を読む（送るものを作る）', expect: (r) => (r?.refreshed ? true : JSON.stringify(r).slice(0, 200)) },
        check('IJ18：電波が無くなる', async (page, st) => {
            st.posts = [];
            page.on('request', (r) => {
                if (/\/api\/sessions/.test(r.url()) && r.method() !== 'GET') st.posts.push({ at: Date.now(), method: r.method() });
            });
            await page.context().setOffline(true);
            return true;
        }),
        { say: '上げて' },
        check('IJ18：AI の答えが「電波が無い。戻ったら送る」と言う', async (page, st) => {
            st.sync = await tool(page, 'monitoring_sync_upload', { confirmed: true });
            const j = JSON.stringify(st.sync);
            return /offline|no network|電波|when .*back/i.test(j) ? true : `答え: ${j}`;
        }),
        { ui: 'tab', name: 'MEMORY' },
        check('IJ18：画面も「オフライン。電波のある所で送れます」と言う（U3）', async (page) => {
            const text = await screenText(page);
            return /オフライン|電波/.test(text) ? true : '画面に電波が無いことが出ない';
        }),
        { shot: 's02-offline' },
        check('IJ18：電波が戻ると、頼み直さなくても送りに行く', async (page, st) => {
            const back = Date.now();
            await page.context().setOffline(false);
            for (let i = 0; i < 20; i++) {
                await page.waitForTimeout(500);
                if (st.posts.some((p) => p.at >= back)) return true;
            }
            return '電波が戻って 10 秒、送りに行かない（もう一度「上げて」が要る）';
        }, '送った印が付くかはアカウントのサーバーが要る（テストのビルドには無い）'),
        { shot: 's03-online-again' },

        // ---- IJ25 ----
        { ui: 'tab', name: 'DIAGNOSIS' },
        {
            ai: 'monitoring_investigate',
            args: { words: WORDS, modules: ['mss54'], days: 7, mode: 'symptom' },
            means: '走りながら見る調査',
            expect: (r) => (r && r.record && r.mandate ? true : JSON.stringify(r)),
            keep: (r, st) => Object.assign(st, { record: r.record, mandate: r.mandate }),
        },
        plan({ purpose: '巡航中の VANOS と回転', steps: [{ n: 1, do: 'VANOS と回転', kind: 'sample', channels: CHANNELS }] }),
        { car: { drive: CRUISE }, means: '一般道を 4 速 60 km/h で巡航（踏んでいない）' },
        startProbe,
        { wait: 14000 },
        { say: '今の何？' },
        check('IJ25：「今」の窓に記録がある（8 秒前を中心に 20 秒）', async (page, st) => {
            st.moment = await tool(page, 'monitoring_moment', { seconds_ago: 8, window_s: 20, channels: CHANNELS });
            return st.moment?.recorded && st.moment.samples.length > 3 ? true : JSON.stringify(st.moment).slice(0, 300);
        }),
        check('IJ25：その時点に目立った変化が無い：回転の幅 50 rpm 未満、カムの実測は目標から 0.5° 以内', async (page, st) => {
            const s = st.moment?.samples ?? [];
            const v = (k) => s.map((x) => x.values?.[k]).filter((x) => typeof x === 'number');
            const n = v('3:n');
            const spread = n.length ? Math.max(...n) - Math.min(...n) : NaN;
            const lag = (a, b) => {
                const x = v(a);
                const y = v(b);
                return Math.max(0, ...x.map((xi, i) => Math.abs(xi - (y[i] ?? xi))));
            };
            const inLag = lag('35:evan1_ist', '35:evan1_soll');
            const exLag = lag('35:avan1_ist', '35:avan1_soll');
            return spread < 50 && inLag <= 0.5 && exLag <= 0.5 ? true : `回転の幅 ${spread} rpm、吸気 ${inLag}°、排気 ${exLag}°`;
        }, 'AI の言い回し（「目立った変化はありません」）は声のリハーサルで見る'),
        check('IJ25：その窓にタブが捕まえた瞬間（capture）もドライバーの言葉も無い（作る材料が無い）', async (page, st) =>
            (st.moment?.captures ?? []).length === 0 && (st.moment?.driverWords ?? []).length === 0 ? true : JSON.stringify({ c: st.moment?.captures, w: st.moment?.driverWords }).slice(0, 200),
        ),
        { shot: 's04-cruise' },
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '止める（復唱のあと）', expect: (r) => (r?.stopped ? true : JSON.stringify(r)) },
    ]),
};

export default scenario;
