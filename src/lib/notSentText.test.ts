import { describe, expect, it } from 'vitest';
import { NO_RULES, mayModuleBeSent, type Fitment } from '@tsunagi/monitoring-engine';
import { variantRefusalLine } from './notSentText';
import { ja } from './i18n/ja';

/**
 * The screen's line for a module the link would not send to (SC10 step 3): built from the engine's own
 * refusal, so the words follow what the link said rather than a copy of it.
 */
describe('variantRefusalLine', () => {
    const noRules = NO_RULES;
    const nonM3: Fitment = new Map([[0x12, { address: 0x12, answer: '12 0f a0', sgbd: 'MS430DS0', moduleId: 'ms430ds0' }]]) as unknown as Fitment;

    it('says only the IDENT goes where the module is not known on a car that is not an M3', () => {
        const v = mayModuleBeSent(0x00, 'zke5', nonM3, noRules);
        expect(v.ok).toBe(false);
        const message = `Fault read: silent — zke5: not sent — ${v.ok ? '' : v.reason}`;
        expect(variantRefusalLine(message, ja)).toBe(ja.variant_identOnly('0x00'));
    });

    it('names the module the IDENT chose', () => {
        expect(variantRefusalLine("smg2: not sent — 0x32 is GS20, not smg2: smg2's frames are not sent to it", ja)).toBe(ja.variant_otherHere('0x32', 'GS20'));
        expect(variantRefusalLine('x: not sent — 0x12 is MS420DS0, whose SGBD this app does not carry yet: only its IDENT is sent', ja)).toBe(ja.variant_notCarried('0x12', 'MS420DS0'));
    });

    it('leaves any other error alone', () => {
        expect(variantRefusalLine('Fault read: no answer', ja)).toBeNull();
    });
});
