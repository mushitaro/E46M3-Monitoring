import { describe, expect, it } from 'vitest';
import { isUnnamedLocation, kindJa, kindsJa } from './faultKinds';
import { displayUnit } from './faultText';

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
});
