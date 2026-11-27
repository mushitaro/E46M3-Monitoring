/**
 * What the owner's assistant can do through MONITORING WORKS, and what may stop it — built from the
 * code that decides it, not written by hand (owner, 2026-11-26: the assistant answered "can't" and
 * "why it stopped" from README and docs, which were older than the code).
 *
 * One builder, two readers: `monitoring_capabilities` answers with it, and `docs/CAPABILITIES.md` is
 * its text (`npm run gen:capabilities`; capabilities.test.ts fails when the file is not what the
 * code says). The sources are the tool list (tools.ts), the owner's table (engine policy.ts) and the
 * closed list of stops (engine stopReasons.ts, docs/NO-STOP.md §2). Whatever README, docs, a Skill
 * or an earlier conversation says, this is what the build does.
 */
import {
    assistantLine,
    assistantLineJa,
    loadEcuIndex,
    loadFaultLayouts,
    loadVariantRules,
    moduleRoster,
    ownerRules,
    ownerTable,
    refusalKinds,
    stopList,
    type ModuleCapability,
    type Nature,
} from '@tsunagi/monitoring-engine';
import { MONITORING_TOOLS, GUIDE_TOOL, RELAY_DEV_TOOLS, type MonitoringToolName } from './tools';

/**
 * The tools that reach each nature for the assistant. A nature whose decision is `who: 'ai'` and
 * `how: 'run'` must name at least one (capabilities.test.ts); one that is `off` names none.
 */
export const NATURE_TOOLS: Readonly<Record<Nature, readonly MonitoringToolName[]>> = {
    r_ident: ['monitoring_faults', 'monitoring_scan', 'monitoring_probe'],
    r_status: ['monitoring_probe', 'monitoring_log_channels', 'monitoring_start_log'],
    r_misc: ['monitoring_probe'],
    a_disp: ['monitoring_actuate'],
    a_av: ['monitoring_actuate'],
    a_comfort: ['monitoring_actuate'],
    a_body: ['monitoring_actuate'],
    a_chassis: ['monitoring_actuate'],
    a_engine: ['monitoring_actuate'],
    a_smg: ['monitoring_actuate'],
    a_brake: ['monitoring_actuate'],
    a_safety: [],
    p_smg: ['monitoring_procedure'],
    c_check: ['monitoring_actuate'],
    c_sim: ['monitoring_actuate'],
    c_adapt: ['monitoring_actuate'],
    c_mode: ['monitoring_actuate'],
    c_setup: ['monitoring_actuate'],
    c_clear: ['monitoring_actuate'],
    w: [],
};

/** What only a person does, on the screen, and why no tool does it. */
export const SCREEN_ONLY: ReadonlyArray<{ ja: string; en: string }> = [
    { ja: '新しいケーブル（機器）の許可。一度許可したケーブルへのつなぎ直しと切断は AI もできる（monitoring_connect・monitoring_disconnect）', en: 'Allowing a new cable (device). Reconnecting the cable already allowed, and letting it go, the assistant does (monitoring_connect, monitoring_disconnect).' },
    { ja: '書き込み（コーディング・プログラミング・識別・フラッシュ）：運営者の表で「出さない」', en: 'Writes (coding, programming, identity, flash): off in the owner’s table.' },
    { ja: '安全装置の展開：運営者の表で「出さない」', en: 'Deploying safety equipment: off in the owner’s table.' },
];

/** The rules over every decision, in WORKS's own names (the engine's ownerRules: SUITE says its own). */
const RULES = ownerRules({ stopTool: 'monitoring_stop_outputs', wordsArg: 'owner_said' });

/** The first sentence of a tool's description: what it is for. */
function firstSentence(s: string): string {
    const m = /^(.+?[.:])(\s|$)/.exec(s);
    const line = (m ? m[1] : s).trim();
    return line.length > 240 ? `${line.slice(0, 237)}…` : line;
}

export interface Capabilities {
    source: string;
    rule: string;
    tools: Array<{ name: string; scope: 'read' | 'control'; what: string }>;
    owner: Array<{ nature: Nature; ja: string; en: string; when: string; how: string; who: string; assistant: string; tools: readonly string[] }>;
    rules: string[];
    stops: Array<{ id: string; ja: string; en: string; next: string; nextJa: string; where: string }>;
    refusals: Record<string, string>;
    screenOnly: string[];
    more: string;
    /** Every module this build carries (ecu-data), with how it is told apart and how its faults are read.
     *  Only in the tab's answer and its hello: docs/CAPABILITIES.md is built without the data. */
    modules?: ModuleCapability[];
    moduleRules?: string[];
}

/** One module (the engine's moduleRoster, the same in SUITE). */
export type { ModuleCapability };
export { moduleRoster };

const MODULE_RULES = [
    'Every module listed is read: its IDENT, and its fault memory — moving or parked (owner’s table). `faults` says by what; bytes kept as the answer are still an answer, never "cannot read".',
    'Which module is at an address: `chosenBy`. For `owner`, ask the owner once per car and record it with monitoring_variant; reads go on meanwhile. `profile-default` modules are the module list’s E46 M3 equipment, sent once 0x12 answered MSS54; on any other car they get only the common IDENT.',
    'What one module offers now (its jobs, whether each may go, the gate’s reason): monitoring_catalog with its id.',
];

/** The whole answer, modules included: what monitoring_capabilities returns and the hello carries. */
export async function capabilitiesNow(): Promise<Capabilities> {
    const c = capabilities();
    try {
        const [index, rules, layouts] = await Promise.all([loadEcuIndex(), loadVariantRules(), loadFaultLayouts()]);
        return { ...c, modules: moduleRoster(index, rules, layouts), moduleRules: MODULE_RULES };
    } catch (e) {
        // Without the catalogue the rest still holds; say the module list is missing rather than leave it out silently.
        return { ...c, moduleRules: [`The module list could not be read (${(e as Error).message}): ask monitoring_catalog per module.`] };
    }
}

export function capabilities(): Capabilities {
    const tools: Capabilities['tools'] = (Object.entries(MONITORING_TOOLS) as Array<[MonitoringToolName, { scope: 'read' | 'control'; description: string }]>).map(([name, d]) => ({
        name,
        scope: d.scope,
        what: firstSentence(d.description),
    }));
    tools.push(
        { name: GUIDE_TOOL, scope: 'read', what: 'The procedure for the conversation (held by the relay, there while the tab sleeps; so is this answer).' },
        ...RELAY_DEV_TOOLS.map((name) => ({ name, scope: 'control' as const, what: name.endsWith('request') ? "The operator's words to MONITORING's development, without the tab." : "Development's answers to the operator's requests." })),
    );
    return {
        source: 'Built by this build from its own code: the tool list (src/lib/bridge/tools.ts), the owner’s table (policy.ts OWNER_DECISION) and the closed list of stops (stopReasons.ts, docs/NO-STOP.md §2).',
        rule: 'This is what the app does now. README, docs, a Skill, memory or an earlier conversation may be older: where they differ, this wins. Do not say something cannot be done unless this answer or the tab’s refusal says so; a refusal names its stop below, and every stop has a next step.',
        tools,
        owner: ownerTable((n) => NATURE_TOOLS[n]).map(({ nature, ja, en, when, how, who, assistant, tools }) => ({ nature, ja, en, when, how, who, assistant, tools })),
        rules: RULES.map((r) => r.en),
        stops: stopList(),
        // Which stop each refusal is, and the two kinds of "not started" that are not a stop (engine refusal()).
        refusals: refusalKinds(),
        screenOnly: SCREEN_ONLY.map((x) => x.en),
        more: 'monitoring_status: the tab now (link, speed, stationary or not). monitoring_catalog: one module’s jobs and whether each may go now, with the gate’s reason. A refusal that fits no stop here is a fault in the tool: ask the desk (monitoring_finding ask, to: desk).',
    };
}

/** docs/CAPABILITIES.md: the same answer, for people and for anyone reading the repository. */
export function capabilitiesMarkdown(): string {
    const c = capabilities();
    const esc = (s: string) => s.replace(/\|/g, '\\|');
    const L: string[] = [];
    L.push('# できること・止める理由（コードから生成）');
    L.push('');
    L.push('<!-- 生成物。手で直さない。`npm run gen:capabilities`（src/lib/bridge/capabilities.ts）。capabilities.test.ts が、コードと違えば落ちる。 -->');
    L.push('');
    L.push('この文書は、このビルドのコード（道具の一覧 `src/lib/bridge/tools.ts`、運営者の表 `policy.ts` の `OWNER_DECISION`、');
    L.push('止める理由の閉じた一覧 `stopReasons.ts`＝`docs/NO-STOP.md` §2）から作る。AI は同じ中身を `monitoring_capabilities` で読む。');
    L.push('**README・ほかの docs・Skill・記憶と食い違ったら、こちら（とタブの答え）が正しい。** ここかタブの断りが言わない限り「できない」と言わない。');
    L.push('タブは同じ答えを hello に載せ、中継が持つので、タブが寝ていても `monitoring_capabilities` は答える。タブの答えには、ここに無い');
    L.push('モジュールごとの表（`modules`：どれを読み、アドレスで何が決め、故障を何で読むか）が足される。ecu-data から作るので、この文書には載せない。');
    L.push('');
    L.push('## 運営者の表（項目の性質ごと）');
    L.push('');
    L.push('| 性質 | いつ | どこまで | 誰が | AI は | 道具 |');
    L.push('|---|---|---|---|---|---|');
    const when = (w: string) => (w === 'moving' ? '走行中も' : '停車中だけ');
    const how = (h: string) => (h === 'run' ? '実行' : h === 'show' ? '表示だけ' : '出さない');
    const who = (w: string) => (w === 'ai' ? 'AI も' : '画面の人');
    for (const o of c.owner) {
        const ai = assistantLineJa(o.nature);
        L.push(`| ${esc(o.ja)} | ${when(o.when)} | ${how(o.how)} | ${who(o.who)} | ${ai} | ${o.tools.map((t) => `\`${t}\``).join('、') || '—'} |`);
    }
    L.push('');
    L.push('## 全部に掛かる決まり');
    L.push('');
    for (const r of RULES) L.push(`- ${r.ja}`);
    L.push('');
    L.push('## 止めてよい理由（閉じた一覧）');
    L.push('');
    L.push('| # | 理由 | 次の手 | どこ |');
    L.push('|---|---|---|---|');
    for (const s of c.stops) L.push(`| ${s.id} | ${esc(s.ja)} | ${esc(s.nextJa)} | ${esc(s.where)} |`);
    L.push('');
    L.push('門と回線の断りが、どの理由に当たるか：');
    L.push('');
    for (const [k, v] of Object.entries(c.refusals)) L.push(`- \`${k}\` → ${v}`);
    L.push('');
    L.push('## 画面の人だけがすること');
    L.push('');
    for (const x of SCREEN_ONLY) L.push(`- ${x.ja}`);
    L.push('');
    L.push('## AI の道具');
    L.push('');
    L.push('| 道具 | 種類 | 何をするか |');
    L.push('|---|---|---|');
    for (const t of c.tools) L.push(`| \`${t.name}\` | ${t.scope} | ${esc(t.what)} |`);
    L.push('');
    return L.join('\n');
}
