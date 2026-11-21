/** Steps several scenarios share. */

export const connectPractice = [
    { ui: 'practice' },
    { ui: 'click', text: 'CONNECT', settle: 2000, means: '走る前に人がつなぐ（PRACTICE の模擬実車）' },
];

/** Calls a tool from a check, so its answer can be kept and judged in one place. */
export const tool = (page, name, args = {}) =>
    page.evaluate(([n, a]) => window.__monitoringE2E.tool(n, a), [name, args]).catch((e) => ({ error: String(e.message ?? e) }));

/** Scan, then wait for it to end. */
export const scanAndWait = [
    { ai: 'monitoring_scan', means: '全モジュールの故障を順に読み始める', expect: (r) => (r && r.started ? true : JSON.stringify(r)) },
    {
        check: {
            desc: '読み終わるまで待つ',
            run: async (page, st) => {
                for (let i = 0; i < 120; i++) {
                    const s = await tool(page, 'monitoring_status');
                    if (s.scan && s.scan.running === false) {
                        st.scanCounts = s.scan.counts;
                        return s.scan.end === 'done' ? true : `scan ended: ${s.scan.end}`;
                    }
                    await page.waitForTimeout(1000);
                }
                return 'scan did not end in 2 minutes';
            },
        },
    },
];

/** Starts PROBE on the kept record and says whether it started. */
export const startProbe = {
    check: {
        desc: 'AI が PROBE を始める',
        run: async (page, st) => {
            const r = await tool(page, 'monitoring_probe', { record: st.record });
            st.probe = r;
            return r && r.started ? true : JSON.stringify(r).slice(0, 300);
        },
    },
};

/** Writes a plan under the kept record and mandate. */
export const plan = (body) => ({
    check: {
        desc: `AI が計画を書く：${body.purpose}`,
        run: async (page, st) => {
            const r = await tool(page, 'monitoring_plan', { record: st.record, mandate: st.mandate, ...body });
            st.plan = r;
            return r && !r.error ? true : JSON.stringify(r).slice(0, 300);
        },
    },
});

/**
 * Chooses a whole set of values on an ACTUATOR row: the option `label` (「オン · 0」) under the part's
 * heading (「— 油圧ポンプ」), the way a person reads the list (UX-27). Returns whether it was there.
 */
export async function chooseSet(row, part, label) {
    const select = row.locator('select').first();
    const value = await select.evaluate(
        (s, [p, l]) => {
            let under = null;
            for (const o of s.options) {
                if (o.disabled && o.text.startsWith('— ')) under = o.text.slice(2);
                else if (under === p && o.text === l) return o.value;
            }
            return null;
        },
        [part, label],
    );
    if (value === null) return false;
    await select.selectOption({ value });
    return true;
}

/** The sets an ACTUATOR row offers, as 「部品 › 値」 (「油圧ポンプ › オン · 0」), headings resolved. */
export async function setsOf(row) {
    return row
        .locator('select')
        .first()
        .evaluate((s) => {
            let under = null;
            const out = [];
            for (const o of s.options) {
                if (o.disabled && o.text.startsWith('— ')) under = o.text.slice(2);
                else if (o.value !== '') out.push(`${under} › ${o.text}`);
            }
            return out;
        });
}

/** Opens a dialog's 詳細 ⓘ (or another details toggle by its label), where the SGBD's words and the frames are. */
export async function openDetails(page, label = '詳細') {
    const toggle = page.locator('[role=dialog] button[aria-controls]', { hasText: label }).first();
    if ((await toggle.count()) && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}
