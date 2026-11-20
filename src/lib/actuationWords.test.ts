import { describe, expect, it } from 'vitest';
import type { CatalogJob, NotSent } from '@tsunagi/monitoring-engine';
import { assistantMayStart, notAnOk, tableRefusal } from './actuation';
import { notSentLine, notSentSentence, type NotSentWords } from './notSentText';
import { partName } from './partName';
import { carKey, choiceFor, variantRefusal, variantState, withChoice } from './variantChoice';
import type { Smg2Workflows } from './smg2Workflows';

const job = (id: string, cls: CatalogJob['class'] = 'test'): CatalogJob => ({ id, class: cls, args: [], op: {} }) as unknown as CatalogJob;

describe("the owner's words: only a clear yes starts anything (IJ07)", () => {
    it('takes a clear yes, with or without hesitation before it', () => {
        for (const w of ['いいよ', 'はい', 'お願い', '一回だけ動かして。いいよ', 'うーん、いいよ', 'OK', 'yes, go ahead']) expect(notAnOk(w)).toBeNull();
    });
    it('refuses words that only hesitate, and says to ask again', () => {
        for (const w of ['うーん、どうしようかな', 'まあいいか', '動かしていいかな', 'たぶん', 'hmm, maybe']) {
            const r = notAnOk(w);
            expect(r).not.toBeNull();
            expect(r).toMatch(/Ask again|not an OK/);
        }
    });
    it('refuses a no or a wait, and empty words', () => {
        for (const w of ['ううん', 'いや、待って', 'やめて', '', '  ']) expect(notAnOk(w)).not.toBeNull();
    });
    it('is part of what the assistant may start', () => {
        expect(assistantMayStart('radio', job('STEUERN_SEEK_UP'), 'comm', 'parked', 'まあいいか').ok).toBe(false);
        expect(assistantMayStart('radio', job('STEUERN_SEEK_UP'), 'comm', 'parked', 'いいよ').ok).toBe(true);
    });
});

describe("the owner's table, said by what the job is (IJ F08, MM02 F26)", () => {
    it('refuses a write as a write and a safety deployment as one, before any value', () => {
        expect(tableRefusal('mss54', job('PRUEFSTEMPEL_SCHREIBEN', 'programming'), 'engine')?.reason).toMatch(/writes.*keeps it off/);
        expect(tableRefusal('ueb2', job('STEUERN_BUEGEL'), 'safety')?.reason ?? '').toMatch(/not run from here/);
    });
    it('lets the assistant on where the table opens the job to it', () => {
        expect(tableRefusal('radio', job('STEUERN_SEEK_UP'), 'comm')).toBeNull();
    });
});

describe('a refusal at the wire, with what was measured (IJ02, IJ03)', () => {
    const words: NotSentWords = {
        notSent_moving: (k) => `走行中（${k} km/h）`,
        notSent_voltage: (v, m) => `電圧 ${v} V。${m} V 以上で動かせます`,
        notSent_voltageUnread: (m) => `${m} V`,
        notSent_engineOff: (r) => `エンジンを止めて ${r}`,
        notSent_engineOn: (r) => `エンジンをかけて ${r}`,
        notSent_link: 'link',
        notSent_permission: 'permit',
    };
    const ns = (reason: NotSent['reason'], measured: NotSent['measured']): NotSent => ({ reason, what: 'X', measured, message: 'X: not sent.' });
    it('says the volts and the minimum, on the screen and to the assistant', () => {
        const v = ns('voltage', { voltageV: 11.9, minVoltageV: 12 });
        expect(notSentLine(v, words)).toBe('電圧 11.9 V。12 V 以上で動かせます');
        expect(notSentSentence(v)).toMatch(/11\.9 V.*12 V/);
    });
    it('says moving with its speed, and the engine as its SGBD asks', () => {
        expect(notSentSentence(ns('moving', { speedKmh: 30 }))).toMatch(/moving \(30 km\/h/);
        expect(notSentLine(ns('engine', { rpm: 900, engineWanted: 'off' }), words)).toBe('エンジンを止めて 900');
    });
});

describe('the part a run drives, in the owner\'s words', () => {
    const workflows = { actuators: [{ id: 'HYDROPUMPE', pin: '0x05', ja: '油圧ポンプ', en: 'Hydropumpe' }] } as unknown as Smg2Workflows;
    it('names an SMG II part from its own table, and leaves an unnamed value as it is', () => {
        expect(partName('smg2', { id: 'STEUERN_STELLGLIED' }, ['HYDROPUMPE', 'AKTIV', '0'], workflows).ja).toBe('油圧ポンプ');
        expect(partName('smg2', { id: 'STEUERN_STELLGLIED' }, ['NEU'], workflows)).toMatchObject({ ja: 'NEU', named: false });
        expect(partName('radio', { id: 'STEUERN_SEEK_UP', ja: '選局' }, undefined, null).ja).toBe('選局');
    });
});

describe('which module answers at an address (IJ F01, SC10 F01)', () => {
    const base = { candidates: [{ id: 'ascmk20', name: 'ASC MK20' }, { id: 'dsc_e46', name: 'DSC' }], hasRule: false, identified: null, chosen: null, nameOf: (id: string) => id };
    it('asks the owner where two modules share an address and no rule tells them apart', () => {
        expect(variantState({ ...base, moduleId: 'dsc_e46', address: 0x56 }).state).toBe('ask');
        expect(variantRefusal(variantState({ ...base, moduleId: 'dsc_e46', address: 0x56 }), 'DSC')).toMatch(/until the owner has said/);
    });
    it("follows the owner's answer, per car", () => {
        const all = withChoice({}, carKey('JR12345'), 0x56, 'ascmk20');
        const chosen = choiceFor(all, carKey('JR12345'), 0x56);
        expect(variantState({ ...base, moduleId: 'ascmk20', address: 0x56, chosen }).state).toBe('ok');
        expect(variantState({ ...base, moduleId: 'dsc_e46', address: 0x56, chosen }).state).toBe('ruledOut');
        expect(choiceFor(all, carKey('AB99999'), 0x56)).toBeNull();
        // The key never holds the VIN's characters.
        expect(JSON.stringify(all)).not.toContain('JR12345');
    });
    it('rules a module out where the IDENT identified another', () => {
        const v = variantState({ ...base, candidates: [], hasRule: true, moduleId: 'smg2', address: 0x32, identified: { moduleId: 'gs20', sgbd: 'GS20' }, nameOf: () => 'GS20' });
        expect(v).toMatchObject({ state: 'ruledOut', other: 'GS20' });
        expect(variantRefusal(v, 'SMG II')).toMatch(/0x32 is GS20/);
    });
});
