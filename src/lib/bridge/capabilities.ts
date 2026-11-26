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
    NATURES,
    isReadNature,
    OWNER_DECISION,
    OWNER_RULES,
    MIN_RUN_VOLTAGE,
    DEFAULT_RUN_TIMEOUT_S,
    RUN_BLOCK_STOP,
    NOT_SENT_STOP,
    STOP_IDS,
    STOP_REASONS,
    DME_ADDRESS,
    M3_DME_SGBD,
    loadEcuIndex,
    loadFaultLayouts,
    loadVariantRules,
    mayModuleBeSent,
    ruleFor,
    type EcuIndex,
    type FaultLayouts,
    type Fitment,
    type Nature,
    type VariantRules,
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

/** The rules over every decision (policy.ts OWNER_RULES and the numbers it names), in both languages. */
const RULES: ReadonlyArray<{ ja: string; en: string }> = [
    {
        ja: `送る直前に測る：DME の車速 0（停車）、電圧 ${MIN_RUN_VOLTAGE} V 以上、ジョブ自身の SGBD が言うエンジンの状態。測れなければ送らない。`,
        en: `Measured just before a send that needs it: the DME's speed 0 (stationary), the battery ${MIN_RUN_VOLTAGE} V or more, the engine as the job's own SGBD asks. Unmeasured is not sent.`,
    },
    { ja: 'ジョブ自身の SGBD が停車を求めるものは、表が何と言っても停車中だけ。', en: 'A job its own SGBD asks to run stationary goes parked, whatever the table says.' },
    {
        ja: '部品を動かす・消すものは、何が起きるかを読み返し、オーナーの「いいよ」を待ち、その言葉を owner_said に添える。',
        en: 'Before anything that moves a part or clears: read back what will happen, wait for the owner’s yes, pass their words as owner_said.',
    },
    {
        ja: `一度に一つ。どれも時間切れ（SGBD の上限、無ければ ${DEFAULT_RUN_TIMEOUT_S} 秒）で止まる。止めるのは誰でもいつでも（monitoring_stop_outputs）、走行中も。`,
        en: `One output on at a time; each stops by itself after its time-out (the SGBD's, else ${DEFAULT_RUN_TIMEOUT_S} s). Anyone may stop any time (monitoring_stop_outputs), moving or not.`,
    },
    OWNER_RULES.practiceFirst === 'build'
        ? {
              ja: '練習はビルドが全項目を模擬実車で済ませる（src/lib/practiceEveryItem.test.ts）。端末で先に練習することは求めない。',
              en: 'Practice is done by the build for every item (src/lib/practiceEveryItem.test.ts): nothing is asked to be practised on the device first.',
          }
        : { ja: 'この端末で先に練習する。', en: 'Practice first on this device.' },
    {
        ja: '走行中に AI が始められるのは読取だけ。走行中も送る読取は、運営者の表とオーナーが台帳で認めたもの。',
        en: 'While the car moves the assistant starts reads only; reads the owner’s table or the owner’s ledger clears for a moving car go moving.',
    },
    {
        ja: '「実車未確認」「推定」「未検証」は答えに言い添える言葉で、止める理由ではない（docs/NO-STOP.md §1）。',
        en: '“Not confirmed on a car”, “estimated” and “not verified” are said alongside an answer, never a reason to stop (docs/NO-STOP.md §1).',
    },
    { ja: '実行と結果は台帳と CO-WORK に残る。', en: 'Every run and its result go to the ledger and CO-WORK.' },
];

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

/** One module, as the assistant needs it to say what can be read there (ASSISTANT-LAYERS.md 5.3). */
export interface ModuleCapability {
    id: string;
    name: string;
    address: string;
    /** Which cars have it (index.json `fit`: std, late, smg, nonm3, …). */
    fit: string;
    /** How the app knows it is the one at its address: `ident` (the address's IDENT, by the group file's
     *  rule), `m3` (fitted on an M3 by the module list, sent once 0x12 answered MSS54), `owner` (several
     *  of this app's modules share the address and no rule tells them apart: the owner says which, with
     *  monitoring_variant, before anything that drives goes there), `ident-only` (its rule is not
     *  available: only the common IDENT is sent). */
    chosenBy: 'ident' | 'm3' | 'owner' | 'ident-only';
    /** How its fault memory is read: `decoder` (MSS54's own decoder), `layout` (where its own SGBD's
     *  FS_LESEN reads, fault-layouts.json), `own` (its own SGBD's FS_LESEN job where it has one, else the
     *  answer's bytes kept as the answer). Read in every case; none of them is "cannot read". */
    faults: 'decoder' | 'layout' | 'own';
}

const MODULE_RULES = [
    'Every module listed is read: its IDENT, and its fault memory — moving or parked (owner’s table). `faults` says by what; bytes kept as the answer are still an answer, never "cannot read".',
    'Which module is at an address: `chosenBy`. For `owner`, ask the owner once per car and record it with monitoring_variant; reads go on meanwhile. On a car that is not an M3, `m3` modules get only the common IDENT.',
    'What one module offers now (its jobs, whether each may go, the gate’s reason): monitoring_catalog with its id.',
];

/** An M3 as the variant rules see it: 0x12 answered MSS54, nothing else identified yet. */
const M3_FITMENT: Fitment = new Map([[DME_ADDRESS, { address: DME_ADDRESS, answer: '', sgbd: M3_DME_SGBD, moduleId: 'mss54' }]]);

/** Modules of cars that are not an M3: at an address with no rule, nothing but the common IDENT goes. */
const NOT_M3 = new Set(['nonm3', 'unknown']);

/** The modules part, from the catalogue's index, the variant rules and the fault layouts. Pure. */
export function moduleRoster(index: EcuIndex, rules: VariantRules, layouts: FaultLayouts): ModuleCapability[] {
    const at = new Map<number, number>();
    for (const m of index.modules) at.set(m.address, (at.get(m.address) ?? 0) + 1);
    return index.modules.map((m) => {
        const chosenBy: ModuleCapability['chosenBy'] = ruleFor(rules, m.address)
            ? 'ident'
            : NOT_M3.has(m.fit) || !mayModuleBeSent(m.address, m.id, M3_FITMENT, rules).ok
              ? 'ident-only'
              : (at.get(m.address) ?? 0) > 1
                ? 'owner'
                : 'm3';
        const faults: ModuleCapability['faults'] = m.id === 'mss54' ? 'decoder' : layouts.modules[m.id] ? 'layout' : 'own';
        return { id: m.id, name: m.name_en, address: m.addressHex, fit: m.fit, chosenBy, faults };
    });
}

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

/** Whether the assistant may start a nature, said plainly. */
function assistantLine(n: Nature): string {
    const d = OWNER_DECISION[n];
    if (d.how === 'off') return 'no: off in the owner’s table (nobody sends it)';
    if (d.how === 'show') return 'no: shown on the screen only';
    if (d.who === 'screen') return 'no: a person on the screen starts it';
    const tools = NATURE_TOOLS[n].join(', ');
    if (d.when === 'moving') return `yes, moving or parked (${tools})`;
    return isReadNature(n) ? `yes, parked (${tools})` : `yes, parked, after reading back and the owner’s yes (${tools})`;
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
        owner: NATURES.map(({ nature, ja, en }) => {
            const d = OWNER_DECISION[nature];
            return { nature, ja, en, when: d.when, how: d.how, who: d.who, assistant: assistantLine(nature), tools: NATURE_TOOLS[nature] };
        }),
        rules: RULES.map((r) => r.en),
        stops: STOP_IDS.map((id) => {
            const s = STOP_REASONS[id];
            return { id, ja: s.ja, en: s.en, next: s.nextEn, nextJa: s.nextJa, where: s.where };
        }),
        refusals: {
            ...Object.fromEntries(Object.entries(RUN_BLOCK_STOP).map(([k, v]) => [k, v === 'route' ? 'not a stop: another tool runs it (the answer names which)' : v])),
            ...Object.fromEntries(Object.entries(NOT_SENT_STOP).map(([k, v]) => [`notSent:${k}`, v])),
        },
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
        const ai = o.how === 'off' ? 'できない（出さない）' : o.how === 'show' ? 'できない（表示だけ）' : o.who !== 'ai' ? 'できない（画面の人）' : o.when === 'moving' ? 'できる（走行中も）' : isReadNature(o.nature) ? 'できる（停車中）' : 'できる（停車中、読み返して「いいよ」のあと）';
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
