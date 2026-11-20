import { connectPractice, tool } from './_lib.mjs';
import { always, check, onModule, pageNow, setCar, startPump, wireSince } from './_ij.mjs';

/** SMG II's test program stop (TESTPRG_STOP), as the practice car hears it. */
const TESTPRG_STOP = '32 04 33 05';

/** The procedure dialog, followed until it shows its result; its text. */
const runToEnd = async (page) => {
    const dialog = page.locator('[role=dialog]').first();
    await dialog.waitFor({ timeout: 5000 });
    let text = '';
    for (let i = 0; i < 80; i++) {
        text = await dialog.innerText();
        if (i > 3 && /正常に終了|正常には終了|中止|断り|refused/.test(text)) break;
        await page.waitForTimeout(500);
    }
    return text;
};

/**
 * IJ06・IJ19（いじわる：手順の途中で断られる・練習したのは別の部品）。
 * IJ06 は練習の車に、手順の途中の問い合わせを一度だけ否定応答（0xA2）で返させる。
 * IJ19 の実車の札は、テストのビルドが実車の線を開けないので実車でだけ確かめる（FINDINGS-ij.md）。
 */
const scenario = {
    id: 'IJ06-19',
    title: '手順の途中でモジュールが断る・練習したのは別の部品',
    story:
        'IJ06：SMG II のエア抜きの途中で、モジュールが問い合わせを断る。ダイアログに「モジュールが断りました」と理由。手順は止まり、AI も同じことを言う。' +
        'IJ19：練習したのは油圧ポンプなのに、クラッチの弁を実車で動かそうとする。札は「練習から」、AI も「その部品はまだ練習していません」と言う。',
    steps: always([
        ...connectPractice,
        check('SMG II を画面に出してつなぐ', async (page) => (await onModule(page, 'smg2')) ?? true),
        { car: { engineRunning: false }, means: 'エア抜きはエンジン停止で（手順の前提）' },

        // ---- IJ06 ----
        { say: 'エア抜きをして' },
        { say: 'いいよ' },
        check('IJ06：手順の 2 回目の問い合わせを、モジュールが断るように仕込む', async (page) => {
            await setCar(page, { inject: [{ to: 0x32, ctrl: 0x32, kind: 'negative', skip: 1, times: 1 }] });
            return true;
        }),
        check('IJ06：AI が手順を始める', async (page, st) => {
            st.t6 = await pageNow(page);
            const r = await tool(page, 'monitoring_procedure', { procedure: '0x01', owner_said: 'いいよ' });
            return r?.started === true ? true : JSON.stringify(r).slice(0, 300);
        }),
        check('IJ06：手順は止まる：正常に終わったとは言わず、TESTPRG_STOP が届く', async (page, st) => {
            st.dialog6 = await runToEnd(page);
            const stop = (await wireSince(page, st.t6)).filter((f) => f.hex === TESTPRG_STOP).length;
            if (/正常に終了しました/.test(st.dialog6)) return `正常に終わったと言う: ${st.dialog6.slice(0, 200)}`;
            return stop >= 2 ? true : `TESTPRG_STOP ${stop} 回（前後に一回ずつのはず）`;
        }),
        check('IJ06：ダイアログが「モジュールが断りました」と理由を言う（U2）', async (page, st) =>
            /断りました|断った|拒否|否定応答|refused/i.test(st.dialog6 ?? '') ? true : `理由が無い: ${(st.dialog6 ?? '').replace(/\n+/g, ' / ').slice(0, 300)}`,
        ),
        { shot: 's01-procedure-refused' },
        check('IJ06：AI にも、手順がモジュールに断られて止まったことが分かる（U3）', async (page) => {
            const s = await tool(page, 'monitoring_status');
            const j = JSON.stringify(s);
            return /procedure|TESTPRG/i.test(j) && /refus|reject|断/i.test(j) ? true : `状態に手順の結果が無い: error=${s.error}`;
        }),
        check('後片付け：ダイアログを閉じる', async (page) => {
            await page.locator('[role=dialog] button', { hasText: 'Close' }).first().click().catch(() => {});
            await page.waitForTimeout(500);
            return true;
        }),
        { car: { engineRunning: true, inject: [] }, means: 'エンジンをかける' },

        // ---- IJ19 ----
        check('IJ19：練習で油圧ポンプだけを一度動かす', async (page) => {
            await page.waitForTimeout(1500);
            const r = await startPump(page);
            await tool(page, 'monitoring_stop_outputs');
            return r?.started ? true : JSON.stringify(r).slice(0, 300);
        }),
        { shot: 's02-practised-pump' },
        check('IJ19：台帳に、油圧ポンプは練習済み、クラッチの弁はまだ、と部品ごとに残る', async (page, st) => {
            const r = await tool(page, 'monitoring_ledger', { module: 'smg2' });
            st.ledger = r;
            const ids = (r?.records ?? []).map((x) => x.id);
            const pump = ids.some((id) => /STEUERN_STELLGLIED\(HYDROPUMPE\)/.test(id));
            const valve = ids.some((id) => /STEUERN_STELLGLIED\(MAGNETVENTIL_KUPPLUNG\)/.test(id));
            return pump && !valve ? true : `台帳: ${ids.join(', ')}`;
        }),
        check('IJ19：AI の台帳の答えで「練習した」が読める（その部品はまだ練習していません、と言える）', async (page, st) => {
            const rec = (st.ledger?.records ?? []).find((x) => /HYDROPUMPE/.test(x.id));
            return rec && ('practiced' in rec || 'practicedAt' in rec) ? true : `答えに練習の欄が無い: ${JSON.stringify(rec).slice(0, 200)}`;
        }),
        { shot: 's03-ledger' },
    ]),
};

export default scenario;
