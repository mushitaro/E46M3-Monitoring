/**
 * A Mainstay's engine report, as this side accepts it, and the desk question it becomes
 * (workers/engine-gateway/src/engineReport.ts, operator 2026-11-11).
 *
 * The store redacts before it sends (GREN BLUE: packages/core/src/domain/engineReport.ts in
 * tsunagi_gren-blue): no VIN, chassis number, name, contact, cost, free text or identification
 * answer. This side does not take that on trust. The shape is checked field by field against the
 * same patterns — printable ASCII only, so Japanese text cannot pass — and then the desk's own
 * redaction (packages/monitoring-engine/src/investigation/redact.ts) runs over it again: an identification job's answer is
 * dropped and any VIN, full or short, becomes `[VIN]`, before anything is stored.
 */
import { isIdentification, redactText } from '../../../packages/monitoring-engine/src/investigation/redact';

export const ENGINE_REPORT_KINDS = ['rejected_telegram', 'unknown_answer', 'undecodable_fault', 'exception'] as const;
export type EngineReportKind = (typeof ENGINE_REPORT_KINDS)[number];

export interface EngineReport {
    kind: EngineReportKind;
    engine: { name: string; version: string; build?: string };
    module?: { address: number; variant?: string };
    job?: string;
    request?: string;
    response?: string;
    fault?: { code: number; raw?: string };
    error?: { name: string; message?: string; stack?: string[] };
}

export interface EngineReportDelivery {
    v: 1;
    mainstay: string;
    entrance: string;
    delivery: string;
    fingerprint: string;
    report: EngineReport;
    count: number;
    total: number;
    firstSeen: string;
    lastSeen: string;
}

const NAME = /^[A-Za-z0-9._+-]{1,40}$/;
const HEX = (maxBytes: number) => new RegExp(`^(?:[0-9a-f]{2}){1,${maxBytes}}$`);
const TELEGRAM = HEX(64);
const FAULT = HEX(16);
const FRAME = /^[A-Za-z0-9_$.<>]{1,60}@[A-Za-z0-9_.-]{1,60}:\d{1,6}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (o: Record<string, unknown>, keys: readonly string[]) => Object.keys(o).every((k) => keys.includes(k));
const intIn = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const opt = (v: unknown, ok: (x: unknown) => boolean) => v === undefined || ok(v);
const str = (re: RegExp) => (v: unknown) => typeof v === 'string' && re.test(v);

/** What is wrong with a report's shape, or null. Unknown keys are wrong: nothing rides along unchecked. */
export function reportProblem(r: unknown): string | null {
    if (!isObj(r)) return 'report';
    if (!onlyKeys(r, ['kind', 'engine', 'module', 'job', 'request', 'response', 'fault', 'error'])) return 'report.keys';
    if (!ENGINE_REPORT_KINDS.includes(r.kind as EngineReportKind)) return 'report.kind';
    const eng = r.engine;
    if (!isObj(eng) || !onlyKeys(eng, ['name', 'version', 'build']) || !str(NAME)(eng.name) || !str(NAME)(eng.version) || !opt(eng.build, str(NAME))) return 'report.engine';
    if (r.module !== undefined) {
        const m = r.module;
        if (!isObj(m) || !onlyKeys(m, ['address', 'variant']) || !intIn(m.address, 0, 255) || !opt(m.variant, str(/^[A-Z0-9_]{1,32}$/))) return 'report.module';
    }
    if (!opt(r.job, str(/^[A-Za-z0-9_]{1,64}$/))) return 'report.job';
    if (!opt(r.request, str(TELEGRAM)) || !opt(r.response, str(TELEGRAM))) return 'report.telegram';
    if (r.fault !== undefined) {
        const f = r.fault;
        if (!isObj(f) || !onlyKeys(f, ['code', 'raw']) || !intIn(f.code, 0, 0xffffff) || !opt(f.raw, str(FAULT))) return 'report.fault';
    }
    if (r.error !== undefined) {
        const e = r.error;
        if (!isObj(e) || !onlyKeys(e, ['name', 'message', 'stack']) || !str(/^[A-Za-z][A-Za-z0-9_]{0,39}$/)(e.name)) return 'report.error';
        if (!opt(e.message, (v) => typeof v === 'string' && v.length <= 200 && /^[\x20-\x7E]*$/.test(v))) return 'report.error.message';
        if (!opt(e.stack, (v) => Array.isArray(v) && v.length <= 8 && v.every(str(FRAME)))) return 'report.error.stack';
    }
    return null;
}

/** What is wrong with a delivery, or null. `mainstay` is the ticket's: the body must say the same. */
export function deliveryProblem(d: unknown, mainstay: string): string | null {
    if (!isObj(d)) return 'body';
    if (!onlyKeys(d, ['v', 'mainstay', 'entrance', 'delivery', 'fingerprint', 'report', 'count', 'total', 'firstSeen', 'lastSeen'])) return 'keys';
    if (d.v !== 1) return 'v';
    if (d.mainstay !== mainstay) return 'mainstay';
    if (!str(/^[a-z0-9-]{2,40}$/)(d.entrance)) return 'entrance';
    if (!str(/^[0-9a-f]{32}$/)(d.fingerprint)) return 'fingerprint';
    if (d.delivery !== `${d.fingerprint as string}.${d.total as number}`) return 'delivery';
    if (!intIn(d.count, 1, 1e9) || !intIn(d.total, 1, 1e9) || (d.count as number) > (d.total as number)) return 'count';
    if (!str(ISO)(d.firstSeen) || !str(ISO)(d.lastSeen)) return 'seen';
    return reportProblem(d.report);
}

/** The desk's own redaction over the store's: an identification answer goes, a VIN becomes [VIN]. */
export function redactReport(r: EngineReport): EngineReport {
    const out: EngineReport = JSON.parse(JSON.stringify(r));
    if (out.job && isIdentification(out.job)) delete out.response;
    if (out.error?.message !== undefined) out.error.message = redactText(out.error.message);
    if (out.job) out.job = redactText(out.job);
    if (out.error?.stack) out.error.stack = out.error.stack.map(redactText);
    return out;
}

const hex = (n: number, width = 2) => `0x${n.toString(16).toUpperCase().padStart(width, '0')}`;
const spaced = (h: string) => h.match(/../g)!.join(' ');

const KIND_JA: Record<EngineReportKind, string> = {
    rejected_telegram: '拒否された電文',
    unknown_answer: '読めない答え',
    undecodable_fault: '文の無い故障',
    exception: '例外',
};

/**
 * The question the desk is given: what failed, where, how often, from which store and entrance.
 * Written by `chat` (relayed, not the owner's words), at most NOTEBOOK_LIMITS.text characters.
 */
export function askTextOf(d: EngineReportDelivery, report: EngineReport, again: boolean, max: number): string {
    const r = report;
    const lines = [
        `[エンジンの報告] ${d.mainstay} · ${d.entrance}${again ? '（続いている）' : ''}`,
        `種類: ${KIND_JA[r.kind]} (${r.kind}) / 指紋: ${d.fingerprint}`,
        `回数: 今回 ${d.count}・累計 ${d.total}（最初 ${d.firstSeen}、最後 ${d.lastSeen}）`,
        `エンジン: ${r.engine.name} ${r.engine.version}${r.engine.build ? ` (${r.engine.build})` : ''}`,
    ];
    if (r.module) lines.push(`モジュール: ${hex(r.module.address)}${r.module.variant ? ` ${r.module.variant}` : ''}`);
    if (r.job) lines.push(`ジョブ: ${r.job}`);
    if (r.request) lines.push(`送った電文: ${spaced(r.request)}`);
    if (r.response) lines.push(`答え: ${spaced(r.response)}`);
    if (r.fault) lines.push(`故障: ${hex(r.fault.code)}${r.fault.raw ? ` (${spaced(r.fault.raw)})` : ''}`);
    if (r.error) {
        lines.push(`例外: ${r.error.name}${r.error.message ? `: ${r.error.message}` : ''}`);
        for (const f of r.error.stack ?? []) lines.push(`  at ${f}`);
    }
    lines.push('診断エンジンの穴として直す（monitoring-loop §1「店のエンジンの報告」）。直したら同じ記録に answer（re はこの ask）で、何を直したか・PR・配信したかを書く。');
    const text = lines.join('\n');
    return text.length <= max ? text : `${text.slice(0, max - 6)}…（以下略）`;
}
