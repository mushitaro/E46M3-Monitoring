/**
 * SC01–SC07（docs/VIRTUAL-CAR-TESTS.md M1）が使う手順の部品。
 *
 * 合格はオーナーに見えるもの・聞こえるもので決める（M0 の U1〜U8）。AI の言葉そのものはここでは測れない
 * （LLM が居ない）。AI の道具の答えに、言うべき事実・数・日本語で読める名前・断る本当の理由が入っているか、
 * 入れてはいけないもの（VIN）が無いかを見る。言い方は声の稽古で確かめる。
 */
import { tool } from './_lib.mjs';

/** ナビの画面（683×400）。 */
export const NAVI = { width: 683, height: 400 };

/** 練習の車の VIN の下 7 桁（practiceCar.PRACTICE_VIN_SHORT）。画面にも AI の答えにも出てはいけない。 */
export const VIN = 'JR12345';

/** 落ちた手順のあとも最後まで回す：一度の実行で、全部の所見が出るように。 */
export const all = (steps) => steps.map((s) => ({ ...s, always: true }));

/** AI の道具を呼び、答えを残す（U8 の確かめに使う）。 */
export async function ask(page, st, name, args = {}) {
    const r = await tool(page, name, args);
    (st.answers ??= []).push({ name, r });
    return r;
}

/** 画面の文字。モジュールの選択肢（select の option の並び）は除く。 */
export async function screenText(page) {
    const t = await page.evaluate(() => document.body.innerText);
    return t.replace(/MODULE\n(ALL MODULES\n)?MSS54[\s\S]*?Video module\n/, '');
}

/** 見えている範囲（スクロールせずに目に入る所）に、その文字があるか。大文字・小文字は CSS で変わるので区別しない。 */
export async function inView(page, text) {
    return page.evaluate((s) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!n.textContent.toLowerCase().includes(s.toLowerCase())) continue;
            const el = n.parentElement;
            if (!el || el.closest('option, select')) continue;
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && style.visibility !== 'hidden') return true;
        }
        return false;
    }, text);
}

/** 押して、画面が変わるまでの時間（ms）。3 秒変わらなければ null。U1 は 1 秒以内。 */
export async function pressAndTime(page, locator) {
    const before = await page.evaluate(() => document.body.innerText);
    const t0 = Date.now();
    await locator.click();
    while (Date.now() - t0 < 3000) {
        if ((await page.evaluate(() => document.body.innerText)) !== before) return Date.now() - t0;
        await page.waitForTimeout(40);
    }
    return null;
}

/** 練習の車が聞いた電文（16 進）、since（Date.now()）から。 */
export const wire = (page, since = 0) => page.evaluate((t) => window.__monitoringE2E.car.wire(t).map((f) => f.hex), since);

/** 練習の車の今の値。 */
export const carNow = (page) => page.evaluate(() => window.__monitoringE2E.car.get());

/** ランチャーから開いたナビのページ（?from=manifold）にして、車をシナリオの状態に戻す。 */
export const openNavi = (car) => ({
    check: {
        desc: 'ナビで MONITORING を開く（ランチャーが開く形、683×400）',
        run: async (page, st) => {
            st.base ??= page.url().split('?')[0];
            await page.goto(`${st.base}?from=manifold`);
            await page.waitForFunction(() => !!window.__monitoringE2E, null, { timeout: 15000 });
            const agree = page.locator('button:has-text("同意")');
            if (await agree.count()) await agree.first().click();
            await page.evaluate((c) => {
                window.__monitoringE2E.car.reset();
                if (c) window.__monitoringE2E.car.set(c);
            }, car ?? null);
            await page.waitForTimeout(1000);
            const s = await tool(page, 'monitoring_status');
            return s.device === 'ナビ' ? true : `ナビとして開いていない（device: ${s.device}）`;
        },
    },
});

/** PRACTICE を入れて CONNECT。 */
export const connect = [
    { ui: 'practice' },
    { ui: 'click', text: 'CONNECT', settle: 2500, means: '練習の車につなぐ' },
];

/** 全モジュールの読取が終わるまで待つ（2 分まで）。 */
export async function waitScan(page) {
    for (let i = 0; i < 240; i++) {
        const s = await tool(page, 'monitoring_status');
        if (s.scan && s.scan.running === false) return s.scan;
        await page.waitForTimeout(500);
    }
    return null;
}

/** 走査の答えから、モジュールごとの故障の数（MSS54 の解読、SGBD のコードでの読取、MK60 の推定）。 */
export function faultsByAddress(faultsAnswer) {
    const out = {};
    for (const m of faultsAnswer?.faults?.scan?.modules ?? []) {
        const n = m.faults?.length ?? m.sgbdRead?.faults?.length ?? m.codes?.length ?? 0;
        out[m.address] = n;
    }
    return out;
}

/**
 * 画面の全モジュール一覧から、アドレスごとの札（「故障 2」「故障なし」「応答なし」…）。
 * 「?」の行は名前と札のあいだに「候補 n」がある（UX-19）。札はその次の行。
 */
export async function scanRows(page) {
    const t = await screenText(page);
    const rows = {};
    const re = /\n(0x[0-9A-F]{2})\n([^\n]+)\n(?:候補 \d+\n)?([^\n]+)/g;
    for (let m = re.exec(t); m; m = re.exec(t)) rows[m[1]] ??= { name: m[2], tag: m[3] };
    return rows;
}

/** 答えにも画面にも VIN が無い（U8）。 */
export const noVin = {
    check: {
        desc: 'U8：VIN（下 7 桁）が画面にも AI の答えにも出ない',
        run: async (page, st) => {
            const inAnswers = (st.answers ?? []).filter((a) => JSON.stringify(a.r ?? null).includes(VIN)).map((a) => a.name);
            const onScreen = (await page.evaluate(() => document.body.innerText)).includes(VIN);
            if (inAnswers.length) return `AI の答えに VIN：${inAnswers.join(', ')}`;
            return onScreen ? '画面に VIN が出ている' : true;
        },
    },
};

/** ACTUATOR の行：ジョブ名を持ち、その操作の部品（data-test）を持ついちばん内側の要素。 */
export const rowOf = (page, job, testId) =>
    page.getByText(job, { exact: true }).first().locator(`xpath=ancestor::*[.//*[@data-test="${testId}"]][1]`);

/** 行の文字。値の組の選択肢（数百行）は除く。 */
export async function rowText(row) {
    const t = await row.innerText();
    return t
        .split('\n')
        .filter((l) => !/ · -?\d+$/.test(l))
        .join('\n');
}
