import { connectPractice, scanAndWait, tool } from './_lib.mjs';
import { always, check, onModule, pageNow, scanRow, screenText, setCar, wireSince } from './_ij.mjs';

/** Ten stored DME faults: as many as one MSS54 answer carries with room to spare (22 bytes a record, 255 a frame). */
const TEN = Array.from({ length: 10 }, (_, i) => ({ code: 0x10 + i, type: 0x08, frequency: 1 + i }));

/** The frames a module's own SGBD carries (public/ecu-data/<id>.telegrams.json), lower case. */
const tableOf = (page, id) =>
    page.evaluate(async (m) => {
        const t = await (await fetch(`/ecu-data/${m}.telegrams.json`)).json();
        return [...new Set(Object.values(t.jobs).flat().map((x) => x.hex.toLowerCase()))];
    }, id);

/**
 * IJ15・IJ16・IJ21（いじわる：知らない名乗り・故障の数・前期の車）。
 */
const scenario = {
    id: 'IJ15-16-21',
    title: '知らない機種と壊れた名乗り・故障 0 件と最大件数と途中で切れた記録・前期の車（ASC）',
    story:
        'IJ15：知らない機種のモジュール（0x32 が SMG II でも GS20 でもない名乗り）、壊れた名乗り（メーター 0x80 が 1 バイトだけ）。「?」と出る。押しても何も送らないと書いてある。画面が止まらない。' +
        'IJ16：故障 0 件、故障が最大件数、途中で切れた記録。0 件は「故障なし」。最大件数は全部スクロールで見える。切れた記録は読めたところまで出し、「途中までしか読めませんでした」と書く。' +
        'IJ21：前期の車（DSC ではなく ASC）につなぎ替える。名前が ASC に変わる。DSC の項目は出ない。' +
        '（0x56 にはグループファイルの規則が無いので、アプリは名乗りで ASC と DSC を選ばない。推測で変種を決めない。両方に共通の電文だけを送ること、DSC だと言い切らないことを見る。）',
    car: {
        idents: { 0x12: { hw: '1B', diag: '90' }, 0x32: { hw: '77', diag: '77' }, 0x80: { data: [0xff] } },
        dmeFaults: TEN,
        // RDC: its fault read says five entries and stops after one byte.
        moduleFaults: { 0x70: [0x05, 0x01] },
    },
    steps: always([
        ...connectPractice,
        check('全モジュールを読む前の時刻', async (page, st) => {
            st.t0 = await pageNow(page);
            return true;
        }),
        ...scanAndWait,
        { shot: 's01-scan' },

        // ---- IJ15 ----
        check('IJ15：AI の状態で 0x32 と 0x80 は「?」', async (page) => {
            const v = (await tool(page, 'monitoring_status')).variants ?? {};
            return v['0x32'] === '?' && v['0x80'] === '?' ? true : JSON.stringify(v);
        }),
        check('IJ15：0x32 と 0x80 には名乗り（IDENT）のほか何も送っていない', async (page, st) => {
            const w = await wireSince(page, st.t0);
            const other = w.filter((f) => (f.to === 0x32 && f.hex !== '32 04 00 36') || (f.to === 0x80 && f.hex !== '80 04 00 84'));
            return other.length === 0 ? true : other.map((f) => f.hex).join(', ');
        }),
        check('IJ15：IDENT が MSS54 を選んだ 0x12 の行は MSS54 だけを名乗る（候補を並べない）', async (page) => {
            const row = await scanRow(page, '0x12');
            return row && /MSS54/.test(row) && !/MS43|MS42|BMS4/.test(row) ? true : `0x12 の行: ${row}`;
        }),
        check('IJ15：0x32 の行を押しても、名乗りのほか何も送らない', async (page, st) => {
            const t = await pageNow(page);
            await page.getByText('0x32', { exact: true }).first().click().catch(() => {});
            await page.waitForTimeout(1500);
            st.row32 = await scanRow(page, '0x32');
            const sent = (await wireSince(page, t)).filter((f) => f.to === 0x32 && f.hex !== '32 04 00 36');
            return sent.length === 0 ? true : `送った: ${sent.map((f) => f.hex).join(', ')}`;
        }),
        check('IJ15：押した 0x32 の行に「?」と、名乗りのほかは送らないことが書いてある', async (page, st) =>
            /\?/.test(st.row32 ?? '') && /送っていません|送らない|送りません/.test(st.row32 ?? '') ? true : `行: ${st.row32}`,
        ),
        check('IJ15：押した 0x32 の行に英語の内部文が混ざらない（U5・D1-7）', async (page, st) => {
            const en = (st.row32 ?? '').split(' / ').find((l) => /its IDENT answer|only its IDENT/.test(l));
            return en ? `英語の行: ${en}` : true;
        }),
        check('IJ15：画面は止まらない（1 秒以内にタブが替わる）', async (page) => {
            const t1 = Date.now();
            await page.locator('[role=tab]:has-text("DATALOG")').first().click();
            await page.waitForFunction(() => document.querySelector('[role=tab][aria-selected="true"]')?.textContent?.includes('DATALOG'), null, { timeout: 1000 });
            const ms = Date.now() - t1;
            await page.locator('[role=tab]:has-text("DIAGNOSIS")').first().click();
            await page.waitForTimeout(400);
            return ms <= 1000 ? true : `${ms} ms`;
        }),
        { shot: 's02-unknown-ident' },

        // ---- IJ16 ----
        check('IJ16：故障 0 件のモジュールは「故障なし」', async (page) => {
            const row = await scanRow(page, '0x57');
            return row && /故障なし/.test(row) ? true : `0x57 の行: ${row}`;
        }),
        check('IJ16：途中で切れた記録（RDC）は「途中までしか読めませんでした」と書く', async (page, st) => {
            st.rdc = await scanRow(page, '0x70');
            return /途中まで/.test(st.rdc ?? '') ? true : `0x70 の行: ${st.rdc}`;
        }),
        check('IJ16：途中で切れた記録を「故障なし」と言わない', async (page, st) => (!/故障なし/.test(st.rdc ?? '') ? true : `0x70 の行: ${st.rdc}`)),
        check('IJ16：AI の答えでも RDC の読み取りが途中で止まったと分かる（complete: false など）', async (page) => {
            const f = (await tool(page, 'monitoring_faults')).faults;
            const m = (f?.scan?.modules ?? []).find((x) => x.address === '0x70');
            const j = JSON.stringify(m ?? {});
            return /"complete":false|stopped|truncat|short/i.test(j) ? true : `0x70: ${j.slice(0, 300)}`;
        }),
        { shot: 's03-truncated' },
        check('IJ16：エンジンを画面に出して故障を読み直す', async (page) => {
            const off = await onModule(page, 'mss54');
            if (off) return off;
            const r = await tool(page, 'monitoring_faults', { refresh: true });
            return r?.refreshed ? true : JSON.stringify(r).slice(0, 200);
        }),
        check('IJ16：最大件数（10 件）が全部、画面の一覧にある（スクロールで見える）', async (page) => {
            await page.waitForTimeout(800);
            const text = await screenText(page);
            const missing = TEN.map((f) => `0x${f.code.toString(16).toUpperCase()}`).filter((c) => !text.includes(c));
            return missing.length === 0 ? true : `無い: ${missing.join(', ')}`;
        }),
        check('IJ16：AI も 10 件と言う（U3）', async (page) => {
            const f = await tool(page, 'monitoring_faults', { module: 'mss54' });
            const n = f?.faults?.faults?.length;
            return n === 10 ? true : `${n} 件`;
        }),
        { shot: 's04-ten-faults' },

        // ---- IJ21 ----
        check('IJ21：前期の車につなぎ替える（0x56 は ASC MK20、DSC MK60 は無い）', async (page, st) => {
            await setCar(page, { idents: { 0x12: { hw: '1B', diag: '90' }, 0x32: { hw: '2F', diag: '00' }, 0x56: { hw: 'A2', diag: '20' } }, dscMk60: null, moduleFaults: {}, dmeFaults: [] });
            st.t21 = await pageNow(page);
            await page.locator('[role=tab]:has-text("DIAGNOSIS")').first().click();
            return true;
        }),
        ...scanAndWait,
        { shot: 's05-early-car' },
        check('IJ21：0x56 に送ったのは、ASC MK20 と DSC（E46）の両方の SGBD が持つ電文だけ', async (page, st) => {
            const asc = new Set(await tableOf(page, 'ascmk20'));
            const dsc = new Set(await tableOf(page, 'dsc_e46'));
            const sent = (await wireSince(page, st.t21)).filter((f) => f.to === 0x56).map((f) => f.hex.toLowerCase());
            const odd = sent.filter((h) => !(asc.has(h) && dsc.has(h)));
            return sent.length && odd.length === 0 ? true : `共通でない電文: ${odd.join(', ') || '（何も送っていない）'}`;
        }),
        check('IJ21：画面の 0x56 の行が DSC だと言い切らない（ASC の名前がある）', async (page) => {
            const row = await scanRow(page, '0x56');
            return row && /ASC/.test(row) ? true : `0x56 の行: ${row}`;
        }),
        check('IJ21：オーナーが ACTUATOR で一度「ABS/ASC MK20」と答える（同じアドレスの機種は名乗りから決められない）', async (page) => {
            const off = await onModule(page, 'ascmk20');
            if (off) return off;
            await page.locator('[role=tab]:has-text("ACTUATOR")').first().click();
            await page.waitForTimeout(500);
            const pick = page.locator('button:visible').filter({ hasText: /ASC MK20/ }).first();
            if (!(await pick.count())) return 'ACTUATOR に機種を答える行が無い';
            await pick.click();
            await page.waitForTimeout(400);
            await page.locator('select:has(option[value="all"])').first().selectOption('all').catch(() => {});
            await page.locator('[role=tab]:has-text("DIAGNOSIS")').first().click();
            await page.waitForTimeout(600);
            return true;
        }),
        check('IJ21：答えたあと、画面の 0x56 の行の名前が ASC だけに変わる（DSC の名前が出ない）', async (page) => {
            const row = await scanRow(page, '0x56');
            return row && /ASC/.test(row) && !/DSC/.test(row) ? true : `0x56 の行: ${row}`;
        }),
        check('IJ21：AI の状態でも 0x56 は ASC と決まっていない（DSC と言わない）', async (page) => {
            const v = (await tool(page, 'monitoring_status')).variants ?? {};
            return !/DSC/i.test(v['0x56'] ?? '') ? true : `0x56: ${v['0x56']}`;
        }),
        check('IJ21：前期の車で DSC（E46）を選んでも、DSC の作動テストは 0x56 に送らない', async (page) => {
            const off = await onModule(page, 'dsc_e46');
            if (off) return off;
            const t = await pageNow(page);
            const r = await tool(page, 'monitoring_actuate', { module: 'dsc_e46', job: 'DSC_SIM_VA', phase: 'pulse', owner_said: 'いいよ' });
            if (r?.on) await tool(page, 'monitoring_stop_outputs');
            await page.waitForTimeout(500);
            const asc = new Set(await tableOf(page, 'ascmk20'));
            const sent = (await wireSince(page, t)).filter((f) => f.to === 0x56 && !asc.has(f.hex.toLowerCase()));
            return sent.length === 0 ? true : `ASC の SGBD に無い DSC の電文を送った: ${sent.map((f) => f.hex).join(', ')}（答え: ${JSON.stringify(r).slice(0, 160)}）`;
        }),
        { shot: 's06-dsc-on-asc' },
    ]),
};

export default scenario;
