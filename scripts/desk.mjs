#!/usr/bin/env node
// ============================================================================
//  desk.mjs — the desk's side of an investigation, through monitoring-desk
// ----------------------------------------------------------------------------
//    npm run desk -- list                     the investigations whose mandate stands
//    npm run desk -- pull <record>            the record, its runs listed, its read records
//    npm run desk -- run <record> <n>         one PROBE run, whole
//    npm run desk -- write <record> <file|->  add entries `[{ "body": … }]` as the desk
//
//  What comes back is written under desk-work/<record>/ (ignored by git: it is
//  an owner's data, without the VIN, and this repository is public) and summed
//  up on stdout. `write` prints the ids written, or the rule that refused.
//
//  Needs MONITORING_DESK_URL (the Worker, workers/desk) and MONITORING_DESK_TOKEN
//  (issued with scripts/desk-token.mjs) in the environment. Never print the token.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.MONITORING_DESK_URL?.replace(/\/+$/, '');
const TOKEN = process.env.MONITORING_DESK_TOKEN;
const OUT = 'desk-work';

const fail = (msg, code = 1) => {
    console.error(msg);
    process.exit(code);
};
if (!BASE || !TOKEN) fail('MONITORING_DESK_URL and MONITORING_DESK_TOKEN must be set (docs/AUTONOMY.md §7).');

async function call(method, route, body) {
    const r = await fetch(`${BASE}${route}`, {
        method,
        headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => null);
    return { status: r.status, data };
}

function save(record, name, data) {
    const dir = path.join(OUT, record);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    return file;
}

const [cmd, record, third] = process.argv.slice(2);

if (cmd === 'list') {
    const { status, data } = await call('GET', '/investigations');
    if (status !== 200) fail(`list: ${status} ${JSON.stringify(data)}`);
    for (const i of data.investigations) {
        console.log(`${i.record}  entries ${i.entries}  runs ${i.runs}  asks ${i.openAsks}  last ${i.lastAt ? new Date(i.lastAt).toISOString() : '—'}`);
        for (const m of i.mandates) console.log(`    mandate ${m.id} until ${new Date(m.until).toISOString()} [${m.modules.join(', ') || 'any module'}] 「${m.words}」`);
    }
    if (data.investigations.length === 0) console.log('No investigation is handed over now.');
} else if (cmd === 'pull') {
    if (!record) fail('usage: pull <record>');
    const { status, data } = await call('GET', `/investigations/${encodeURIComponent(record)}`);
    if (status !== 200) fail(`pull: ${status} ${JSON.stringify(data)}`);
    const file = save(record, 'investigation.json', data);
    console.log(`${file}: ${data.entries.length} entries, ${data.runs.length} runs, ${data.reads.length} read records${data.readsTruncated ? ' (truncated)' : ''}`);
} else if (cmd === 'run') {
    const n = Number(third);
    if (!record || !Number.isInteger(n) || n < 1) fail('usage: run <record> <n>');
    const { status, data } = await call('GET', `/investigations/${encodeURIComponent(record)}/runs/${n}`);
    if (status !== 200) fail(`run: ${status} ${JSON.stringify(data)}`);
    const file = save(record, `run-${n}.json`, data);
    console.log(`${file}: ${data.samples?.length ?? 0} samples, ${data.exchanges?.length ?? 0} exchanges, ended ${data.end}`);
} else if (cmd === 'write') {
    if (!record || !third) fail('usage: write <record> <file|->');
    const text = third === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(third, 'utf8');
    const parsed = JSON.parse(text);
    const entries = Array.isArray(parsed) ? parsed : parsed.entries;
    const { status, data } = await call('POST', `/investigations/${encodeURIComponent(record)}/entries`, { entries });
    if (status !== 200) fail(`write refused (${status}): entry ${data?.index ?? '?'} — ${data?.reason ?? JSON.stringify(data)}`, 2);
    console.log(`written ${data.written}: ${data.ids.join(', ')}`);
} else {
    fail('usage: npm run desk -- list | pull <record> | run <record> <n> | write <record> <file|->');
}
