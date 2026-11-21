import { always, bodyText, scanModules, tool } from './_owner.mjs';

/**
 * SC10（docs/VIRTUAL-CAR-TESTS.md M1）：M3 ではない E46（友人の 330i）。
 * 接続して全モジュール → エンジンは「MS43」、変速機は「GS20」の名前で出る。M3 専用のもの（SMG の手順など）は出ない。
 * エンジンの故障を読む → 故障の名前と「この車種では実車で確かめていません」。人の書いた訳の無い名前（辞書の語を機械が並べただけ、
 * 0x01「Zuendung Zyl. 2」→「点火気筒2」）は、画面も AI も「故障（訳なし）」と SGBD のドイツ語で言う。分からないモジュールは「?」で、
 * 触っても何も送らない旨が出る。
 */
const scenario = {
    id: 'SC10',
    title: 'M3 ではない E46（330i）：MS43 と GS20 の名前、M3 専用は出ない、故障に実車未確認、「?」は送らない',
    story:
        '友人の 330i（MS43・GS20 の AT）に、オーナーが PC でつなぐ。全モジュールを読むと、エンジンは MS43、変速機は GS20 の名前で出て、' +
        'SMG の手順のような M3 専用のものは出ない。エンジンの故障を読むと、故障の名前に「実車で確かめていません」が添えてある。' +
        '人の書いた訳の無い名前は、画面も AI も「訳なし」と言い、SGBD のドイツ語を添える。' +
        '名前の分からないモジュールは「?」で、触っても何も送らないと画面が言う。',
    car: {
        idents: { 0x12: { hw: '19', diag: '10' }, 0x32: { hw: '29', diag: '00' }, 0x80: { data: [0x09, 0x99, 0x99, 0x99, 0x01, 0x00, 0x50, 0x00, 0x12, 0x03, 0x00, 0x00, 0x00] } },
        dmeFaults: [],
        // 0x08 Luftmassenmesser は厳選フレーズ表の訳（エアフローセンサ）、0x01 Zuendung Zyl. 2 は辞書の語を並べただけの訳。
        ms43Faults: [
            { code: 0x08, present: true, count: 3 },
            { code: 0x01, present: true, count: 1 },
        ],
        dscMk60: null,
    },
    steps: always([
        { say: 'この車、全部見て' },
        { ui: 'practice' },
        { ui: 'click', text: 'CONNECT', settle: 2500, means: '人が画面で PRACTICE につなぐ' },
        { ai: 'monitoring_scan', means: '全モジュールを読む', expect: (r) => (r?.started ? true : JSON.stringify(r)) },
        {
            check: {
                desc: '読み終わる。0x12 は MS43、0x32 は GS20 と選ばれる',
                run: async (page, st) => {
                    const mods = await scanModules(page);
                    if (typeof mods === 'string') return mods;
                    st.mods = mods;
                    const at = (a) => mods.find((m) => m.address === a);
                    return at('0x12')?.variant?.sgbd === 'MS430DS0' && at('0x32')?.variant?.sgbd === 'GS20' ? true : JSON.stringify({ dme: at('0x12')?.variant, gs: at('0x32')?.variant });
                },
            },
        },
        {
            check: {
                desc: '画面：エンジンは「MS43」、変速機は「GS20」の名前で出る。MSS54・SMG II の名前は出ない',
                run: async (page) => {
                    const text = await bodyText(page);
                    const list = text.slice(text.indexOf('全モジュール'), text.indexOf('\nVISU\n'));
                    const why = [];
                    if (!/MS43/.test(list)) why.push('MS43 が無い');
                    if (!/GS20/.test(list)) why.push('GS20 が無い');
                    if (/MSS54/.test(list)) why.push('一覧に MSS54 の名前も並ぶ');
                    if (/SMG II/.test(list)) why.push('一覧に SMG II の名前も並ぶ');
                    return why.length ? why.join('、') : true;
                },
            },
        },
        { shot: 's01-scan' },
        {
            check: {
                desc: 'M3 専用のもの（SMG の手順）は出ない：SMG II を選ぼうとしても、この車では GS20 だと言う',
                run: async (page) => {
                    const since = await page.evaluate(() => Date.now());
                    const r = await tool(page, 'monitoring_module', { module: 'smg2' });
                    await page.waitForTimeout(2500);
                    const p = await tool(page, 'monitoring_procedure', { procedure: '0x02', owner_said: 'いいよ' });
                    const said = JSON.stringify([r, p]);
                    await page.waitForTimeout(800);
                    const dialog = await page.locator('[role=dialog]:has-text("手順")').count();
                    if (dialog) {
                        await tool(page, 'monitoring_stop_outputs');
                        await page.waitForTimeout(1500);
                        const text = (await page.locator('[role=dialog]').first().innerText()).replace(/\n/g, ' ').slice(0, 120);
                        const close = page.locator('[role=dialog] button:has-text("CLOSE")');
                        if (await close.count()) await close.first().click();
                        const wire = await page.evaluate((s) => window.__monitoringE2E.car.wire(s), since);
                        const sent = wire.filter((f) => f.to === 0x32 && !/^32 04 00/.test(f.hex)).map((f) => f.hex);
                        return `M3 でない車（0x32 は GS20）で SMG II を選べ、手順のダイアログが開いた（「${text}」）。0x32 へ IDENT のほかに送った電文 ${sent.length} 通: ${sent.slice(0, 4).join(' / ')}`;
                    }
                    return p?.started === false && /GS20|not an M3|M3/.test(said) ? true : `理由に GS20 が無い: ${said.slice(0, 300)}`;
                },
            },
        },
        {
            check: {
                desc: '画面のモジュールの一覧（ヘッダの選択）に、この車に無い M3 専用のもの（MSS54・SMG II）が並ばない',
                run: async (page) => {
                    const opts = await page.locator('select:has(option[value="smg2"]) option').allTextContents();
                    return opts.some((o) => /SMG II/.test(o)) ? `一覧に SMG II がある（${opts.length} 件）` : true;
                },
            },
        },
        { say: 'エンジンの故障を読んで' },
        {
            ai: 'monitoring_module',
            args: { module: 'ms430ds0' },
            means: '画面を MS43 に',
            expect: (r) => (r?.switched ? true : JSON.stringify(r)),
        },
        { wait: 2500 },
        {
            ai: 'monitoring_faults',
            args: { module: 'ms430ds0', refresh: true },
            means: 'MS43 の故障を読む。名前（SGBD の故障文）と、実車未確認の注記',
            expect: (r) => {
                const f = r?.faults ?? r;
                const c = (f?.codes ?? []).find((x) => x.code === '0x08');
                // A name no person translated: the screen's own word for it (故障（訳なし）), no English name, and the SGBD's German.
                const u = (f?.codes ?? []).find((x) => x.code === '0x01');
                const plain = u && u.textJa === '故障（訳なし）' && u.text === null && u.untranslated === true && /Zuendung/.test(u.original ?? '');
                return f?.unverified === true && c?.text && plain ? true : JSON.stringify(f).slice(0, 300);
            },
        },
        {
            check: {
                desc: '画面：故障の名前が出て（人の書いた訳の無いものは「故障（訳なし）」と SGBD のドイツ語）、「この車種では実車で確かめていません」と添えてある',
                run: async (page) => {
                    const text = await bodyText(page);
                    if (!/0x08/.test(text) || !/0x01/.test(text)) return 'コードが無い';
                    if (!/故障（訳なし）/.test(text) || !/Zuendung Zyl\. 2/.test(text)) return '訳の無い名前が「故障（訳なし）」と SGBD のドイツ語で出ない';
                    // Since UX-16 the note is the word「実車未確認」under the faults' heading; its sentence is the ⓘ.
                    return /実車未確認|実車[^\n]*確かめていません/.test(text) ? true : '実車未確認の注記が無い';
                },
            },
        },
        {
            check: {
                desc: 'U5：故障の名前が日本語で読める（ドイツ語の SGBD の文だけではない）',
                run: async (page) => {
                    const f = await tool(page, 'monitoring_faults', { module: 'ms430ds0' });
                    const c = ((f?.faults ?? f)?.codes ?? []).find((x) => x.code === '0x08');
                    return c && /[぀-ヿ一-鿿]/.test(c.textJa ?? c.text ?? '') ? true : `日本語の名前が無い: ${c?.text}`;
                },
            },
        },
        { shot: 's02-ms43-faults' },
        { say: 'ボディのモジュールも見て' },
        {
            check: {
                desc: '分からないモジュール（0x00 ボディ）：一覧に「?」と出る',
                run: async (page, st) => {
                    const m = (st.mods ?? []).find((x) => x.address === '0x00');
                    if (m?.variant?.sgbd !== '?') return `0x00 の変種: ${JSON.stringify(m?.variant)}`;
                    return true;
                },
            },
        },
        {
            check: {
                desc: '触る（画面でボディを選んで故障を読む）と、IDENT のほかは何も送らず、その旨が画面に出る',
                run: async (page) => {
                    await page.evaluate(() => window.__monitoringE2E.car.clearWire());
                    const since = await page.evaluate(() => Date.now());
                    await tool(page, 'monitoring_module', { module: 'zke5' });
                    await page.waitForTimeout(2500);
                    const r = await tool(page, 'monitoring_faults', { module: 'zke5', refresh: true });
                    await page.waitForTimeout(1000);
                    const wire = await page.evaluate((s) => window.__monitoringE2E.car.wire(s), since);
                    const beyond = wire.filter((f) => f.to === 0x00 && !/^00 04 00/.test(f.hex));
                    if (beyond.length) return `IDENT のほかに送った: ${beyond.map((f) => f.hex).join(' / ')}`;
                    const text = await bodyText(page);
                    if (r?.refreshed === true) return '読めたと答えた';
                    return /送りません|送らない/.test(text) ? true : `画面に「送らない」旨が無い（AI の答え: ${r?.reason ?? ''}）`;
                },
            },
        },
        { shot: 's03-unknown' },
        {
            check: {
                desc: 'U8：画面にも AI の答えにも VIN が出ない',
                run: async (page) => {
                    const s = JSON.stringify(await tool(page, 'monitoring_faults')) + JSON.stringify(await tool(page, 'monitoring_status')) + (await bodyText(page));
                    return s.includes('JR12345') ? 'VIN が出ている' : true;
                },
            },
        },
    ]),
};

export default scenario;
