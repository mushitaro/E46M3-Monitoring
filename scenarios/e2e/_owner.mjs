/**
 * Helpers for the owner's scenarios SC08–SC13 and MM01–MM04 (docs/VIRTUAL-CAR-TESTS.md M1, M2).
 *
 * Their pass criteria are what the owner sees and hears, so most checks read the screen. Every step
 * runs even after one has failed (`always`): a scenario reports each of its criteria, not only the first
 * that broke.
 */
import { tool } from './_lib.mjs';

export { tool };

/** Marks every step to run even after an earlier one failed. */
export const always = (steps) => steps.map((s) => ({ ...s, always: true }));

/** The page's visible text. */
export const bodyText = (page) => page.evaluate(() => document.body.innerText);

/** Polls `fn` until it returns a truthy value or the time runs out; returns the last value. */
export async function until(page, fn, ms = 10000, every = 250) {
    let v;
    for (let t = 0; t <= ms; t += every) {
        v = await fn();
        if (v) return v;
        await page.waitForTimeout(every);
    }
    return v;
}

/** Japanese characters (kana or kanji) somewhere in the text. */
export const hasJa = (s) => /[぀-ヿ一-鿿]/.test(String(s ?? ''));

/** The practice car's VIN (last seven). It may stand only in the scan's own field. */
export const PRACTICE_VIN = 'JR12345';

/** The module on the screen, connected (the same door as DISCONNECT and CONNECT). Null when it is; why not otherwise. */
export async function onModule(page, module) {
    const s = await tool(page, 'monitoring_status');
    if (s?.module?.id === module && s.link === 'connected') return null;
    const r = await tool(page, 'monitoring_module', { module });
    if (r?.switched === false || r?.error) return `monitoring_module ${module}: ${r.reason ?? r.error}`;
    const ok = await until(page, async () => {
        const t = await tool(page, 'monitoring_status');
        return t?.module?.id === module && t.link === 'connected';
    }, 12000, 300);
    return ok ? null : `${module} did not connect`;
}

/** Waits for a scan to end; returns the modules it read, or why not. */
export async function scanModules(page) {
    const done = await until(page, async () => {
        const s = await tool(page, 'monitoring_status');
        return s?.scan && s.scan.running === false ? s.scan : null;
    }, 150000, 1000);
    if (!done) return 'scan did not end';
    const f = await tool(page, 'monitoring_faults');
    return f?.faults?.scan?.modules ?? f?.scan?.modules ?? `no modules: ${JSON.stringify(f).slice(0, 200)}`;
}

/** The innermost element holding a job's name and its name's button: its ACTUATOR row. */
export const actuatorRow = (page, job) =>
    page.locator(`xpath=//*[.//*[@data-test="tj-pick"]][.//*[normalize-space(text())="${job}"]]`).last();

/** The confirmation of a run on the screen: every box ticked, then run. False when no confirmation came. */
export async function confirmRun(page) {
    const run = page.locator('[data-test="gate-run"]');
    try {
        await run.waitFor({ timeout: 3000 });
    } catch {
        return false;
    }
    for (const box of await page.locator('[role=dialog] input[type=checkbox]').all()) if (await box.isEnabled()) await box.check();
    await run.click();
    return true;
}

/** A drive as the practice car follows it, started now (in the page's own clock). */
export const startDrive = (points) => ({
    check: {
        desc: '練習の車が走りの筋書きを流し始める',
        run: async (page, st) => {
            st.driveAt = await page.evaluate((p) => {
                const at = Date.now();
                window.__monitoringE2E.car.set({ drive: { points: p, startedAt: at } });
                return at;
            }, points);
            return true;
        },
    },
});

/**
 * On ACTUATOR, as a person in PRACTICE: the first job that can run (choosing its first set of values
 * where it takes them), run after its confirmation, then stopped. Returns
 * { ran: job } with what the screen showed, or { reason } — the screen's reason when nothing can run.
 */
export async function practiceOneOnScreen(page, module) {
    const off = await onModule(page, module);
    if (off) return { error: off };
    await page.locator('[role=tab]:has-text("ACTUATOR")').first().click();
    await page.waitForTimeout(800);
    // An address two of the app's modules share with nothing in the IDENT to tell them apart: the owner,
    // who knows the car, says which once on ACTUATOR (lib/variantChoice) — this module, by its own name.
    let answered = null;
    if (/この車はどれですか|この車はどちらですか/.test(await bodyText(page))) {
        const name = await page.evaluate(async (id) => (await (await fetch('/ecu-data/index.json')).json()).modules.find((m) => m.id === id)?.name ?? null, module);
        const pick = name ? page.getByRole('button', { name, exact: true }) : null;
        if (pick && (await pick.count())) {
            await pick.first().click();
            answered = name;
            await page.waitForTimeout(400);
        }
    }
    // The ring is the chosen row's RUN or START (UX-01): a row is tried by pressing its name. The first
    // whose ring is pressable is the one, as a person going down the list would find it.
    const ring = () => page.locator('[data-test="tj-run"]:not([disabled]), [data-test="tj-start"]:not([disabled])');
    const picks = page.locator('[data-test="tj-pick"]');
    const tryRows = async () => {
        const n = await picks.count();
        for (let i = 0; i < n; i++) {
            await picks.nth(i).click();
            await page.waitForTimeout(60);
            if ((await ring().count()) > 0) return picks.nth(i);
        }
        return null;
    };
    let picked = await tryRows();
    let chose = false;
    if (!picked) {
        // A job that takes values: choose its first set.
        // Not the header's module select.
        const selects = page.locator('select:visible:not(:has(option[value="mss54"]))').filter({ has: page.locator('option:nth-child(2)') });
        if ((await selects.count()) > 0) {
            // The first set a person can pick: not the label line, not a part's heading (a disabled line
            // of its own, ActuatorView's ChoiceSelect).
            const sel = selects.first();
            const at = await sel.evaluate((s) => [...s.options].findIndex((o) => !o.disabled && o.value !== ''));
            if (at > 0) await sel.selectOption({ index: at });
            chose = true;
            await page.waitForTimeout(400);
            // Choosing a set chooses its row.
            if ((await ring().count()) > 0) picked = sel;
        }
    }
    if (!picked) {
        const text = await bodyText(page);
        const lines = text.slice(text.lastIndexOf('\nACTUATOR\n') + 1, text.indexOf('\nVISU\n')).split('\n').map((l) => l.trim()).filter(Boolean);
        const pane = lines.filter((l) => !/^ACTUATOR$|件が実行可能|^\d+ \/ \d+$|^実行できるものだけ$/.test(l)).join('\n');
        return { reason: pane.replace(/\n+/g, ' ').slice(0, 300), pane, chose, answered };
    }
    const button = ring().first();
    const job = await picked.evaluate((b) => {
        let el = b;
        for (let i = 0; i < 8 && el; i++, el = el.parentElement) {
            // The job's SGBD name (with an underscore) before any capitals in the part's name (VANOS).
            const m = /\b([A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/.exec(el.innerText ?? '') ?? /\b([A-Z][A-Z0-9_]{3,})\b/.exec(el.innerText ?? '');
            if (m) return m[1];
        }
        return '?';
    });
    await button.click();
    if (!(await confirmRun(page))) return { error: `${job}: 確認が出ない` };
    await page.waitForTimeout(1500);
    const stops = () => page.locator('[data-test="tj-stop"]:not([disabled])').count();
    const during = await bodyText(page);
    const armedDuring = await stops();
    const s = await tool(page, 'monitoring_status');
    await tool(page, 'monitoring_stop_outputs');
    await page.waitForTimeout(1000);
    const after = await bodyText(page);
    return { ran: job, during, after, armedDuring, armedAfter: await stops(), error: s?.error ?? null, answered };
}

/** Text of the first open dialog, or ''. */
export const dialogText = async (page) => {
    const d = page.locator('[role=dialog]').first();
    return (await d.count()) ? d.innerText() : '';
};
