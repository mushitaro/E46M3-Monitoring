#!/usr/bin/env node
/**
 * End-to-end demo tests: the real app, the practice car, and the assistant's tools.
 *
 *   npm run build:e2e && npm run e2e            every scenario in scenarios/e2e
 *   npm run e2e -- 03 05                         only scenarios whose file name starts with these
 *   npm run e2e -- --report <dir>                where the report goes (default e2e-report/)
 *
 * Each scenario (scenarios/e2e/*.mjs) is a story an owner lives through: what they say, what the
 * assistant calls, what they press, what the car does — and, at every step, what the app should do
 * in reply. The runner plays it in Chromium against the static export of a test build
 * (`npm run build:e2e`, which carries src/lib/e2e.ts's door), one fresh browser profile per
 * scenario, and writes a report a person can read: every step, what was expected, what happened,
 * and a screenshot where the step asks for one.
 *
 * Step kinds:
 *   { say }                       the owner's words, recorded as the scenario's prompt
 *   { ai, args, expect }          the assistant calls a tool; expect(result) returns true or why not
 *   { ui: 'click', text | role }  a press on the screen (visible elements only)
 *   { ui: 'practice' }            ticks PRACTICE
 *   { ui: 'tab', name }           a tab
 *   { car }                       sets the practice car (lib/practiceCar)
 *   { wait } / { until: text }    time, or a text appearing
 *   { screen: { has, hasNot } }   what the screen must and must not say
 *   { shot }                      a screenshot into the report
 *   { reload: true }              the page reloaded, as a head unit does on a key cycle
 *   { check: { desc, run } }      run(page, door) inside the page context returns true or why not
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);

// Playwright is not a dependency of the app: the runner uses the one installed on the machine
// (the cloud sessions have it; on a desk, `npm i -g playwright` and `npx playwright install chromium`).
let chromium;
try {
    ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
    console.error('Playwright is not installed on this machine: npm i -g playwright && npx playwright install chromium');
    process.exit(2);
}
const args = process.argv.slice(2);
const reportAt = args.includes('--report') ? resolve(args[args.indexOf('--report') + 1]) : join(ROOT, 'e2e-report');
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--report');
const PORT = 4320;

if (!existsSync(join(ROOT, 'out', 'index.html'))) {
    console.error('No out/. Run `npm run build:e2e` first.');
    process.exit(2);
}

const files = readdirSync(join(ROOT, 'scenarios', 'e2e'))
    .filter((f) => f.endsWith('.mjs') && !f.startsWith('_') && (only.length === 0 || only.some((o) => f.startsWith(o))))
    .sort();

const server = spawn('npx', ['serve', '-l', String(PORT), 'out'], { cwd: ROOT, stdio: 'ignore' });
const base = `http://localhost:${PORT}/`;
for (let i = 0; i < 40; i++) {
    try {
        if ((await fetch(base)).ok) break;
    } catch {
        // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
}

mkdirSync(join(reportAt, 'shots'), { recursive: true });
const browser = await chromium.launch();
const results = [];

const short = (v) => {
    const s = JSON.stringify(v);
    return s && s.length > 400 ? `${s.slice(0, 400)}…` : s;
};

for (const file of files) {
    const scenario = (await import(pathToFileURL(join(ROOT, 'scenarios', 'e2e', file)).href)).default;
    const ctx = await browser.newContext({ viewport: scenario.viewport ?? { width: 1280, height: 800 }, locale: 'ja-JP' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const rows = [];
    let failed = false;
    const record = (row) => {
        rows.push(row);
        if (row.ok === false) failed = true;
        console.log(`${row.ok === false ? '  FAIL' : '  ok  '} ${scenario.id} ${row.who} ${row.what}${row.why ? ` — ${row.why}` : ''}`);
    };

    await page.goto(base);
    await page.waitForFunction(() => !!window.__monitoringE2E, null, { timeout: 15000 });
    // The first-run notice: agreed as an owner would, once.
    const dontShow = page.locator('label:has-text("今後表示しない") input, label:has-text("Don") input');
    if (await dontShow.count()) await dontShow.first().check();
    const agree = page.locator('button:has-text("同意"), button:has-text("Agree")');
    if (await agree.count()) await agree.first().click();
    await page.evaluate((car) => {
        window.__monitoringE2E.car.reset();
        if (car) window.__monitoringE2E.car.set(car);
    }, scenario.car ?? null);

    for (const step of scenario.steps) {
        if (failed && !step.always) break;
        try {
            if (step.say) {
                record({ who: 'オーナー', what: `「${step.say}」`, expect: '', got: '', ok: null });
            } else if (step.ai) {
                const result = await page.evaluate(
                    ([name, a]) => window.__monitoringE2E.tool(name, a).then((r) => ({ r }), (e) => ({ error: String(e?.message ?? e) })),
                    [step.ai, step.args ?? {}],
                );
                const verdict = step.expect ? step.expect(result.r, result.error) : result.error ? result.error : true;
                record({ who: 'AI', what: `${step.ai}(${short(step.args ?? {})})`, expect: step.means ?? '', got: result.error ? `error: ${result.error}` : short(result.r), ok: verdict === true, why: verdict === true ? '' : verdict });
                if (step.keep) step.keep(result.r, scenario.state ??= {});
            } else if (step.ui) {
                const what = step.ui === 'practice' ? 'PRACTICE' : step.ui === 'tab' ? `タブ ${step.name}` : `押す ${step.text ?? step.role}`;
                if (step.ui === 'practice') await page.locator('label:has-text("PRACTICE")').first().click();
                else if (step.ui === 'tab') await page.locator(`[role=tab]:has-text("${step.name}")`).first().click();
                else if (step.role) await page.getByRole('button', { name: step.role, exact: true }).first().click();
                else await page.locator(`button:visible:has-text("${step.text}")`).last().click();
                if (step.settle !== 0) await page.waitForTimeout(step.settle ?? 600);
                record({ who: '画面', what, expect: step.means ?? '', got: '', ok: null });
            } else if (step.car) {
                await page.evaluate((c) => window.__monitoringE2E.car.set(c), step.car);
                record({ who: '車', what: short(step.car), expect: step.means ?? '', got: '', ok: null });
            } else if (step.wait) {
                await page.waitForTimeout(step.wait);
            } else if (step.until) {
                await page.waitForFunction((t) => document.body.innerText.includes(t), step.until, { timeout: step.timeout ?? 20000 });
                record({ who: '画面', what: `「${step.until}」が出るまで待つ`, expect: step.means ?? '', got: '出た', ok: true });
            } else if (step.screen) {
                const text = await page.evaluate(() => document.body.innerText);
                const missing = (step.screen.has ?? []).filter((t) => !text.includes(t));
                const present = (step.screen.hasNot ?? []).filter((t) => text.includes(t));
                const ok = missing.length === 0 && present.length === 0;
                record({ who: '画面', what: step.screen.desc ?? '表示', expect: [...(step.screen.has ?? []).map((t) => `「${t}」`), ...(step.screen.hasNot ?? []).map((t) => `「${t}」なし`)].join(' '), got: ok ? 'そのとおり' : '', ok, why: ok ? '' : [...missing.map((t) => `「${t}」が無い`), ...present.map((t) => `「${t}」がある`)].join('、') });
            } else if (step.shot) {
                const name = `${scenario.id}-${step.shot}.png`;
                await page.screenshot({ path: join(reportAt, 'shots', name) });
                rows.push({ who: '画面', what: `撮影 ${step.shot}`, shot: `shots/${name}`, ok: null });
            } else if (step.reload) {
                await page.reload();
                await page.waitForFunction(() => !!window.__monitoringE2E, null, { timeout: 15000 });
                await page.waitForTimeout(800);
                record({ who: '画面', what: '読み込み直し', expect: step.means ?? '', got: '', ok: null });
            } else if (step.check) {
                const verdict = await step.check.run(page, scenario.state ??= {});
                record({ who: '確認', what: step.check.desc, expect: step.means ?? '', got: verdict === true ? 'そのとおり' : '', ok: verdict === true, why: verdict === true ? '' : String(verdict) });
            }
        } catch (e) {
            record({ who: '実行', what: JSON.stringify(Object.keys(step)), ok: false, why: String(e?.message ?? e).split('\n')[0] });
        }
    }
    if (errors.length) record({ who: 'ページ', what: 'JavaScript のエラー', ok: false, why: errors.join(' / ').slice(0, 300) });
    const name = `${scenario.id}-end.png`;
    await page.screenshot({ path: join(reportAt, 'shots', name) });
    results.push({ scenario, rows, ok: !failed && errors.length === 0, endShot: `shots/${name}` });
    await ctx.close();
}

await browser.close();
server.kill();

// ---- the report ------------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const lines = [`# MONITORING デモテスト`, '', `${new Date().toISOString()} · ${results.filter((r) => r.ok).length}/${results.length} 合格`, ''];
lines.push('| シナリオ | 結果 |', '|---|---|');
for (const r of results) lines.push(`| ${r.scenario.id} ${esc(r.scenario.title)} | ${r.ok ? '合格' : '**不合格**'} |`);
for (const r of results) {
    lines.push('', `## ${r.scenario.id} ${r.scenario.title}`, '', r.scenario.story ?? '', '');
    lines.push('| # | 誰 | したこと | 想定する反応 | 起きたこと | 判定 |', '|---|---|---|---|---|---|');
    r.rows.forEach((row, i) => {
        if (row.shot) {
            lines.push(`| ${i + 1} | ${row.who} | ${esc(row.what)} | | ![](${row.shot}) | |`);
            return;
        }
        lines.push(`| ${i + 1} | ${row.who} | ${esc(row.what)} | ${esc(row.expect)} | ${esc(row.got)}${row.why ? ` ${esc(row.why)}` : ''} | ${row.ok === null ? '' : row.ok ? '○' : '×'} |`);
    });
    lines.push('', `![終わりの画面](${r.endShot})`);
}
writeFileSync(join(reportAt, 'report.md'), lines.join('\n') + '\n');
// One self-contained page (screenshots inline), to read on a phone.
const h = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const img = (rel) => `<img alt="" src="data:image/png;base64,${readFileSync(join(reportAt, rel)).toString('base64')}">`;
const passed = results.filter((r) => r.ok).length;
const html = [
    '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>MONITORING デモテスト</title><style>',
    ':root{color-scheme:dark}body{margin:0;padding:16px;background:#000;color:#cbd5e1;font:14px/1.6 system-ui,sans-serif}',
    'h1{font-size:18px;color:#e2e8f0}h2{font-size:15px;color:#e2e8f0;margin-top:32px;border-top:1px solid #1e293b;padding-top:16px}',
    'table{border-collapse:collapse;width:100%;font-size:12px}td,th{border-bottom:1px solid #0f172a;padding:4px 6px;text-align:left;vertical-align:top}',
    'th{color:#64748b;font-weight:600}.ok{color:#34d399}.ng{color:#f87171;font-weight:700}code{font-size:11px;color:#94a3b8;word-break:break-all}',
    'img{max-width:100%;border:1px solid #1e293b;margin:8px 0}p{color:#94a3b8}',
    '</style></head><body>',
    `<h1>MONITORING デモテスト — ${passed}/${results.length} 合格</h1><p>${h(new Date().toISOString())} · 模擬実車（PRACTICE）＋アシスタントの道具</p>`,
    '<table><tr><th>シナリオ</th><th>結果</th></tr>',
    ...results.map((r) => `<tr><td>${h(r.scenario.id)} ${h(r.scenario.title)}</td><td class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '合格' : '不合格'}</td></tr>`),
    '</table>',
    ...results.flatMap((r) => [
        `<h2>${h(r.scenario.id)} ${h(r.scenario.title)} <span class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '合格' : '不合格'}</span></h2>`,
        `<p>${h(r.scenario.story)}</p>`,
        '<table><tr><th>#</th><th>誰</th><th>したこと</th><th>想定する反応</th><th>起きたこと</th><th></th></tr>',
        ...r.rows.map((row, i) =>
            row.shot
                ? `<tr><td>${i + 1}</td><td colspan="5">${img(row.shot)}</td></tr>`
                : `<tr><td>${i + 1}</td><td>${h(row.who)}</td><td><code>${h(row.what)}</code></td><td>${h(row.expect)}</td><td><code>${h(row.got)}</code>${row.why ? ` <span class="ng">${h(row.why)}</span>` : ''}</td><td class="${row.ok === false ? 'ng' : 'ok'}">${row.ok === null ? '' : row.ok ? '○' : '×'}</td></tr>`,
        ),
        '</table>',
        img(r.endShot),
    ]),
    '</body></html>',
].join('\n');
writeFileSync(join(reportAt, 'report.html'), html);
writeFileSync(join(reportAt, 'report.json'), JSON.stringify(results.map((r) => ({ id: r.scenario.id, title: r.scenario.title, ok: r.ok, rows: r.rows })), null, 2));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} scenarios passed. Report: ${join(reportAt, 'report.md')}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
