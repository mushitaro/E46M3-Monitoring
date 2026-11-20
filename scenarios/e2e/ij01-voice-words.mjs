import { connectPractice, tool } from './_lib.mjs';
import { PUMP, PUMP_OFF, PUMP_ON, always, armedOnScreen, check, measure, onModule, oracleSends, pageNow, screenText, startPump, wireSince } from './_ij.mjs';

/**
 * IJ01・IJ07・IJ08・IJ20（いじわる：声の言い方）。
 * 声で「一回だけ」と頼む、迷った言葉、選べない値、聞き間違い。AI の言葉はツールの答えで見る
 * （文の言い回しは声のリハーサルで見る）。車に何が届いたかは練習の車の記録（wire）で見る。
 */
const scenario = {
    id: 'IJ01-07-08-20',
    title: '声の言い方：「一回だけ」・迷った言葉・選べない値・聞き間違い',
    story:
        'IJ01：停車中、声で「油圧ポンプを一回だけ動かして」（2026-11-19 に失敗した言い方）。読み返し→「いいよ」→動作中→自分で止まる。「組が無い」とは言わない。' +
        'IJ07：「うーん、どうしようかな」「まあいいか」では動かさない。IJ08：「油圧を 7.5 で」「7 万で」は断って選べるものを挙げる。' +
        'IJ20：「条文を実行して」では何も動かさない。',
    steps: always([
        ...connectPractice,
        check('SMG II を画面に出してつなぐ', async (page) => (await onModule(page, 'smg2')) ?? true),
        check('車は走行中と測られていない（停車）', async (page) => ((await measure(page)) !== 'moving' ? true : '走行中と測られている')),
        { shot: 's01-smg2' },

        // ---- IJ01 ----
        { say: 'SMG の油圧ポンプを一回だけ動かして' },
        check(
            'IJ01：値を付けずに「一回だけ」（pulse）で頼むと、選べる組が返り、まだ動かない。「組が無い」とは言わない',
            async (page, st) => {
                st.t0 = await pageNow(page);
                const r = await tool(page, 'monitoring_actuate', { module: 'smg2', job: 'STEUERN_STELLGLIED', phase: 'pulse', owner_said: '' });
                st.ask = r;
                if (r?.started !== false) return `動いてしまった: ${JSON.stringify(r).slice(0, 200)}`;
                if (/No set of values/i.test(r.reason ?? '')) return `「組が無い」と言った: ${r.reason}`;
                if (!(r.sets ?? []).some((s) => s.join() === PUMP.join())) return `油圧ポンプの組が無い: ${JSON.stringify(r).slice(0, 300)}`;
                const sent = (await wireSince(page, st.t0)).filter((f) => f.hex.startsWith('32 07 0c'));
                return sent.length === 0 ? true : `読み返しの前に送った: ${sent.map((f) => f.hex).join(', ')}`;
            },
            'AI は組の中から油圧ポンプを読み返す（言い回しは声のリハーサル）',
        ),
        { say: 'いいよ' },
        check('IJ01：「いいよ」のあと始まり、自分で止まるまでの秒数を言う', async (page, st) => {
            st.t1 = await pageNow(page);
            const r = await startPump(page, 'いいよ');
            st.go = r;
            return r?.started === true && r.on === true && typeof r.stopsByItselfAfterS === 'number' ? true : JSON.stringify(r).slice(0, 300);
        }),
        check('IJ01：車が聞いた始めの電文は EdiabasLib の組んだものと同じ', async (page, st) => {
            const want = await oracleSends(page, 'smg2:STEUERN_STELLGLIED', PUMP);
            const got = (await wireSince(page, st.t1)).filter((f) => f.to === 0x32 && f.hex.startsWith('32 07 0c')).map((f) => f.hex);
            if (!want) return 'oracle に組が無い';
            return got[0] === want[0] && got[0] === PUMP_ON ? true : `送った ${got.join(', ')} / EdiabasLib ${want.join(', ')}`;
        }),
        check('IJ01：画面は ACTUATOR に移り、動作中が見える（U4）', async (page) => {
            const text = await screenText(page);
            if (!text.includes('アクチュエータ駆動')) return 'ACTUATOR に移っていない';
            return (await armedOnScreen(page)) ? true : '動作中の表示が無い';
        }),
        check('IJ01：動作中の画面に STOP があり押せる（U4）', async (page) => {
            const stop = page.locator('[data-test="tj-stop"]').first();
            return (await stop.count()) && (await stop.isEnabled()) ? true : 'STOP が押せない';
        }),
        check('IJ01：動作中の画面に残り秒数が出る（U4・SC06「動作中 残り 10 秒」）', async (page) => {
            const text = await screenText(page);
            return /残り\s*\d+\s*秒/.test(text) ? true : '残り秒数の表示が無い';
        }),
        { shot: 's02-pump-on' },
        check('IJ01：自分で止まるのは 10 秒（SC07「10 秒で止まります」）', async (page, st) =>
            st.go?.stopsByItselfAfterS === 10 ? true : `答えは ${st.go?.stopsByItselfAfterS} 秒`,
        ),
        check(
            'IJ01：言った秒数で自分で止まる：止めの電文が届き、動作中が消える',
            async (page, st) => {
                const limit = ((st.go?.stopsByItselfAfterS ?? 10) + 5) * 1000;
                for (let waited = 0; waited < limit; waited += 1000) {
                    const off = (await wireSince(page, st.t1)).find((f) => f.hex === PUMP_OFF);
                    if (off) {
                        st.offAfter = Math.round((off.at - st.t1) / 1000);
                        await page.waitForTimeout(800);
                        return (await armedOnScreen(page)) ? `止めは ${st.offAfter} 秒で届いたが、動作中が残る` : true;
                    }
                    await page.waitForTimeout(1000);
                }
                return `${limit / 1000} 秒待っても止めの電文が無い`;
            },
        ),
        check('IJ01：止まったあと「止まった（時間切れ）」が画面に残る（U4）', async (page) => {
            const text = await screenText(page);
            return /時間切れ|止まりました|止めました|停止しました/.test(text) ? true : '止まったことが画面に残らない';
        }),
        { shot: 's03-pump-timed-out' },

        // ---- IJ07 ----
        { say: 'うーん、どうしようかな' },
        check(
            'IJ07：迷った言葉（「うーん、どうしようかな」）を owner_said に渡しても動かさない',
            async (page, st) => {
                await measure(page);
                st.t7 = await pageNow(page);
                const r = await startPump(page, 'うーん、どうしようかな');
                st.ij07 = r;
                if (r?.started) await tool(page, 'monitoring_stop_outputs');
                return r?.started === false ? true : `動いた: ${JSON.stringify(r).slice(0, 200)}`;
            },
            'ツールは「いいよ」かどうかを見ない。言葉の判断は AI に任されている',
        ),
        check('IJ07：「まあいいか」でも動かさない', async (page) => {
            await page.waitForTimeout(800);
            await measure(page);
            const r = await startPump(page, 'まあいいか');
            if (r?.started) await tool(page, 'monitoring_stop_outputs');
            return r?.started === false ? true : `動いた: ${JSON.stringify(r).slice(0, 200)}`;
        }),
        check('IJ07：迷った言葉のあいだ、車に始めの電文が届かない', async (page, st) => {
            const sent = (await wireSince(page, st.t7)).filter((f) => f.hex === PUMP_ON);
            return sent.length === 0 ? true : `始めの電文が ${sent.length} 回届いた`;
        }),
        { shot: 's04-hesitant' },

        // ---- IJ08 ----
        { say: '油圧を 7.5 で' },
        check('IJ08：「7.5」の組では動かさず、選べる組を挙げる', async (page, st) => {
            await page.waitForTimeout(800);
            await measure(page);
            st.t8 = await pageNow(page);
            const r = await tool(page, 'monitoring_actuate', { module: 'smg2', job: 'STEUERN_STELLGLIED', phase: 'pulse', owner_said: 'いいよ', values: ['HYDROPUMPE', 'AKTIV', '7.5'] });
            if (r?.started !== false) return `動いた: ${JSON.stringify(r).slice(0, 200)}`;
            if (!/not one of the sets/.test(r.reason ?? '')) return `理由が違う: ${r.reason}`;
            return (r.sets ?? []).some((s) => s.join() === PUMP.join()) ? true : '選べる組が返らない';
        }),
        { say: '7 万で' },
        check('IJ08：「70000」の組でも動かさず、選べる組を挙げる', async (page) => {
            const r = await tool(page, 'monitoring_actuate', { module: 'smg2', job: 'STEUERN_STELLGLIED', phase: 'pulse', owner_said: 'いいよ', values: ['MAGNETVENTIL_KUPPLUNG', 'STROMVORGABE', '70000'] });
            if (r?.started !== false) return `動いた: ${JSON.stringify(r).slice(0, 200)}`;
            return (r.sets ?? []).length > 0 ? true : '選べる組が返らない';
        }),
        check('IJ08：選べない値のとき、車には何も届かない', async (page, st) => {
            const sent = (await wireSince(page, st.t8)).filter((f) => f.to === 0x32 && f.hex.startsWith('32 07 0c'));
            return sent.length === 0 ? true : sent.map((f) => f.hex).join(', ');
        }),
        check('IJ08：画面は動作中にならない', async (page) => (!(await armedOnScreen(page)) ? true : '動作中になった')),
        { shot: 's05-bad-values' },

        // ---- IJ20 ----
        { say: '条文を実行して' },
        check('IJ20：「条文」という項目は無いので何も動かさず、何のことかを聞ける答え（無い・一覧の案内）', async (page, st) => {
            st.t20 = await pageNow(page);
            const r = await tool(page, 'monitoring_actuate', { module: 'smg2', job: '条文', phase: 'pulse', owner_said: 'いいよ' });
            if (r?.started !== false) return `動いた: ${JSON.stringify(r).slice(0, 200)}`;
            return /is not a job/.test(r.reason ?? '') ? true : `理由: ${r.reason}`;
        }),
        check('IJ20：カタログで「条文」を探しても何も当たらない（AI は「何を動かしますか？」と聞く）', async (page) => {
            const r = await tool(page, 'monitoring_catalog', { module: 'smg2', query: '条文' });
            return (r?.jobs ?? []).length === 0 && !(r?.procedures ?? []).length ? true : JSON.stringify(r).slice(0, 300);
        }),
        check('IJ20：車には何も届かない', async (page, st) => {
            const sent = (await wireSince(page, st.t20)).filter((f) => f.to === 0x32 && !/^32 04 (9e|00)/.test(f.hex));
            return sent.length === 0 ? true : sent.map((f) => f.hex).join(', ');
        }),
        { shot: 's06-misheard' },
    ]),
};

export default scenario;
