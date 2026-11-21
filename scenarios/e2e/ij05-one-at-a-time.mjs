import { chooseSet, connectPractice, tool } from './_lib.mjs';
import { PUMP_OFF, PUMP_ON, always, armedOnScreen, check, onModule, pageNow, screenText, startPump, wireSince } from './_ij.mjs';

/** The STEUERN_STELLGLIED row on ACTUATOR. */
const pumpRow = (page) => page.getByText('STEUERN_STELLGLIED', { exact: true }).first().locator('xpath=ancestor::*[.//*[@data-test="tj-pick"]][1]');

/** How many outputs ACTUATOR's right column lists as on. */
const armedCount = async (page) => {
    const lines = (await screenText(page)).split('\n').map((l) => l.trim());
    const i = lines.indexOf('作動中');
    if (i < 0) return 0;
    const n = lines.slice(i, i + 4).find((l) => /^\d+$/.test(l));
    return n ? Number(n) : 1;
};

/**
 * IJ05・IJ09（いじわる：一度に一つ）。
 * 動作中に別のモジュールを選ぶ。画面で START を押しながら、声でも別のものを頼む。
 */
const scenario = {
    id: 'IJ05-09',
    title: '一度に一つ：動作中にモジュールを切り替える・画面と声で同時に頼む',
    story:
        'IJ05：油圧ポンプが動作中に別のモジュールを選ぶ。「いま油圧ポンプが動いています。止めてから切り替えます」と出て、止めてから切り替わる。' +
        'IJ09：画面で START を押しながら、声でも別のものを頼む。後から頼んだ方に「いま〇〇が動いています。止めてから」と出る。二つ同時に動作中にならない。',
    steps: always([
        ...connectPractice,
        check('SMG II を画面に出してつなぐ', async (page) => (await onModule(page, 'smg2')) ?? true),

        // ---- IJ05 ----
        check('IJ05：油圧ポンプを動かす', async (page) => {
            const r = await startPump(page);
            return r?.started && r.on ? true : JSON.stringify(r).slice(0, 300);
        }),
        { shot: 's01-pump-on' },
        { say: 'ラジオを見せて' },
        check('IJ05：動作中に AI がモジュールをラジオに切り替える', async (page, st) => {
            st.t5 = await pageNow(page);
            st.ij05 = await tool(page, 'monitoring_module', { module: 'radio' });
            st.screen5 = await screenText(page);
            return true;
        }),
        check('IJ05：切り替えの前に止めの電文が届き、そのあとでラジオに話す', async (page, st) => {
            await page.waitForTimeout(2500);
            const w = await wireSince(page, st.t5);
            const off = w.findIndex((f) => f.hex === PUMP_OFF);
            const radio = w.findIndex((f) => f.to === 0x68);
            if (off < 0) return '止めの電文が無い';
            return radio < 0 || off < radio ? true : 'ラジオに話してから止めた';
        }),
        check('IJ05：AI の答えが「油圧ポンプが動いていたので止めてから切り替えた」と言う', async (page, st) => {
            const s = JSON.stringify(st.ij05);
            return /stop/i.test(s) && /HYDROPUMPE|pump|STEUERN_STELLGLIED/i.test(s) ? true : `答え: ${s.slice(0, 200)}`;
        }),
        check('IJ05：画面が「いま油圧ポンプが動いています。止めてから切り替えます」と言う', async (page, st) => {
            const text = `${st.screen5}\n${await screenText(page)}`;
            return /止めてから/.test(text) ? true : '画面に何も出ない（黙って止めて切り替えた）';
        }),
        check('IJ05：切り替わった：画面はラジオ', async (page) => {
            const s = await tool(page, 'monitoring_status');
            return s?.linkModule?.id === 'radio' ? true : JSON.stringify(s?.linkModule);
        }),
        { shot: 's02-switched' },

        // ---- IJ09 ----
        check('IJ09：SMG II に戻す', async (page) => (await onModule(page, 'smg2')) ?? true),
        { ui: 'tab', name: 'ACTUATOR' },
        check('IJ09：画面で油圧ポンプを選んで START → 確認 → 実行', async (page, st) => {
            const row = pumpRow(page);
            for (let i = 0; i < 20 && (await row.locator('select').count()) === 0; i++) await page.waitForTimeout(250);
            if (!(await chooseSet(row, '油圧ポンプ', 'オン · 0'))) return '油圧ポンプ › オン · 0 が選べない';
            // The row chosen: the ring is its START (UX-01, one entrance).
            await row.locator('[data-test="tj-pick"]').first().click();
            await page.locator('[data-test="tj-start"]').click();
            const dialog = page.locator('[role=dialog]').first();
            await dialog.waitFor({ timeout: 3000 });
            for (const box of await dialog.locator('input[type=checkbox]').all()) await box.check();
            st.t9 = await pageNow(page);
            await page.locator('[data-test="gate-run"]').click();
            await page.waitForTimeout(2000);
            const on = (await wireSince(page, st.t9)).some((f) => f.hex === PUMP_ON);
            return on && (await armedOnScreen(page)) ? true : `送った ${on}、動作中 ${await armedOnScreen(page)}`;
        }),
        { shot: 's03-screen-start' },
        { say: 'クラッチの弁を動かして' },
        check('IJ09：声で頼んだ別の部品は始めない', async (page, st) => {
            st.t9b = await pageNow(page);
            st.ij09 = await tool(page, 'monitoring_actuate', {
                module: 'smg2',
                job: 'STEUERN_STELLGLIED',
                phase: 'pulse',
                owner_said: 'いいよ',
                values: ['MAGNETVENTIL_KUPPLUNG', 'AKTIV', '0'],
            });
            return st.ij09?.started === false ? true : JSON.stringify(st.ij09).slice(0, 300);
        }),
        check('IJ09：答えは「いま動いているものを止めてから」と言う', async (page, st) => {
            const reason = st.ij09?.reason ?? '';
            return /is on/.test(reason) && /Stop it first|monitoring_stop_outputs/.test(reason) ? true : `理由: ${reason}`;
        }),
        check('IJ09：答えは動いているものを部品の名前で言う（油圧ポンプ）。ジョブ名だけではない（U6）', async (page, st) => {
            const reason = st.ij09?.reason ?? '';
            return /HYDROPUMPE|hydraulic pump|油圧ポンプ/i.test(reason) ? true : `部品の名前が無い: ${reason}`;
        }),
        check('IJ09：車には二つ目の始めの電文が届かない', async (page, st) => {
            const sent = (await wireSince(page, st.t9b)).filter((f) => f.to === 0x32 && f.hex.startsWith('32 07 0c') && f.hex !== PUMP_OFF);
            return sent.length === 0 ? true : sent.map((f) => f.hex).join(', ');
        }),
        check('IJ09：二つ同時に動作中にならない（動作中は 1 つ）', async (page) => {
            const n = await armedCount(page);
            return n === 1 ? true : `動作中 ${n}`;
        }),
        check('IJ09：画面では、動いている間は値も START も変えられない（ハブは STOP で、START はどこにも無い）', async (page) => {
            const row = pumpRow(page);
            const sel = await row.locator('select').isDisabled();
            // Choosing another row while it is on does not bring a START back: the ring stays its STOP.
            const other = page.locator('[data-test="tj-pick"]').first();
            if (await other.count()) await other.click();
            await page.waitForTimeout(200);
            const start = page.locator('[data-test="tj-start"]:not([disabled]), [data-test="tj-run"]:not([disabled])');
            const noStart = (await start.count()) === 0;
            const stop = (await page.locator('[data-test="tj-stop"]:not([disabled])').count()) > 0;
            return sel && noStart && stop ? true : `値 ${sel ? '固定' : '変えられる'}、START ${noStart ? '無し' : '押せる'}、STOP ${stop ? 'あり' : '無し'}`;
        }),
        { shot: 's04-voice-refused' },
        check('後片付け：止める', async (page) => {
            const r = await tool(page, 'monitoring_stop_outputs');
            return Array.isArray(r?.stopped) ? true : JSON.stringify(r);
        }),
        { shot: 's05-stopped' },
    ]),
};

export default scenario;
