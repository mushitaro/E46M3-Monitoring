import { connectPractice, tool } from './_lib.mjs';
import { PUMP_OFF, PUMP_ON, always, armedOnScreen, check, measure, onModule, pageNow, screenText, startPump, untilStartable, wireSince } from './_ij.mjs';

/** The STEUERN_STELLGLIED row's tag (札) on ACTUATOR: the reason it cannot run now, in a word. */
const rowTag = async (page) => {
    const row = page.getByText('STEUERN_STELLGLIED', { exact: true }).first().locator('xpath=ancestor::*[.//*[@data-test="tj-pick"]][1]');
    return (await row.count()) ? row.innerText() : '';
};

/**
 * IJ02・IJ03・IJ12（いじわる：車の状態が変わる）。
 * 「いいよ」の直後に走り出す、電圧 11.9 V、走行中に「止めて！」。断る理由が画面の札と AI の答えで同じか、
 * 車に何が届いたか（wire）で見る。
 */
const scenario = {
    id: 'IJ02-03-12',
    title: '車の状態が変わる：「いいよ」の直後に走り出す・電圧 11.9 V・走行中に「止めて！」',
    story:
        'IJ02：AI が読み返し、オーナーが「いいよ」と言った直後に走り出す。AI「走り出したので動かしませんでした」、画面は動作中にならず札は「走行中」。' +
        'IJ03：電圧 11.9 V で動かそうとする。画面と AI が「電圧 11.9 V。12 V 以上で動かせます」と言う。' +
        'IJ12：動作中に走り出し「止めて！」。読み返さずに 1 秒以内に止まり、AI「止めました」。',
    steps: always([
        ...connectPractice,
        check('SMG II を画面に出してつなぐ', async (page) => (await onModule(page, 'smg2')) ?? true),
        { shot: 's01-smg2' },

        // ---- IJ02 ----
        { say: 'SMG の油圧ポンプを動かして' },
        { say: 'いいよ' },
        { car: { speedKmh: 30 }, means: '「いいよ」の直後に走り出す' },
        check('IJ02：動かさない（started: false）', async (page, st) => {
            st.t2 = await pageNow(page);
            st.ij02 = await startPump(page, 'いいよ');
            return st.ij02?.started === false ? true : JSON.stringify(st.ij02).slice(0, 300);
        }),
        check('IJ02：車に始めの電文が届かない（送る直前の車速で止まる）', async (page, st) => {
            const sent = (await wireSince(page, st.t2)).filter((f) => f.hex === PUMP_ON);
            return sent.length === 0 ? true : `始めの電文が届いた（${sent.length} 回）`;
        }),
        check('IJ02：AI の答えの理由が「走っている」（U2）', async (page, st) => {
            const reason = st.ij02?.reason ?? '';
            return /moving|stationary|speed/i.test(reason) ? true : `理由: ${reason}`;
        }),
        check('IJ02：画面は動作中にならない', async (page) => (!(await armedOnScreen(page)) ? true : '動作中になった')),
        check('IJ02：画面の行の札が「走行中」（U2・U3）', async (page) => {
            const text = await rowTag(page);
            return text.includes('走行中') ? true : `札: ${text.split('\n').slice(0, 6).join(' / ')}`;
        }),
        { shot: 's02-moved-off' },
        { car: { speedKmh: 0 }, means: '止まる' },
        { wait: 1500 },
        check('IJ02：止まったあと頼み直すと 10 秒以内に動く（前の「走行中」の測りが残って断り続けない）', async (page, st) => {
            const { ms, r } = await untilStartable(page, () => startPump(page, 'いいよ'));
            st.retry = { ms, r };
            if (r?.started) await tool(page, 'monitoring_stop_outputs');
            if (ms === null) return `動かない: ${JSON.stringify(r).slice(0, 200)}`;
            return ms <= 10000 ? true : `止まってから ${Math.round(ms / 100) / 10} 秒「The car is moving」と断り続けた`;
        }),
        { shot: 's03-stopped-retry' },

        // ---- IJ03 ----
        { car: { batteryV: 11.9 }, means: '電圧 11.9 V' },
        { wait: 1500 },
        check('IJ03：電圧 11.9 V では動かさない', async (page, st) => {
            await measure(page);
            st.t3 = await pageNow(page);
            st.ij03 = await startPump(page, 'いいよ');
            if (st.ij03?.started) await tool(page, 'monitoring_stop_outputs');
            return st.ij03?.started === false ? true : JSON.stringify(st.ij03).slice(0, 300);
        }),
        check('IJ03：車に始めの電文が届かない', async (page, st) => {
            const sent = (await wireSince(page, st.t3)).filter((f) => f.hex === PUMP_ON);
            return sent.length === 0 ? true : `始めの電文が届いた（${sent.length} 回）`;
        }),
        check('IJ03：AI の答えが 11.9 V と 12 V を言う', async (page, st) => {
            const reason = st.ij03?.reason ?? '';
            return /11\.9/.test(reason) && /12/.test(reason) ? true : `理由: ${reason}`;
        }),
        check('IJ03：画面が「電圧 11.9 V。12 V 以上で動かせます」を言う', async (page) => {
            await page.waitForTimeout(500);
            const text = await screenText(page);
            if (/電圧\s*11\.9\s*V/.test(text) && /12\s*V\s*以上/.test(text)) return true;
            const line = text.split('\n').find((l) => /11\.9/.test(l));
            return line ? `日本語で言わない（英語の内部文が出る）: ${line.slice(0, 160)}` : '画面に電圧の理由が無い';
        }),
        { shot: 's04-low-voltage' },
        { car: { batteryV: null }, means: '電圧が戻る' },
        { wait: 1000 },

        // ---- IJ12 ----
        check('IJ12：停車で油圧ポンプを動かす', async (page, st) => {
            await measure(page);
            st.go = await startPump(page, 'いいよ');
            return st.go?.started === true && st.go.on ? true : JSON.stringify(st.go).slice(0, 300);
        }),
        { shot: 's05-pump-on' },
        { car: { speedKmh: 50 }, means: '動作中に走り出す' },
        { say: '止めて！' },
        check('IJ12：読み返さずに止める：答えは 1 秒以内で「止めた」', async (page, st) => {
            st.t12 = await pageNow(page);
            const r = await tool(page, 'monitoring_stop_outputs');
            st.ms = (await pageNow(page)) - st.t12;
            st.ij12 = r;
            return Array.isArray(r?.stopped) && r.stopped.length === 1 && st.ms < 1000 ? true : `${st.ms} ms ${JSON.stringify(r)}`;
        }),
        check('IJ12：止めの電文は 1 秒以内に車に届く（走行中でも）', async (page, st) => {
            const off = (await wireSince(page, st.t12)).find((f) => f.hex === PUMP_OFF);
            return off && off.at - st.t12 < 1000 ? true : off ? `${off.at - st.t12} ms` : '止めの電文が無い';
        }),
        check('IJ12：画面の動作中が消える', async (page) => {
            await page.waitForTimeout(300);
            return !(await armedOnScreen(page)) ? true : '動作中が残る';
        }),
        check('IJ12：止まったことが画面に残る（U4「止まった」）', async (page) => {
            const text = await screenText(page);
            return /止まりました|止めました|停止しました|止まった/.test(text) ? true : '止まったことが画面に出ない';
        }),
        { shot: 's06-stopped-moving' },
    ]),
};

export default scenario;
