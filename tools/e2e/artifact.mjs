#!/usr/bin/env node
/**
 * The scenario screens, in scenario order, as one page for the owner (operator, 2026-11-20).
 *
 *   node tools/e2e/artifact.mjs <report dir> <out dir>
 *
 * Reads the demo-test report (`report.json` and `shots/` that tools/e2e/run.mjs writes) and writes
 * `<out>/index.html` and `<out>/shots/*.jpg`: every scenario, its story, and its steps grouped by the
 * screen each group led to — what the owner did or said, what the app should do, what happened, the
 * verdict, then the screen. The page is the delivery of a run; it carries SGBD-derived text, so it is
 * kept private (THIRD-PARTY-NOTICES §3).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [from, to] = process.argv.slice(2);
if (!from || !to) {
    console.error('usage: node tools/e2e/artifact.mjs <report dir> <out dir>');
    process.exit(2);
}
const results = JSON.parse(readFileSync(join(from, 'report.json'), 'utf-8'));
mkdirSync(join(to, 'shots'), { recursive: true });

// PNG screenshots become JPEGs a phone opens quickly.
const jpg = (rel) => {
    const src = join(from, rel);
    if (!existsSync(src)) return null;
    const name = basename(rel).replace(/\.png$/, '.jpg');
    const out = join(to, 'shots', name);
    if (!existsSync(out)) execFileSync('convert', [src, '-resize', '1280x>', '-quality', '72', out]);
    return `shots/${name}`;
};
const h = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const anchor = (id) => id.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const group = (id) => (/^S\d/.test(id) ? '既存のデモ' : /^SC/.test(id) ? 'ふつうのシナリオ' : /^MM/.test(id) ? '5 モジュールを越える' : 'いじわる');

const sections = results.map((r) => {
    const frames = [];
    let rows = [];
    for (const row of r.rows) {
        if (row.shot) {
            frames.push({ rows, shot: jpg(row.shot), label: row.what });
            rows = [];
        } else rows.push(row);
    }
    // The screen the scenario ended on closes it, with the steps after its last screenshot.
    frames.push({ rows, shot: r.endShot ? jpg(r.endShot) : null, label: '終わりの画面' });
    const failed = r.rows.filter((x) => x.ok === false).length;
    const body = frames
        .map((f) => {
            const list = f.rows
                .map(
                    (x) =>
                        `<li class="${x.ok === false ? 'ng' : x.ok ? 'ok' : 'note'}"><span class="who">${h(x.who)}</span> ${h(x.what)}${x.expect ? `<span class="exp">${h(x.expect)}</span>` : ''}${x.ok === false ? `<span class="why">${h(x.why)}</span>` : ''}</li>`,
                )
                .join('');
            return `<div class="frame">${list ? `<ol>${list}</ol>` : ''}${f.shot ? `<figure><img loading="lazy" src="${f.shot}" alt="${h(f.label)}"></figure>` : ''}</div>`;
        })
        .join('');
    return `<section id="${anchor(r.id)}"><h2><span class="id">${h(r.id)}</span> ${h(r.title)} <span class="${r.ok ? 'pass' : 'fail'}">${r.ok ? '合格' : `不合格 ${failed}`}</span></h2><p class="story">${h(r.story ?? '')}</p>${body}</section>`;
});

const passed = results.filter((r) => r.ok).length;
const groups = [...new Set(results.map((r) => group(r.id)))];
const nav = groups
    .map((g) => `<div class="g"><b>${h(g)}</b>${results.filter((r) => group(r.id) === g).map((r) => `<a class="${r.ok ? 'p' : 'f'}" href="#${anchor(r.id)}">${h(r.id)}</a>`).join('')}</div>`)
    .join('');

const html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MONITORING シナリオの画面</title>
<style>
/* VOICE: an instrument's test log — quiet, exact.
   IDEA: a flight-test card: each step, then the screen it led to.
   PICTURE: the app's own screens, in order.
   COLOUR and TYPE: ///M black, slate, blue = pass, red = fail; Inter, mono for what the app said.
   LAYOUT: one column; steps left of the screen on wide panes, above it on narrow ones. */
:root{color-scheme:dark;--bg:#000;--panel:#0a0a0d;--rule:#2a2a33;--ink:#c6c6cf;--dim:#70707e;--blue:#26aee4;--red:#f64a50;--violet:#9b84e8}
*{box-sizing:border-box;min-width:0}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Inter,system-ui,sans-serif;overflow-x:clip}
header{padding:28px max(5vw,16px) 16px;border-bottom:1px solid var(--rule)}
h1{font-size:26px;line-height:1.1;margin:0 0 6px;color:#f2f2f5;font-weight:600}
.sum{color:var(--dim);font-size:13px}
.sum b{color:var(--blue)}.sum b.f{color:var(--red)}
nav{padding:12px max(5vw,16px);border-bottom:1px solid var(--rule);display:grid;gap:6px}
nav .g{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline}
nav b{font-weight:500;color:var(--dim);font-size:12px;width:9em}
nav a{font:12px ui-monospace,monospace;text-decoration:none;padding:2px 0}
nav a.p{color:var(--blue)}nav a.f{color:var(--red)}
main{padding:0 max(5vw,16px) 48px;max-width:1400px}
section{border-bottom:1px solid var(--rule);padding:28px 0}
h2{font-size:18px;margin:0 0 6px;color:#f2f2f5;font-weight:600;text-wrap:balance}
h2 .id{font:13px ui-monospace,monospace;color:var(--dim);margin-right:6px}
.pass,.fail{font-size:12px;font-weight:500;margin-left:8px}.pass{color:var(--blue)}.fail{color:var(--red)}
.story{color:var(--dim);font-size:14px;margin:0 0 14px;max-width:70ch}
.frame{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.6fr);gap:16px;padding:14px 0;border-top:1px solid #17171c}
.frame:first-of-type{border-top:0}
ol{list-style:none;margin:0;padding:0;font-size:13px}
li{padding:4px 0}
li .who{display:inline-block;width:3.4em;color:var(--dim);font-size:12px}
li.ok::before{content:"○ ";color:var(--blue)}li.ng::before{content:"× ";color:var(--red)}li.note::before{content:"· ";color:var(--dim)}
.exp{display:block;color:var(--dim);font-size:12px;padding-left:4.4em}
.why{display:block;color:var(--red);font:12px ui-monospace,monospace;padding-left:4.4em;overflow-wrap:anywhere}
figure{margin:0}img{width:100%;height:auto;display:block;border:1px solid var(--rule)}
@media(max-width:820px){.frame{grid-template-columns:minmax(0,1fr)}}
</style></head><body>
<header><h1>MONITORING シナリオの画面</h1>
<div class="sum">仮想車両（練習の車）での画面操作テスト · <b class="${passed === results.length ? '' : 'f'}">${passed}/${results.length} 合格</b> · ${h(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC · 合格基準は docs/VIRTUAL-CAR-TESTS.md</div></header>
<nav>${nav}</nav>
<main>${sections.join('')}</main>
</body></html>`;
writeFileSync(join(to, 'index.html'), html);
console.log(`${results.length} scenarios, ${passed} passed → ${join(to, 'index.html')}`);
