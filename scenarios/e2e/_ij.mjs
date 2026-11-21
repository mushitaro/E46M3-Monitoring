/**
 * Helpers the adversarial scenarios (ij*.mjs, docs/VIRTUAL-CAR-TESTS.md M3) share.
 *
 * Each scenario keeps going after a failed step (`always`), so one run shows every criterion of
 * its IJ rows: a failure here is a finding (scenarios/e2e/FINDINGS-ij.md), not a reason to stop.
 */
import { tool } from './_lib.mjs';

/** Every step runs, whatever failed before it. */
export const always = (steps) => steps.map((s) => ({ ...s, always: true }));

/** A check step. */
export const check = (desc, run, means) => ({ check: { desc, run }, ...(means ? { means } : {}) });

/** The practice car, from inside a check. */
export const setCar = (page, patch) => page.evaluate((c) => window.__monitoringE2E.car.set(c), patch);
export const getCar = (page) => page.evaluate(() => window.__monitoringE2E.car.get());

/** The frames the practice car heard since `since` (Date.now() in the page). */
export const wireSince = (page, since) => page.evaluate((s) => window.__monitoringE2E.car.wire(s), since);
export const pageNow = (page) => page.evaluate(() => Date.now());

/** The screen's text. */
export const screenText = (page) => page.evaluate(() => document.body.innerText);

/**
 * Whether ACTUATOR's right column says something is on ("作動中" with its rows) rather than
 * "作動中のものはありません". Only ACTUATOR shows it.
 */
export const armedOnScreen = async (page) => (await screenText(page)).replaceAll('作動中のものはありません', '').includes('作動中');

/** The module on the screen, connected (the same door as DISCONNECT and CONNECT). Null when done. */
export const onModule = async (page, module) => {
    const s = await tool(page, 'monitoring_status');
    if (s?.module?.id === module && s.link === 'connected') return null;
    const r = await tool(page, 'monitoring_module', { module });
    if (r?.switched === false) return `monitoring_module ${module}: ${r.reason}`;
    for (let i = 0; i < 40; i++) {
        await page.waitForTimeout(300);
        const t = await tool(page, 'monitoring_status');
        if (t?.linkModule?.id === module && t.link === 'connected') return null;
    }
    return `${module} did not connect`;
};

/**
 * Waits until the speed the gate holds is no longer "moving" (a reading ages out, or a read measures
 * it again). Returns the motion it ended on and how long it took.
 */
export const measure = async (page, limitMs = 20000) => {
    const t0 = Date.now();
    let car = null;
    while (Date.now() - t0 < limitMs) {
        car = (await tool(page, 'monitoring_status')).car;
        if (car !== 'moving') break;
        await page.waitForTimeout(500);
    }
    return car;
};

/** How long, after the car stops, the assistant is still refused as "moving": ms, or null when it never cleared. */
export const untilStartable = async (page, start, limitMs = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < limitMs) {
        const r = await start();
        if (r?.started) return { ms: Date.now() - t0, r };
        if (!/moving/i.test(r?.reason ?? '')) return { ms: null, r };
        await page.waitForTimeout(500);
    }
    return { ms: null, r: null };
};

/** What EdiabasLib's simulation sent for a job and its values (job-frames.oracle.json). */
export const oracleSends = (page, key, args) =>
    page.evaluate(
        async ([k, a]) => {
            const o = await (await fetch('/ecu-data/job-frames.oracle.json')).json();
            const job = o.jobs[k];
            if (!job) return null;
            const c = job.cases.find((x) => x.args.length >= a.length && a.every((v, i) => x.args[i] === v));
            return c ? c.sends : null;
        },
        [key, args],
    );

/** The text of a scan row on DIAGNOSIS (ALL MODULES): the address line and the lines under it, up to the next address. */
export const scanRow = async (page, address) => {
    const lines = (await screenText(page)).split('\n').map((l) => l.trim()).filter(Boolean);
    const i = lines.indexOf(address);
    if (i < 0) return null;
    const out = [];
    for (let j = i + 1; j < lines.length && !/^0x[0-9A-F]{2}$/.test(lines[j]) && !/^VISU$/.test(lines[j]); j++) out.push(lines[j]);
    return out.join(' / ');
};

/** SMG II's hydraulic pump, as the owner's table opens it to the assistant. */
export const PUMP = ['HYDROPUMPE', 'AKTIV', '0'];
export const PUMP_ON = '32 07 0c 05 01 00 3d';
export const PUMP_OFF = '32 07 0c 05 00 00 3c';

/** The assistant starts the pump after the owner's OK. */
export const startPump = (page, ownerSaid = 'いいよ') =>
    tool(page, 'monitoring_actuate', { module: 'smg2', job: 'STEUERN_STELLGLIED', phase: 'pulse', owner_said: ownerSaid, values: PUMP });

/** Any VIN the practice car holds, and the bytes its cluster answers with. */
export const VIN_TEXT = /JR12345|JR 12345/;
