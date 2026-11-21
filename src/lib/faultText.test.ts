import { describe, expect, it } from 'vitest';
import { isUnnamedLocation, kindJa, kindsJa } from './faultKinds';
import { displayUnit, hasSourceLeft } from './faultText';

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
});
