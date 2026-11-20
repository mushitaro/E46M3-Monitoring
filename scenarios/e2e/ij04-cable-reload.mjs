import { connectPractice, tool } from './_lib.mjs';
import { PUMP_OFF, always, armedOnScreen, check, onModule, pageNow, screenText, setCar, startPump, wireSince } from './_ij.mjs';

/**
 * IJ04・IJ13（いじわる：動作中に線やページが消える）。
 * 動作中にケーブルが抜ける（練習の車の lineDown）、動作中にページを読み込み直す（ナビのキーオフ・誤操作）。
 */
const scenario = {
    id: 'IJ04-13',
    title: '動作中にケーブルが抜ける・ページを読み込み直す',
    story:
        'IJ04：油圧ポンプが動作中にケーブルが抜ける。画面「接続が切れました。つなぎ直しています」→ つながると「止めました」。動作中の表示が残らない。' +
        'IJ13：動作中に画面を閉じる・再読み込み。開き直すと動作中の表示が無く、「時間切れで止まった」が残る。',
    steps: always([
        ...connectPractice,
        check('SMG II を画面に出してつなぐ', async (page) => (await onModule(page, 'smg2')) ?? true),

        // ---- IJ04 ----
        check('IJ04：油圧ポンプを動かす（AI、「いいよ」のあと）', async (page) => {
            const r = await startPump(page);
            return r?.started && r.on ? true : JSON.stringify(r).slice(0, 300);
        }),
        { shot: 's01-pump-on' },
        check('IJ04：ケーブルが抜ける（線が黙る）', async (page, st) => {
            st.t4 = await pageNow(page);
            await setCar(page, { lineDown: true });
            return true;
        }),
        check(
            'IJ04：15 秒以内に、画面が「接続が切れました。つなぎ直しています」と言う',
            async (page, st) => {
                for (let i = 0; i < 30; i++) {
                    await page.waitForTimeout(500);
                    const text = await screenText(page);
                    if (/切れ/.test(text) && /つなぎ直|再接続/.test(text)) return true;
                }
                const s = await tool(page, 'monitoring_status');
                st.downStatus = s;
                return `15 秒たっても言わない。link=${s.link} error=${s.error}`;
            },
        ),
        check('IJ04：AI の状態も、線が切れたと言う（U3）', async (page) => {
            const s = await tool(page, 'monitoring_status');
            return s.link !== 'connected' || /lost|no answer|timed out|切れ/i.test(s.error ?? '') ? true : `link=${s.link} error=${s.error}`;
        }),
        { shot: 's02-line-down' },
        check('IJ04：線が戻る', async (page, st) => {
            st.t4up = await pageNow(page);
            await setCar(page, { lineDown: false });
            return true;
        }),
        check('IJ04：戻ると止めの電文が車に届く', async (page, st) => {
            for (let i = 0; i < 30; i++) {
                const off = (await wireSince(page, st.t4up)).find((f) => f.hex === PUMP_OFF);
                if (off) return true;
                await page.waitForTimeout(500);
            }
            return '15 秒たっても止めの電文が無い';
        }),
        check('IJ04：画面が「止めました」と言い、動作中の表示が残らない', async (page) => {
            const text = await screenText(page);
            const said = /止めました|止まりました|停止しました/.test(text);
            const armed = await armedOnScreen(page);
            return said && !armed ? true : `止めましたの表示 ${said ? 'あり' : 'なし'}、動作中 ${armed ? '残る' : 'なし'}`;
        }),
        { shot: 's03-line-up' },
        check('後片付け：止める', async (page) => {
            await tool(page, 'monitoring_stop_outputs');
            return true;
        }),

        // ---- IJ13 ----
        { wait: 1500 },
        check('IJ13：油圧ポンプを動かす', async (page) => {
            const r = await startPump(page);
            return r?.started && r.on ? true : JSON.stringify(r).slice(0, 300);
        }),
        { shot: 's04-pump-on-again' },
        check(
            'IJ13：動作中にページを読み込み直す（離れる確認には「はい」）',
            async (page, st) => {
                st.t13 = await pageNow(page);
                page.once('dialog', (d) => {
                    st.leaveAsked = d.type();
                    void d.accept();
                });
                await page.reload();
                await page.waitForFunction(() => !!window.__monitoringE2E, null, { timeout: 15000 });
                await page.waitForTimeout(1500);
                return true;
            },
            'ナビのキーオフや誤った再読み込み',
        ),
        check('IJ13：離れる前に確認が出た（beforeunload）', async (page, st) => (st.leaveAsked === 'beforeunload' ? true : `確認なし: ${st.leaveAsked}`)),
        check('IJ13：ページが閉じる前に、止めの電文が車に届く', async (page, st) => {
            const off = (await wireSince(page, st.t13)).find((f) => f.hex === PUMP_OFF);
            return off ? true : '止めの電文が届かないままページが閉じた（ECU の時間切れ任せ）';
        }),
        check('IJ13：開き直すと、動作中の表示が無い', async (page) => {
            await page.locator('[role=tab]:has-text("ACTUATOR")').first().click().catch(() => {});
            await page.waitForTimeout(600);
            return !(await armedOnScreen(page)) ? true : '動作中が残る';
        }),
        check('IJ13：開き直すと、前の動作が「時間切れで止まった」（止まった）と残っている', async (page) => {
            const text = await screenText(page);
            return /時間切れ|止まりました|止めました/.test(text) ? true : '前の動作のことが何も残っていない';
        }),
        check('IJ13：AI に聞いても、前の動作がどう終わったかが分かる', async (page) => {
            const s = await tool(page, 'monitoring_status');
            return /STEUERN_STELLGLIED|HYDROPUMPE|timed out|時間切れ/.test(JSON.stringify(s)) ? true : '状態に前の動作の記録が無い';
        }),
        { shot: 's05-reopened' },
    ]),
};

export default scenario;
