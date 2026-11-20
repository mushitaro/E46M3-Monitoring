import { always, bodyText, hasJa, onModule, practiceOneOnScreen, scanModules, tool } from './_owner.mjs';

/**
 * MM01（docs/VIRTUAL-CAR-TESTS.md M2）：買ったばかりの中古車を全部見る（めったに使わないものを含め 14）。
 * RDC・PDC・サンルーフ・シートメモリ（運転席・助手席）・ミラーメモリ（左右）・キセノン（左右）・アダプティブライト・SES・電話・ビデオ・
 * CD チェンジャーが載っていて、うち 4 つ（RDC・サンルーフ・キセノン左・アダプティブライト）に故障。
 */
const REC = [0x01, 0x05, 0x21, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
const FOURTEEN = [
    { addr: 0x70, id: 'rdc', ja: 'タイヤ空気圧 RDC' },
    { addr: 0x60, id: 'pdcact', ja: 'パークディスタンス PDC' },
    { addr: 0x08, id: 'shd46', ja: 'サンルーフ SHD' },
    { addr: 0x72, id: 'sm46_4', ja: 'シートメモリ 運転席' },
    { addr: 0xda, id: 'b_sm46_4', ja: 'シートメモリ 助手席' },
    { addr: 0x9b, id: 'spm46ft', ja: 'ミラーメモリ 運転席ドア' },
    { addr: 0x51, id: 'spm46bt', ja: 'ミラーメモリ 助手席ドア' },
    { addr: 0x98, id: 'xenon_l', ja: 'キセノン 左' },
    { addr: 0x86, id: 'xenon_r', ja: 'キセノン 右' },
    { addr: 0x66, id: 'alc_ds2', ja: 'アダプティブライト ALC' },
    { addr: 0xb0, id: 'ses', ja: '音声入力 SES' },
    { addr: 0xc8, id: 'telefon', ja: '電話' },
    { addr: 0xed, id: 'videomod', ja: 'ビデオモジュール' },
    { addr: 0x76, id: 'cdc_46', ja: 'CDチェンジャー' },
];
const FAULTY = [0x70, 0x08, 0x98, 0x66];
const hex = (a) => `0x${a.toString(16).toUpperCase().padStart(2, '0')}`;
const faultsOf = (m) => m?.faults ?? m?.sgbdRead?.faults ?? m?.codes ?? [];

const scenario = {
    id: 'MM01',
    title: '中古車を全部見る：14 のモジュール → 故障の 4 つ → 一つずつ練習で動かす → 故障を全部消す',
    story:
        '買ったばかりの中古 M3。オーナーが声で「全部見て」と頼む。AI は載っている数と故障のある 4 つを言い、画面の一覧に 14 個全部が日本語の名前で出る。' +
        '故障の 4 つを一つずつ開くと名前と状態が読める。14 個を一つずつ練習で動かし、動かせないものは理由が日本語で出る。最後に「故障を全部消して」。',
    car: {
        fitted: [0x32, 0x56, 0x57, 0x44, 0x00, 0x80, 0xd0, 0x50, 0x5b, 0x68, 0xf0, 0x7f, 0xa4, ...FOURTEEN.map((m) => m.addr)],
        moduleFaults: Object.fromEntries(FAULTY.map((a) => [a, REC])),
        dmeFaults: [],
        dscMk60: [],
    },
    steps: always([
        { say: '全部見て' },
        { ui: 'practice' },
        { ui: 'click', text: 'CONNECT', settle: 2500, means: '人が画面で PRACTICE につなぐ' },
        { ai: 'monitoring_scan', means: '全モジュールを読む', expect: (r) => (r?.started ? true : JSON.stringify(r)) },
        {
            check: {
                desc: 'AI が言える：載っているモジュールの数と、故障のあるのは 4 つ（RDC・サンルーフ・キセノン左・アダプティブライト）',
                run: async (page, st) => {
                    const mods = await scanModules(page);
                    if (typeof mods === 'string') return mods;
                    st.mods = mods;
                    const answered = mods.filter((m) => m.outcome === 'answered').length;
                    const withFaults = mods.filter((m) => faultsOf(m).length > 0).map((m) => m.address);
                    st.answered = answered;
                    const want = FAULTY.map(hex).sort();
                    return JSON.stringify(withFaults.sort()) === JSON.stringify(want) ? true : `応答 ${answered}、故障ありは ${withFaults.join(' ')}（想定 ${want.join(' ')}）`;
                },
            },
        },
        {
            check: {
                desc: '画面の一覧に 14 個全部が日本語の名前で出て、どれも読めている（応答なし・未解読・送らない が無い）',
                run: async (page) => {
                    const text = await bodyText(page);
                    const lines = text.split('\n');
                    const bad = [];
                    for (const m of FOURTEEN) {
                        const i = lines.findIndex((l) => l.trim() === hex(m.addr));
                        if (i < 0 || !lines[i + 1]?.includes(m.ja)) {
                            bad.push(`${m.ja}：一覧に無い`);
                            continue;
                        }
                        const state = lines[i + 2]?.trim() ?? '';
                        if (/応答なし|未解読|送らない/.test(state)) bad.push(`${m.ja}：${state}`);
                    }
                    return bad.length ? bad.join('、') : true;
                },
            },
        },
        { shot: 's01-all' },

        // ---- 2. 故障の 4 つを一つずつ開く ----------------------------------------------------------
        {
            check: {
                desc: '4 つとも故障の名前と状態（今出ている／散発）が日本語で読める。生のバイトだけのものが 0',
                run: async (page, st) => {
                    const bad = [];
                    for (const a of FAULTY) {
                        const m = (st.mods ?? []).find((x) => x.address === hex(a));
                        const f = faultsOf(m)[0];
                        const name = FOURTEEN.find((x) => x.addr === a).ja;
                        if (!f) {
                            bad.push(`${name}：故障が読めない（生のバイトだけ）`);
                            continue;
                        }
                        if (!f.text || /unbekannt|reserviert/i.test(f.text)) bad.push(`${name}：名前が無い（「${f.text}」）`);
                        else if (!hasJa(f.textJa ?? f.text)) bad.push(`${name}：名前が日本語でない（「${f.text}」）`);
                        if (!(f.kinds ?? []).length && f.present === undefined) bad.push(`${name}：状態が無い`);
                        else if ((f.kinds ?? []).length && !hasJa((f.kindsJa ?? f.kinds).join(''))) bad.push(`${name}：状態が日本語でない（「${f.kinds.join(' / ')}」）`);
                    }
                    return bad.length ? bad.join('、') : true;
                },
            },
        },
        {
            check: {
                desc: '画面：故障の 4 つを開くと、名前と状態が日本語で出る',
                run: async (page) => {
                    const bad = [];
                    for (const a of FAULTY) {
                        const name = FOURTEEN.find((x) => x.addr === a).ja;
                        const row = page.locator(`text=${hex(a)}`).first();
                        if ((await row.count()) === 0) {
                            bad.push(`${name}：行が無い`);
                            continue;
                        }
                        await row.click();
                        await page.waitForTimeout(600);
                        const text = await bodyText(page);
                        if (!/今出ている|現在あり|散発|過去/.test(text)) bad.push(`${name}：状態が日本語で出ない`);
                    }
                    return bad.length ? bad.join('、') : true;
                },
            },
        },
        { shot: 's02-faults' },

        // ---- 3. 14 個を一つずつ練習で動かす --------------------------------------------------------
        {
            check: {
                desc: '14 個を一つずつ練習で動かす：動かせるものは作動中 → 止まった。動かせないものは理由が日本語で出る',
                run: async (page, st) => {
                    const bad = [];
                    const ran = [];
                    for (const m of FOURTEEN) {
                        const r = await practiceOneOnScreen(page, m.id);
                        if (r.error) bad.push(`${m.ja}：${r.error}`);
                        else if (r.ran) {
                            ran.push(`${m.ja}=${r.ran}`);
                            if (r.error) bad.push(`${m.ja}：${r.ran} が送れない（${r.error}）`);
                            if (r.armedAfter > 0) bad.push(`${m.ja}：止めても STOP が押せるまま（止まっていない）`);
                        } else if (!r.pane) {
                            bad.push(`${m.ja}：動かす項目が 0 件で、なぜ無いかが出ない`);
                        } else if (r.chose && /値を選ぶ/.test(r.pane)) {
                            bad.push(`${m.ja}：値を選んでも RUN が押せず、札は「値を選ぶ」のまま（本当の理由が出ない）`);
                        } else if (!hasJa(r.pane)) {
                            bad.push(`${m.ja}：動かせない理由が日本語で出ない（${r.reason.slice(0, 80)}）`);
                        }
                    }
                    st.mm01ran = ran;
                    return bad.length ? `${bad.join('、')}（動いたもの：${ran.join(' ')}）` : true;
                },
            },
        },
        { shot: 's03-practice' },

        // ---- 4. 故障を全部消して ------------------------------------------------------------------
        { say: '故障を全部消して' },
        {
            check: {
                desc: 'AI が読み返す材料：故障のある 4 つの名前が、走査の答えから言える（日本語名か、読める英語名）',
                run: async (page) => {
                    const f = await tool(page, 'monitoring_faults');
                    const mods = f?.faults?.scan?.modules ?? f?.scan?.modules ?? [];
                    const names = mods.filter((m) => faultsOf(m).length).map((m) => (m.modules ?? []).map((x) => x.name).join(' / '));
                    return names.length === 4 && names.every((n) => n.length > 0) ? true : JSON.stringify(names);
                },
            },
        },
        { say: 'いいよ' },
        {
            check: {
                desc: '4 つの故障を消す（それぞれのモジュールの FS_LOESCHEN を AI が「いいよ」のあとに）',
                run: async (page) => {
                    const bad = [];
                    for (const a of FAULTY) {
                        const m = FOURTEEN.find((x) => x.addr === a);
                        const off = await onModule(page, m.id);
                        if (off) {
                            bad.push(off);
                            continue;
                        }
                        const r = await tool(page, 'monitoring_actuate', { module: m.id, job: 'FS_LOESCHEN', phase: 'pulse', owner_said: 'いいよ' });
                        if (r?.started !== true) bad.push(`${m.ja}：${r?.reason ?? JSON.stringify(r).slice(0, 120)}`);
                        await page.waitForTimeout(800);
                    }
                    return bad.length ? bad.join('、') : true;
                },
            },
        },
        {
            check: {
                desc: '読み直すと 4 つとも 0 件',
                run: async (page) => {
                    await tool(page, 'monitoring_module', { module: 'mss54' });
                    await page.waitForTimeout(2500);
                    const s = await tool(page, 'monitoring_scan');
                    if (!s?.started) return JSON.stringify(s);
                    const mods = await scanModules(page);
                    if (typeof mods === 'string') return mods;
                    const left = mods.filter((m) => faultsOf(m).length > 0).map((m) => m.address);
                    return left.length === 0 ? true : `故障が残る: ${left.join(' ')}`;
                },
            },
        },
        { shot: 's04-cleared' },
    ]),
};

export default scenario;
