/**
 * The reasons a send may be stopped, as a closed list (docs/NO-STOP.md §2, owner 2026-11-26), and
 * which of them each refusal of the gate and of the link is.
 *
 * The list is the one place a reader — the screen, the owner's assistant, the shop's SUITE — learns
 * why something did not go and what makes it go. `RUN_BLOCK_STOP` and `NOT_SENT_STOP` are total
 * records over the refusal types, so a new refusal that is none of these fails to compile: adding a
 * stop means adding a row here first, and the owner decides it (NO-STOP §1.2).
 *
 * "Not confirmed on a car" is not a row and never will be (NO-STOP §1.1).
 */
import type { NotSentReason } from './link/notSent.ts';
import type { RunBlockKey } from './runGate.ts';

export type StopId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7';

export interface StopReason {
    id: StopId;
    ja: string;
    en: string;
    /** Who does what so it goes (NO-STOP §1.5: a stop always comes with its next step). */
    nextJa: string;
    nextEn: string;
    /** Where in the code it is decided. */
    where: string;
}

export const STOP_REASONS: Readonly<Record<StopId, StopReason>> = {
    S1: {
        id: 'S1',
        ja: '停車が要るものを、送る直前に測った車速が 0 でないとき・測れないとき',
        en: 'It runs parked only, and the speed measured just before sending was not 0 or could not be read',
        nextJa: '止まってから、もう一度頼む。測れないときは接続を確かめる。',
        nextEn: 'Ask again once the car has stopped; if the speed could not be read, check the connection.',
        where: 'link/session.ts preflightRun, vehicleState.ts',
    },
    S2: {
        id: 'S2',
        ja: '電圧が 12 V 未満、または SGBD が言うエンジンの状態と違うとき',
        en: 'The battery is under 12 V, or the engine is not as the job’s own SGBD asks',
        nextJa: 'エンジンを掛ける・充電器をつなぐ、またはエンジンを SGBD の言う状態にしてから、もう一度頼む。',
        nextEn: 'Start the engine or put a charger on, or set the engine as its SGBD asks, then ask again.',
        where: 'link/session.ts preflightRun',
    },
    S3: {
        id: 'S3',
        ja: '部品を動かす・消すものを、読み返して「いいよ」を聞く前',
        en: 'Something that moves a part or clears is asked for before it was read back and the owner said yes',
        nextJa: '何が動く（消える）か・条件を読み返し、オーナーの言葉を owner_said に添えて呼ぶ。',
        nextEn: 'Read back what will move (or be cleared) and its conditions, then call with the owner’s words as owner_said.',
        where: 'src/lib/actuation.ts assistantMayStart, the screen’s confirmation',
    },
    S4: {
        id: 'S4',
        ja: '電文を、そのモジュール自身の SGBD のコードが組めず、EdiabasLib とも一致しないとき',
        en: 'The module’s own SGBD code cannot build the frame, or EdiabasLib does not build the same one',
        nextJa: '値を取るジョブなら、答えに並ぶ値の組から一つ選んで渡す。組が無ければ道具の穴なので、開発に頼む（monitoring_finding の ask、to: desk）。',
        nextEn: 'For a job that takes values, pass one of the sets the answer lists. With no set, it is a gap in the tool: ask the desk (monitoring_finding ask, to: desk).',
        where: 'sgbd/agreedFrame.ts, runGate.ts telegramIsCertain',
    },
    S5: {
        id: 'S5',
        ja: 'そのアドレスにいるのが別のモジュールだと IDENT（またはオーナーの言葉）が言ったとき',
        en: 'The IDENT at that address (or the owner’s words) says another module is fitted there',
        nextJa: '付いている方のモジュールを画面に出す（monitoring_module）。IDENT で分からないアドレスは、オーナーに訊いて monitoring_variant で残す。',
        nextEn: 'Put the module that is fitted on the screen (monitoring_module). Where the IDENT cannot tell, ask the owner and record it with monitoring_variant.',
        where: 'variants.ts, Ds2Link.setSendGuard, src/lib/variantChoice.ts',
    },
    S6: {
        id: 'S6',
        ja: '運営者の表で「出さない」「表示だけ」（安全装置の展開・書き込みほか）、またはキルリストで取り下げたとき',
        en: 'The owner’s table says off or show only (safety deployment, writes and the like), or the item was withdrawn',
        nextJa: '変えられるのは運営者だけ。開けたいなら、オーナーの言葉のまま開発に頼む。',
        nextEn: 'Only the owner changes it. If they want it open, pass their words to the desk.',
        where: 'policy.ts OWNER_DECISION, ledger.ts withdrawn',
    },
    S7: {
        id: 'S7',
        ja: '一つ動いている間の二つ目',
        en: 'Something is already on: one at a time',
        nextJa: '今動いているものを止めてから（monitoring_stop_outputs）、次を頼む。',
        nextEn: 'Stop what is on first (monitoring_stop_outputs), then ask for the next.',
        where: 'src/hooks/useActuatorArming.ts',
    },
};

/**
 * Each refusal of the gate, as the stop it is. `route` is not a stop on the car: the item is not of
 * the kind the tool asked takes (a datalog channel that is not a read); another tool runs it.
 */
export const RUN_BLOCK_STOP: Readonly<Record<RunBlockKey, StopId | 'route'>> = {
    run_block_programming: 'S6',
    run_block_identity: 'S6',
    run_block_noTelegram: 'S4',
    run_block_needsArgs: 'S4',
    run_block_notRead: 'route',
    run_block_controlWrites: 'S4',
    run_block_revoked: 'S6',
    run_block_moving: 'S1',
    run_block_policyShow: 'S6',
    run_block_policyOff: 'S6',
};

/** Each refusal of the link just before sending, as the stop it is. */
export const NOT_SENT_STOP: Readonly<Record<NotSentReason, StopId>> = {
    link: 'S1',
    moving: 'S1',
    voltage: 'S2',
    engine: 'S2',
    permission: 'S4',
};

export const STOP_IDS: readonly StopId[] = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'];
