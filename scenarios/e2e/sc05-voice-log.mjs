import { NAVI, all, ask, connect, inView, noVin, openNavi, screenText } from './_sc01-07.mjs';

/**
 * SC05 記録を取る（声）。docs/VIRTUAL-CAR-TESTS.md M1。
 * 走りの筋書き（practiceCar.drive）で、ギアと回転が分かっている走りを流す。15 分の走りと 10 分の区切りは、
 * アプリに時間を縮める口が無いので、区切りの印が答えと画面にあるかだけを見る。
 */
const DRIVE = {
    points: [
        { t: 0, kmh: 0, rpm: 900, gear: 0 },
        { t: 2, kmh: 20, rpm: 2500, gear: 1 },
        { t: 5, kmh: 45, rpm: 4200, gear: 2 },
        { t: 8, kmh: 60, rpm: 3800, gear: 3 },
        { t: 600, kmh: 60, rpm: 3800, gear: 3 },
    ],
};

const scenario = {
    id: 'SC05',
    title: '記録を取る（声）：「油温と回転を記録して」→ 走る → 「止めて」は聞き返してから → 「さっきの」→ 保存して送る',
    story:
        '声で「油温と回転を記録して」。AI が記録を始め、ナビの DATALOG に 2 本のグラフと記録中の印。15 分走ると 10 分で区切られる。' +
        '「止めて」には「記録を止めますか？」と聞き返し、「はい」で止まる。「さっきの、何だった？」に何秒前・何速・何回転とその値を言い、グラフにも印。' +
        '「保存して、上げて」で保存して送り、SESSIONS に記録と送った印。',
    viewport: NAVI,
    steps: all([
        openNavi(),
        ...connect,
        // 1. 「油温と回転を記録して」
        { say: '油温と回転を記録して' },
        {
            check: {
                desc: '手順 1：AI が油温と回転を、日本語の名前で見つけられる',
                run: async (page, st) => {
                    const oil = await ask(page, st, 'monitoring_log_channels', { query: '油温' });
                    const rpm = await ask(page, st, 'monitoring_log_channels', { query: '回転' });
                    const a = (oil.found ?? []).find((c) => c.channel === '3:toel');
                    const b = (rpm.found ?? []).find((c) => c.channel === '3:n');
                    return a?.ja && a.unit && b?.ja && b.unit ? true : JSON.stringify({ a, b });
                },
            },
        },
        {
            check: {
                desc: '手順 1：AI が選んで記録を始め、答えが「始めた」と二つの値を言う',
                run: async (page, st) => {
                    const sel = await ask(page, st, 'monitoring_log_channels', { channels: ['3:toel', '3:n'] });
                    if (!sel.changed) return JSON.stringify(sel).slice(0, 200);
                    const r = await ask(page, st, 'monitoring_start_log');
                    st.started = r;
                    if (r.error || !r.started) return JSON.stringify(r).slice(0, 200);
                    const names = (r.stats ?? []).map((x) => x.ja);
                    return names.length === 2 && names.every(Boolean) ? true : JSON.stringify(r).slice(0, 200);
                },
            },
        },
        {
            check: {
                desc: '手順 1：始めた直後の答えが「記録中」と言う（running と started が食い違わない）',
                run: async (_page, st) => (st.started?.running === true ? true : `started: true なのに running: ${st.started?.running}`),
            },
        },
        { car: { drive: DRIVE }, means: '走り出す（ギアと回転の分かっている筋書き）' },
        { wait: 3000 },
        {
            check: {
                desc: '手順 1：ナビの DATALOG に 2 本のグラフ（油温・回転）が見え、記録中の印と STOP がある',
                run: async (page) => {
                    const why = [];
                    if (!(await inView(page, '油温'))) why.push('油温のグラフが見えない');
                    if (!(await inView(page, 'エンジン回転数'))) why.push('回転のグラフが見えない（スクロールしないと出ない）');
                    if (!(await inView(page, 'LOGGING'))) why.push('記録中の印が無い');
                    if (!(await inView(page, 'STOP'))) why.push('STOP が無い');
                    return why.length ? why.join('、') : true;
                },
            },
        },
        { shot: 's01-recording' },
        // 2. 15 分走る（10 分で区切られる）
        {
            check: {
                desc: '手順 2：記録が 10 分で区切られ、2 つ目に入ったと分かる（時間を縮める口が無いので、区切りの印が答えと画面にあるかを見る）',
                run: async (page, st) => {
                    const d = await ask(page, st, 'monitoring_datalog', { max: 0 });
                    const t = await screenText(page);
                    const inAnswer = Object.keys(d).some((k) => /segment|part|chunk|区切/.test(k));
                    const onScreen = /区切|1 つ目|2 つ目|PART|SEG/.test(t);
                    return inAnswer || onScreen ? true : '10 分の区切りが、答えにも画面にも無い（MEMORY のまとまりは 10 分の「無記録」で切れるだけ。連続の記録を区切る仕組みが無い）';
                },
            },
        },
        // 3. 「止めて」
        { say: '止めて' },
        {
            check: {
                desc: '手順 3：聞き返しの前（confirmed なし）には止まらない',
                run: async (page, st) => {
                    const r = await ask(page, st, 'monitoring_stop_log', {});
                    const s = await ask(page, st, 'monitoring_status');
                    if (!r.error) return `確認なしで答えた：${JSON.stringify(r)}`;
                    return s.recording === true ? true : '確認なしで止まった';
                },
            },
        },
        { say: 'はい' },
        {
            ai: 'monitoring_stop_log',
            args: { confirmed: true },
            means: '「はい」で止まる',
            expect: (r) => (r?.stopped === 'recording' ? true : JSON.stringify(r)),
        },
        { wait: 800 },
        {
            check: {
                desc: '手順 3：画面の記録中の印が消える',
                run: async (page) => ((await inView(page, 'LOGGING')) ? 'LOGGING のまま' : true),
            },
        },
        { shot: 's03-stopped' },
        // 4. 「さっきの、何だった？」
        { say: 'さっきの、何だった？' },
        {
            check: {
                desc: '手順 4：AI の答えに、何秒前・何速・何回転と、その時の値（油温）が入る（言い方は声の稽古で確かめる）',
                run: async (page, st) => {
                    const m = await ask(page, st, 'monitoring_moment', { seconds_ago: 3, window_s: 4 });
                    if (m.recorded !== true) return `monitoring_moment は DATALOG の記録を見ない：「${m.reason}」`;
                    const s = JSON.stringify(m.samples?.[0] ?? {});
                    return /3:n/.test(s) && /3:toel/.test(s) && /gang|gear/.test(s) ? true : `値が足りない：${s.slice(0, 200)}`;
                },
            },
        },
        {
            check: {
                desc: '手順 4：画面のグラフでも同じ時刻に印が出る',
                run: async (page) => {
                    const marks = await page.locator('[data-moment], [data-mark]').count();
                    return marks > 0 ? true : 'グラフに AI が言った時刻の印を置く仕組みが無い（DATALOG のグラフに印が出ない）';
                },
            },
        },
        // 5. 「保存して、上げて」
        { say: '保存して、上げて' },
        {
            check: {
                desc: '手順 5：保存した答えに、記録のサンプルが入る',
                run: async (page, st) => {
                    const r = await ask(page, st, 'monitoring_save', { confirmed: true });
                    st.saved = r;
                    return r.saved && r.sampleCount > 0 ? true : JSON.stringify(r);
                },
            },
        },
        {
            check: {
                desc: '手順 5：送った答えが「送った」と言う。送れないなら、答えと画面が同じ理由を言う（テスト用のビルドには送り先が無い）',
                run: async (page, st) => {
                    const r = await ask(page, st, 'monitoring_sync_upload', { confirmed: true });
                    st.sync = r;
                    if (r.sent >= 1) return true;
                    if (!r.reason || !r.note) return `sent: ${r.sent}、waiting: ${r.waiting}、理由が無い（AI が「送りました」と言うか「送れません」と言うか決められない）`;
                    // The screen says the same, in the owner's words, on MEMORY's notice line.
                    await ask(page, st, 'monitoring_display', { show: 'memory', pane: 'list' });
                    await page.waitForTimeout(800);
                    const t = await screenText(page);
                    const said = t.split('\n').find((l) => /送れませんでした|電波がありません/.test(l));
                    if (!said) return `答えの理由は「${r.reason}」だが、画面に送れなかった理由が無い`;
                    if (r.reason === 'noDestination' && !/送り先がありません/.test(said)) return `答えは送り先が無い、画面は「${said}」`;
                    return true;
                },
            },
        },
        {
            check: {
                desc: '手順 5：SESSIONS（MEMORY）に記録が出る。送った印は実車のみ（サインインした WORKS 版で送れたとき）',
                run: async (page, st) => {
                    await ask(page, st, 'monitoring_display', { show: 'memory', pane: 'list' });
                    await page.waitForTimeout(800);
                    const t = await screenText(page);
                    if (!st.saved?.label || !t.includes(st.saved.label)) return `記録「${st.saved?.label}」が画面に無い（画面：${t.split('\n').slice(3, 9).join(' / ')}）`;
                    // Sent here (a build with somewhere to send): the mark must show. Not sent: the reason above is the check.
                    if (st.sync?.sent >= 1) return /送信済|SYNCED|クラウド/.test(t) ? true : '送ったのに送った印が無い';
                    return true;
                },
            },
            means: '送った印は、送り先のある WORKS 版でサインインして送れたときだけ（実車のみ）。テスト用のビルドでは、記録が出ることと送れない理由を見る',
        },
        { shot: 's05-sessions' },
        noVin,
    ]),
};

export default scenario;
