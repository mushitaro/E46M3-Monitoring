import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EcuIndex, EcuProfile, JobFramesOracle, SgbdResultsTable, TelegramTable } from '@tsunagi/monitoring-engine';
import { hasFaultRead, hasIdent, moduleChannels, moduleProtocol, withAgreedFrames } from '@tsunagi/monitoring-engine';
import { MSS54_CHANNELS } from '@tsunagi/ds2-mss54';
import { isOn } from './jobSurface';
import { runCoverage, type CoverageItem } from './runCoverage';

/**
 * Every job the owner's table opens runs, or cannot for a reason outside this app (operator,
 * 2026-11-18: the completion criteria — 「表で『実行』なのに動かない項目の一覧を、CI が毎回出す。直せない
 * 理由が付いたもの以外が 1 件でもあれば落ちる」). The counts print on every run; the whole list is written
 * to run-coverage/RUN-COVERAGE.md with WRITE_COVERAGE=1 (npm run coverage:runs) and kept in the private
 * data repository, so the owner reads what the test reads.
 */
const DATA = path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data');
const HAVE = existsSync(path.join(DATA, 'job-frames.oracle.json'));
const read = <T,>(f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf-8')) as T;

const opt = <T,>(f: string): T | null => existsSync(path.join(DATA, f)) ? read<T>(f) : null;

function coverage(): CoverageItem[] {
    const index = read<EcuIndex>('index.json');
    const ids = index.modules.map((m) => m.id);
    return runCoverage({
        index,
        profiles: new Map(ids.map((id) => [id, read<EcuProfile>(`${id}.jobs.json`)])),
        telegrams: new Map(ids.flatMap((id) => { const t = opt<TelegramTable>(`${id}.telegrams.json`); return t ? [[id, t] as const] : []; })),
        results: new Map(ids.map((id) => [id, opt<SgbdResultsTable>(`${id}.results.json`)])),
        oracle: read<JobFramesOracle>('job-frames.oracle.json'),
    });
}

function moduleInventory(items: CoverageItem[]): string {
    const lines = [
        '# E46 診断機器別の収録範囲', '',
        '識別と故障は電文・読取定義の有無。測定は画面が列挙できる数値項目数。サービスと作動は一覧の分類で、確認・実行・停止の実車試験は別途必要。', '',
        '| 機器 | 系統 | 識別 | 故障読取 | 測定項目 | サービス | 作動 | 読み取り以外で実行条件が揃うジョブ | 定義のみ |',
        '|---|---|---|---|---:|---:|---:|---:|---:|',
    ];
    const oracle = read<JobFramesOracle>('job-frames.oracle.json');
    for (const { id, address, group } of read<EcuIndex>('index.json').modules) {
        const profile = read<EcuProfile>(id + '.jobs.json');
        const raw = opt<TelegramTable>(id + '.telegrams.json');
        const results = opt<SgbdResultsTable>(id + '.results.json');
        const telegrams = raw && withAgreedFrames(raw, oracle, results);
        const protocol = moduleProtocol(id, address, telegrams);
        const data = results && { address, profile, telegrams, results, jobs: new Map(profile.jobs.map(j => [j.id, j])) };
        const channels = id === 'mss54' ? MSS54_CHANNELS.size : data ? moduleChannels(id, data).length : 0;
        const service = profile.jobs.filter(isOn('service')).length;
        const actuator = profile.jobs.filter(isOn('actuator')).length;
        const eligible = items.filter(i => i.module === id && i.status === 'runs').length;
        const faultJob = results?.jobs.FS_LESEN && !profile.jobs.find(j => j.id === 'FS_LESEN')?.catalogOnly;
        const inventory = profile.jobs.filter(j => j.catalogOnly).length;
        lines.push(`| ${id} | ${group} | ${hasIdent(protocol) ? 'あり' : '—'} | ${hasFaultRead(protocol) || faultJob ? 'あり' : '—'} | ${channels} | ${service} | ${actuator} | ${eligible} | ${inventory} |`);
    }
    return lines.join('\n') + '\n';
}

function report(items: CoverageItem[]): string {
    const by = (s: CoverageItem['status']) => items.filter((i) => i.status === s);
    const fit = new Map(read<EcuIndex>('index.json').modules.map((m) => [m.id, m.fit ?? 'm3']));
    const inventoryOnly = [...fit.keys()].flatMap(id => read<EcuProfile>(id + '.jobs.json').jobs.filter(job => job.catalogOnly).map(job => id + '.' + job.id));
    const line = (i: CoverageItem) => `| ${i.module} | ${i.job} | ${i.nature} | ${i.who === 'ai' ? 'AI も' : '画面の人'} | ${i.sets ?? ''} | ${(i.why ?? '').replace(/\|/g, '/')} |`;
    const head = '| モジュール | ジョブ | 性質 | 誰が | 値の組 | 理由 |\n|---|---|---|---|---|---|';
    const count = (pred: (i: CoverageItem) => boolean) => items.filter(pred).length;
    return [
        '# 表で「実行」の項目が動くか',
        '',
        '`npm run coverage:runs` が書く（`src/lib/runCoverage.ts`）。運営者の表（`policy.ts`）で「実行」にした項目を、全部のモジュールについて数える。',
        '「動く」は、練習で一度動かしたあと、停車中に、ゲートが通すこと。実車で確かめたかどうかは台帳が持つ。',
        '',
        `| | 動く | 外の理由で動かない | 未完了 |`,
        '|---|---|---|---|',
        `| E46 M3 | ${count((i) => fit.get(i.module) !== 'nonm3' && i.status === 'runs')} | ${count((i) => fit.get(i.module) !== 'nonm3' && i.status === 'external')} | ${count((i) => fit.get(i.module) !== 'nonm3' && i.status === 'open')} |`,
        `| M3 以外の E46 | ${count((i) => fit.get(i.module) === 'nonm3' && i.status === 'runs')} | ${count((i) => fit.get(i.module) === 'nonm3' && i.status === 'external')} | ${count((i) => fit.get(i.module) === 'nonm3' && i.status === 'open')} |`,
        '',
        `定義は収録済みで実行照合待ちの項目は ${inventoryOnly.length} 件。下表の実行件数には含まない。`,
        '',
        '## 未完了',
        '',
        by('open').length ? [head, ...by('open').map(line)].join('\n') : 'なし。',
        '',
        '## 定義収録・実行照合待ち',
        '',
        ...inventoryOnly.map(id => '- ' + id),
        '',
        '## 外の理由で動かないもの',
        '',
        'EdiabasLib（BMW のジョブを動かす仕組み）でも、試したどの値でも何も送らない。ジョブがモジュールと話さないか、どの値も断る。',
        '',
        by('external').length ? [head, ...by('external').map(line)].join('\n') : 'なし。',
        '',
        '## 動くもの',
        '',
        [head, ...by('runs').map(line)].join('\n'),
        '',
    ].join('\n');
}

describe.skipIf(!HAVE)('every job the owner’s table opens runs (operator, 2026-11-18)', () => {
    const items = HAVE ? coverage() : [];
    if (process.env.WRITE_COVERAGE === '1') {
        // Job names in bulk are SGBD-derived: the list stays out of this public repository (run-coverage/
        // is ignored) and goes to the private data repository with the data it was measured on.
        const dir = path.resolve(import.meta.dirname, '..', '..', 'run-coverage');
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'RUN-COVERAGE.md'), report(items));
        writeFileSync(path.join(dir, 'E46-MODULES.md'), moduleInventory(items));
    }
    // The counts, always: what CI shows on every run.
    if (HAVE) console.log(report(items).split('## 未完了')[0]);

    it('covers the E46 M3, the non-M3 E46 and the DSC MK60', () => {
        const modules = new Set(items.map((i) => i.module));
        expect(modules.has('mss54') && modules.has('smg2') && modules.has('dsc_mk60') && modules.has('ms430ds0') && modules.has('gs20')).toBe(true);
    });

    it('leaves nothing open', () => {
        expect(items.filter((i) => i.status === 'open').map((i) => `${i.module}.${i.job}: ${i.why}`)).toEqual([]);
    });

    it('builds every set EdiabasLib sends something for as EdiabasLib does', () => {
        expect(items.filter((i) => i.disagree).map((i) => `${i.module}.${i.job} (${i.disagree!.count}): ${i.disagree!.first}`)).toEqual([]);
    });
});
