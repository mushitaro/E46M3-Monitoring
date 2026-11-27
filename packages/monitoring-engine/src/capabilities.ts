/**
 * The parts of a "what can the assistant do here, and why did it stop" answer that come from the
 * engine — so every app that carries the engine answers from the same code (GREN BLUE's ask 2-1 and
 * 2-2, 2026-11-27: SUITE builds `maintenance_capabilities` from these; it cannot read our `src/`).
 *
 *   - moduleRoster: every module of the catalogue, how the one at its address is told apart and how
 *     its fault memory is read;
 *   - ownerRules / assistantMay / ownerTable: the owner's table (policy.ts) said as rules and, nature
 *     by nature, whether the assistant may start it;
 *   - stopList / refusalKinds: the closed list of stops (stopReasons.ts, docs/NO-STOP.md §2) and which
 *     stop each refusal of the gate and of the link is;
 *   - refusal: the one shape of every "not started" ({started: false, reason, stop, next}).
 *
 * No tool names of any one app live here: the app passes its own (the stop tool, the argument that
 * carries the person's words, the tools that reach each nature), so WORKS says monitoring_* and SUITE
 * says maintenance_*. The words are the policy's and the stops' own, in English and Japanese, as
 * stopReasons.ts already has them; each screen and each assistant answer picks one.
 */
import type { EcuIndex } from './ecuCatalog.ts';
import type { FaultLayouts } from './faultLayouts.ts';
import { DEFAULT_RUN_TIMEOUT_S, MIN_RUN_VOLTAGE, NATURES, OWNER_DECISION, OWNER_RULES, isReadNature, type Decision, type Nature } from './policy.ts';
import { NOT_SENT_STOP, RUN_BLOCK_STOP, STOP_IDS, STOP_REASONS, type StopId } from './stopReasons.ts';
import { DME_ADDRESS, M3_DME_SGBD, mayModuleBeSent, ruleFor, type Fitment, type VariantRules } from './variants.ts';

// ── modules ──────────────────────────────────────────────────────────────────────────────────────

/** One module, as an assistant needs it to say what can be read there. */
export interface ModuleCapability {
    id: string;
    name: string;
    address: string;
    /** Which cars have it (index.json `fit`: std, late, smg, nonm3, …). */
    fit: string;
    /**
     * How the app knows it is the one at its address:
     *   - `ident`: the address's IDENT, by the group file's rule;
     *   - `profile-default`: no rule, and the car's profile fits it by default — today, a car whose
     *     0x12 answered MSS54 (an E46 M3) takes the module list's M3 equipment. On any other car such a
     *     module gets only the common IDENT. (Named for the profile, not the M3, so the vehicle-profile
     *     layer of docs/ENGINE.md can take it over without a change for the apps that read it.)
     *   - `owner`: several modules share the address and no rule tells them apart: the owner says which
     *     (WORKS: monitoring_variant) before anything that drives goes there;
     *   - `ident-only`: its rule is not available: only the common IDENT is sent.
     */
    chosenBy: 'ident' | 'profile-default' | 'owner' | 'ident-only';
    /** How its fault memory is read: `decoder` (MSS54's own decoder), `layout` (where its own SGBD's
     *  FS_LESEN reads, fault-layouts.json), `own` (its own SGBD's FS_LESEN job where it has one, else the
     *  answer's bytes kept as the answer). Read in every case; none of them is "cannot read". */
    faults: 'decoder' | 'layout' | 'own';
}

/** The car the default fitment is the one of: 0x12 answered MSS54, nothing else identified yet. */
const DEFAULT_PROFILE_FITMENT: Fitment = new Map([[DME_ADDRESS, { address: DME_ADDRESS, answer: '', sgbd: M3_DME_SGBD, moduleId: 'mss54' }]]);

/** Modules of cars outside the default fitment: at an address with no rule, nothing but the common IDENT goes. */
const OUTSIDE_DEFAULT = new Set(['nonm3', 'unknown']);

/** The modules part, from the catalogue's index, the variant rules and the fault layouts. Pure. */
export function moduleRoster(index: EcuIndex, rules: VariantRules, layouts: FaultLayouts): ModuleCapability[] {
    const at = new Map<number, number>();
    for (const m of index.modules) at.set(m.address, (at.get(m.address) ?? 0) + 1);
    return index.modules.map((m) => {
        const chosenBy: ModuleCapability['chosenBy'] = ruleFor(rules, m.address)
            ? 'ident'
            : OUTSIDE_DEFAULT.has(m.fit) || !mayModuleBeSent(m.address, m.id, DEFAULT_PROFILE_FITMENT, rules).ok
              ? 'ident-only'
              : (at.get(m.address) ?? 0) > 1
                ? 'owner'
                : 'profile-default';
        const faults: ModuleCapability['faults'] = m.id === 'mss54' ? 'decoder' : layouts.modules[m.id] ? 'layout' : 'own';
        return { id: m.id, name: m.name_en, address: m.addressHex, fit: m.fit, chosenBy, faults };
    });
}

// ── the owner's table ────────────────────────────────────────────────────────────────────────────

export interface Said {
    ja: string;
    en: string;
}

/** The app's own names the rules speak of. */
export interface RuleNames {
    /** The tool anyone uses to stop what is on (WORKS: monitoring_stop_outputs). */
    stopTool: string;
    /** The argument that carries the person's words (WORKS: owner_said). */
    wordsArg: string;
}

/** The rules over every decision (policy.ts OWNER_RULES and the numbers it names). */
export function ownerRules(names: RuleNames): Said[] {
    return [
        {
            ja: `送る直前に測る：DME の車速 0（停車）、電圧 ${MIN_RUN_VOLTAGE} V 以上、ジョブ自身の SGBD が言うエンジンの状態。測れなければ送らない。`,
            en: `Measured just before a send that needs it: the DME's speed 0 (stationary), the battery ${MIN_RUN_VOLTAGE} V or more, the engine as the job's own SGBD asks. Unmeasured is not sent.`,
        },
        { ja: 'ジョブ自身の SGBD が停車を求めるものは、表が何と言っても停車中だけ。', en: 'A job its own SGBD asks to run stationary goes parked, whatever the table says.' },
        {
            ja: `部品を動かす・消すものは、何が起きるかを読み返し、オーナーの「いいよ」を待ち、その言葉を ${names.wordsArg} に添える。`,
            en: `Before anything that moves a part or clears: read back what will happen, wait for the owner’s yes, pass their words as ${names.wordsArg}.`,
        },
        {
            ja: `一度に一つ。どれも時間切れ（SGBD の上限、無ければ ${DEFAULT_RUN_TIMEOUT_S} 秒）で止まる。止めるのは誰でもいつでも（${names.stopTool}）、走行中も。`,
            en: `One output on at a time; each stops by itself after its time-out (the SGBD's, else ${DEFAULT_RUN_TIMEOUT_S} s). Anyone may stop any time (${names.stopTool}), moving or not.`,
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
}

/** Whether the assistant may start a nature, by the owner's table alone. */
export type AssistantMay =
    | { may: false; why: 'off' | 'show' | 'screen' }
    | { may: true; when: 'moving' | 'parked'; readBack: boolean };

export function assistantMay(n: Nature): AssistantMay {
    const d = OWNER_DECISION[n];
    if (d.how === 'off') return { may: false, why: 'off' };
    if (d.how === 'show') return { may: false, why: 'show' };
    if (d.who === 'screen') return { may: false, why: 'screen' };
    if (d.when === 'moving') return { may: true, when: 'moving', readBack: false };
    return { may: true, when: 'parked', readBack: !isReadNature(n) };
}

/** Said plainly, with the app's tools that reach the nature. */
export function assistantLine(n: Nature, tools: readonly string[]): string {
    const a = assistantMay(n);
    if (!a.may) return a.why === 'off' ? 'no: off in the owner’s table (nobody sends it)' : a.why === 'show' ? 'no: shown on the screen only' : 'no: a person on the screen starts it';
    const t = tools.join(', ');
    if (a.when === 'moving') return `yes, moving or parked (${t})`;
    return a.readBack ? `yes, parked, after reading back and the owner’s yes (${t})` : `yes, parked (${t})`;
}

/** The same, in Japanese, as the table's column says it. */
export function assistantLineJa(n: Nature): string {
    const a = assistantMay(n);
    if (!a.may) return a.why === 'off' ? 'できない（出さない）' : a.why === 'show' ? 'できない（表示だけ）' : 'できない（画面の人）';
    if (a.when === 'moving') return 'できる（走行中も）';
    return a.readBack ? 'できる（停車中、読み返して「いいよ」のあと）' : 'できる（停車中）';
}

export interface OwnerRow extends Decision {
    nature: Nature;
    ja: string;
    en: string;
    assistant: string;
    tools: readonly string[];
}

/** The owner's table, nature by nature, with what reaches each in the app (`toolsFor`). */
export function ownerTable(toolsFor: (n: Nature) => readonly string[]): OwnerRow[] {
    return NATURES.map(({ nature, ja, en }) => {
        const d = OWNER_DECISION[nature];
        const tools = toolsFor(nature);
        return { nature, ja, en, when: d.when, how: d.how, who: d.who, assistant: assistantLine(nature, tools), tools };
    });
}

// ── stops ────────────────────────────────────────────────────────────────────────────────────────

export interface StopRow {
    id: StopId;
    ja: string;
    en: string;
    next: string;
    nextJa: string;
    where: string;
}

/** The closed list of stops, in order. */
export function stopList(): StopRow[] {
    return STOP_IDS.map((id) => {
        const s = STOP_REASONS[id];
        return { id, ja: s.ja, en: s.en, next: s.nextEn, nextJa: s.nextJa, where: s.where };
    });
}

/** Which stop each refusal of the gate (`run_block_*`) and of the link (`notSent:*`) is, and the two kinds that are not a stop. */
export function refusalKinds(): Record<string, string> {
    return {
        ...Object.fromEntries(Object.entries(RUN_BLOCK_STOP).map(([k, v]) => [k, v === 'route' ? 'not a stop: another tool runs it (the answer names which)' : v])),
        ...Object.fromEntries(Object.entries(NOT_SENT_STOP).map(([k, v]) => [`notSent:${k}`, v])),
        route: 'not a stop: another tool or another way runs it; `next` names it',
        state: 'not a stop on the car: the tab’s own state (the line lost, the link not connected, a job on, a run going); `next` says what passes it',
    };
}

// ── one shape for "not started" ─────────────────────────────────────────────────────────────────

/**
 * Every "not started" an assistant's tool answers is one shape: the sentence to say, which stop of the
 * closed list it is, and the next step that makes it go.
 *
 *   - `S1`…`S7`: a stop of the closed list. `next` defaults to that stop's own next step.
 *   - `route`: not a stop: another tool or another way runs it (the sentence names which).
 *   - `state`: not a stop on the car: the app's own state (the line is lost, a job is on, a run is
 *     going). It passes by itself or by one step, which `next` says.
 */
export type RefusalKind = StopId | 'route' | 'state';

export interface Refusal {
    started: false;
    /** The sentence for the assistant to say. */
    reason: string;
    stop: RefusalKind;
    /** Who does what so it goes. */
    next: string;
}

export function refusal(stop: StopId, sentence: string, next?: string): Refusal;
export function refusal(stop: 'route' | 'state', sentence: string, next: string): Refusal;
export function refusal(stop: RefusalKind, sentence: string, next?: string): Refusal {
    const n = next ?? (stop === 'route' || stop === 'state' ? '' : STOP_REASONS[stop].nextEn);
    return { started: false, reason: sentence, stop, next: n || sentence };
}
