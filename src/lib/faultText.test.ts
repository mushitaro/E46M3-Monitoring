import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EcuIndex, EcuProfile, LocalisedText } from '@tsunagi/monitoring-engine';
import { isUnnamedLocation, kindJa, kindsJa } from './faultKinds';
import { displayUnit, faultLabel, hasSourceLeft, textLabel, untranslated, untranslatedText } from './faultText';

const DATA = path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data');
const HAVE = existsSync(path.join(DATA, 'index.json'));
const read = <T,>(f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf-8')) as T;

/** A module with one fault per text, codes 0x01.. in order. */
function profileOf(texts: LocalisedText[]): EcuProfile {
    return { texts, faultText: texts.map((_, i) => ({ code: `0x${(i + 1).toString(16).padStart(2, '0')}`, text: i })) } as unknown as EcuProfile;
}

describe('a fault as the owner reads it', () => {
    it('writes the SGBDs’ degree words as degrees, and leaves other units as they are', () => {
        expect(displayUnit('Grad C')).toBe('°C');
        expect(displayUnit('Grad KW')).toBe('°KW');
        expect(displayUnit('1/min')).toBe('1/min');
        expect(displayUnit(null)).toBeUndefined();
    });

    it('says the fault kinds in Japanese, and keeps a kind it does not hold as the SGBD wrote it', () => {
        expect(kindJa('statischer Fehler')).toBe('常時（散発でない）');
        expect(kindJa('Fehler momentan vorhanden')).toBe('今出ている');
        expect(kindsJa(['sporadischer Fehler', 'Etwas Neues'])).toEqual(['散発', 'Etwas Neues']);
    });

    it('tells a placeholder from a name', () => {
        expect(isUnnamedLocation('reserviert')).toBe(true);
        expect(isUnnamedLocation('unbekannter Fehlerort')).toBe(true);
        expect(isUnnamedLocation(null)).toBe(true);
        expect(isUnnamedLocation('Bremslichtschalter defekt')).toBe(false);
    });

    it('keeps a half-translation and the untranslated source out of the name slot (UX-22)', () => {
        // The shipped shapes (tools/translate.py): German left between Japanese, and German alone.
        expect(hasSourceLeft('Drehzahlfuehler・前左・elektrisch・故障')).toBe(true);
        expect(hasSourceLeft('Getriebetemperatur')).toBe(true);
        expect(hasSourceLeft('AVANOS1 Hallgeber')).toBe(true);
        expect(hasSourceLeft('TKW')).toBe(true);
        // Japanese a person reads, identifiers and network names included.
        expect(hasSourceLeft('油圧温度')).toBe(false);
        expect(hasSourceLeft('排気VANOSバンク1遅角弁駆動')).toBe(false);
        expect(hasSourceLeft('K-Bus インターフェース 通信エラー')).toBe(false);
        expect(hasSourceLeft('EEPROM Bosch領域 チェックサム異常')).toBe(false);
        // A bare Bus is German left in; only the network's name is kept.
        expect(hasSourceLeft('CAN Bus 故障')).toBe(true);
    });

    it('names in the name slot only what a person translated: a machine composition is untranslated, like a half-translation', () => {
        const p = profileOf([
            // The curated phrase tables (tools/terms): a person wrote it.
            { de: 'Getriebeoeltemperatur', ja: '変速機油温', en: 'Gearbox oil temperature', tier: 'phrase' },
            // One word of the token dictionary, translated as that word.
            { de: 'Relais', ja: 'リレー', en: 'Relay', tier: 'word' },
            // Word by word by machine: reads as Japanese, no German left, and still not a person's name.
            { de: 'frei 15', ja: '許可15', en: 'release 15', tier: 'tokens' },
            // The German as it was.
            { de: 'Getriebetemperatur', ja: 'Getriebetemperatur', en: 'Getriebetemperatur', tier: 'source' },
            // A catalogue from before tiers were recorded: not known, so not shown as known.
            { de: 'Kupplung', ja: 'クラッチ', en: 'Clutch' },
            // A person's phrase that still carries German.
            { de: 'Drehzahlfuehler vorne links', ja: 'Drehzahlfuehler・前左', en: 'Speed sensor front left', tier: 'phrase' },
        ]);
        expect(p.texts.map((t) => untranslatedText(t))).toEqual([false, false, true, true, true, true]);
        expect([1, 2, 3, 4, 5, 6].map((c) => untranslated(p, c))).toEqual([false, false, true, true, true, true]);
        // The screen and the assistant read the same rule: no name for the slot, the German beside it.
        expect(faultLabel(p, 1, 'ja')).toEqual({ text: '変速機油温', original: 'Getriebeoeltemperatur' });
        expect(faultLabel(p, 1, 'en')).toEqual({ text: 'Gearbox oil temperature', original: 'Getriebeoeltemperatur' });
        expect(faultLabel(p, 3, 'ja')).toEqual({ text: null, original: 'frei 15' });
        expect(faultLabel(p, 3, 'en')).toEqual({ text: null, original: 'frei 15' });
        // A code the table lacks is a fault with no name, not an untranslated one.
        expect(untranslated(p, 0x7f)).toBe(false);
        expect(faultLabel(p, 0x7f, 'ja')).toBeNull();
    });

    it.skipIf(!HAVE)('holds the rule over every fault name the catalogues ship', () => {
        const index = read<EcuIndex>('index.json');
        const tiers = new Map<string, number>();
        for (const m of index.modules) {
            const p = read<EcuProfile>(`${m.id}.jobs.json`);
            for (const f of p.faultText) {
                const t = p.texts[f.text];
                // Every shipped name says where it came from.
                expect(t.tier, `${m.id} ${f.code}`).toBeDefined();
                tiers.set(t.tier!, (tiers.get(t.tier!) ?? 0) + 1);
                const shown = textLabel(p, f.text, 'ja').text;
                if (t.tier === 'tokens' || t.tier === 'source') expect(shown, `${m.id} ${f.code} ${t.de}`).toBeNull();
                else expect(shown !== null, `${m.id} ${f.code} ${t.de}`).toBe(!hasSourceLeft(t.ja));
            }
        }
        // The word-by-word compositions are there, and none reaches the name slot (above).
        expect(tiers.get('tokens') ?? 0).toBeGreaterThan(0);
        expect(tiers.get('phrase') ?? 0).toBeGreaterThan(0);
    });
});
