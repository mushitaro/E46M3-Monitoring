/**
 * The sentences of a caution that tell the person to do or not do something — 「実行中はブレーキペダルに
 * 触れないでください」, 「エンジンを止めてから」, 「ステアリングを直進にしてから」 — lifted out so a
 * confirmation can say them in its visible body, beside the preconditions (docs/UX-DESIGN.md §5,
 * `tsunagi-m-design` §0 principle 5: safety text in the reader's language, where it is read). The rest of
 * the caution — what the job is, what the SGBD says about itself, the arguments and the job names —
 * stays under 詳細, whole.
 *
 * The cautions are hand-written, one language each (tools/jobtext), with no mark on which sentence is an
 * instruction. What they do carry is grammar, and that is what this reads: a Japanese clause that ends
 * as an instruction does (〜ください, 〜こと, 〜てから, 〜状態で), an English one that opens as one does
 * (an imperative, or the terse precondition the authors use: "Level ground, wheels straight, car still").
 * A clause that names an argument or an identifier (EIN=0, AUS, ORT1='STOP') is the job's mechanics, not
 * the person's: it stays in the details. Checked against every caution the catalogues ship (2026-11-21):
 * the two languages lift the same number of instructions from all but one of 163, and that one lifts
 * a sentence in Japanese that English says in two clauses. Nothing is written here; nothing is
 * translated; a sentence is either shown as its author wrote it, or left where it was.
 */

type Lang = 'ja' | 'en';

/** Upper-case words that are names a person reads (DSC, TIS), not an argument's value (AUS, EIN). */
const KEPT_CAPS = new Set([
    'SGBD', 'DSC', 'ABS', 'ASC', 'TIS', 'LED', 'ECU', 'DME', 'SMG', 'NTSC', 'PAL', 'LIN', 'EWS', 'CAN', 'VIN',
    'IHKA', 'SZT', 'ZKE', 'LWS', 'AIC', 'RDC', 'PDC', 'CVM', 'EEPROM', 'NVRAM', 'DDE', 'ALC', 'SMC', 'KOMBI',
    'SIA', 'LCD', 'GPS', 'NCS', 'INPA', 'BMW', 'USB', 'DSP', 'MOST', 'IBUS', 'KBUS', 'EGS', 'SRS', 'MRS', 'LSZ', 'LRW',
]);

/** A clause about the job's mechanics: an identifier, an argument and its value, a quoted value. */
function mechanics(clause: string): boolean {
    if (/[A-Z][A-Z0-9]*_[A-Z0-9_]*|[A-Za-z0-9_]+\s*=\s*['A-Za-z0-9]|`|''|\bargument\b|引数/.test(clause)) return true;
    for (const m of clause.matchAll(/(?<![A-Za-z])[A-Z]{3,}(?![a-z])/g)) if (!KEPT_CAPS.has(m[0])) return true;
    return false;
}

/** 「SGBD の前提: エンジンが回っていること」 → the instruction; whose it is, is the details'. */
function withoutSource(clause: string, lang: Lang): string {
    return lang === 'ja' ? clause.replace(/^SGBD[^:：]{0,6}[:：]\s*/, '') : clause.replace(/^the sgbd(?:'s precondition| says)?:\s*/i, '');
}

const JA_INSTRUCTION = /(ください|こと|しないで|厳禁|禁止|後に|てから|状態で|でだけ)$/;

const EN_INSTRUCTION = new RegExp(
    '^(' +
        [
            "do not", "don't", 'do this', 'do it', 'never', 'always', 'keep', 'make sure', 'ensure', 'check', 'confirm',
            'stop the', 'switch off', 'turn off', 'note', 'read and', 'read it', 'read out', 'record', 'leave', 'chock',
            'park', 'wait', 'remove', 'hold', 'take', 'apply', 'avoid', 'be sure', 'back up', 'write down', 'clean',
            'cycle', 'disconnect', 'follow', 'only (?:do|run|on|parked|when|if|after|with|use|clear|perform)',
            'nobody', 'nothing (?:and|or|near|under)', 'no one', 'level ground',
            'car (?:stationary|stopped|still|completely|parked)', 'engine (?:off|running|on|stopped)', 'neutral',
            'wheels straight', 'good battery', 'hands', 'the engine must',
        ].join('|') +
        ')\\b',
    'i',
);

/** The instructions in a caution, in its own words and order; empty when it gives none. */
export function instructionsIn(text: string | null | undefined, lang: Lang): string[] {
    if (!text) return [];
    const plain = text.replaceAll('**', '');
    const out: string[] = [];
    if (lang === 'ja') {
        for (const sentence of plain.split(/(?<=。)/)) {
            for (const part of sentence.split('——')) {
                const clause = withoutSource(part.trim().replace(/。$/, '').trim(), 'ja');
                if (clause && JA_INSTRUCTION.test(clause) && !mechanics(clause)) out.push(`${clause}。`);
            }
        }
        return out;
    }
    for (const sentence of plain.split(/(?<=[.!?])\s+/)) {
        for (const part of sentence.split(/\s+[—–-]\s+|;\s+|,\s+so\s+|,\s+(?=(?:record|read|keep|do not|check|stop)\b)/)) {
            const clause = withoutSource(part.trim().replace(/\.$/, '').trim().replace(/^(?:and|but|so|then)\s+/, ''), 'en');
            if (!clause || mechanics(clause)) continue;
            if (EN_INSTRUCTION.test(clause) || /\bfirst$/.test(clause)) out.push(`${clause[0].toUpperCase()}${clause.slice(1)}.`);
        }
    }
    return out;
}
