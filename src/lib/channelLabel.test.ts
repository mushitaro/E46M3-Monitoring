import { describe, expect, it } from 'vitest';
import { channelLabel, namesInText, normUnit, pairTargets, pairTitle } from './channelLabel';

const W = { channel_ofModule: (m: string) => `${m} の値`, channel_unnamed: '名前なし' };
const phyd = { module: 'smg2', result: 'STAT_PHYD_WERT', name: 'Hydraulic pressure', ja: '油圧', unit: 'bar' };
const bare = { module: 'smg2', result: 'STAT_MOTORDREHZAHL_WERT', name: 'STAT_MOTORDREHZAHL_WERT', ja: 'STAT_MOTORDREHZAHL_WERT', unit: '1/min' };
const other = (id: string) => (id.endsWith(':STAT_PHYD_WERT') ? phyd : id.endsWith(':STAT_MOTORDREHZAHL_WERT') ? bare : null);

describe('a channel in the name slot is a name, never its identifier (UX-09)', () => {
    it('names a DME channel and keeps the id for the ident slot', () => {
        const l = channelLabel('19:v', 'ja', W);
        expect(l).toMatchObject({ name: '車速（直接入力）', unit: 'km/h', ident: '19:v', named: true });
    });

    it('names a module channel from its data, and its unit in the catalogue spelling', () => {
        expect(channelLabel('smg2:STATUS_IO_LESEN:STAT_PHYD_WERT', 'ja', W, other)).toMatchObject({ name: '油圧', unit: 'bar', ident: 'SMG II · STAT_PHYD_WERT' });
    });

    it('says the kind of value where the data has no name, and does not promote the result name', () => {
        const l = channelLabel('smg2:STATUS_IO_LESEN:STAT_MOTORDREHZAHL_WERT', 'ja', W, other);
        expect(l).toMatchObject({ name: 'SMG II の値', unit: 'rpm', named: false });
        expect(l.name).not.toContain('STAT_');
    });

    it('a channel it cannot name at all is 名前なし, with the id beside it', () => {
        expect(channelLabel('ram:0xffd000', 'ja', W)).toMatchObject({ name: '名前なし', ident: 'ram:0xffd000' });
    });

    it('one spelling per unit', () => {
        expect(normUnit('Grad C')).toBe('°C');
        expect(normUnit('1/min')).toBe('rpm');
        expect(normUnit('bar')).toBe('bar');
        expect(normUnit(null)).toBe('');
    });

    it('replaces known ids in a sentence and leaves everything else', () => {
        expect(namesInText('19:v と 19:v_asc の差、3:00 に', 'ja', W)).toBe('車速（直接入力） と 車速（CAN） の差、3:00 に');
    });
});

describe('a target and its actual are one panel', () => {
    it('pairs …_soll with …_ist, target first, in the order given', () => {
        expect(pairTargets(['3:n', '35:evan1_ist', '35:evan1_soll', '19:v'])).toEqual([['3:n'], ['35:evan1_soll', '35:evan1_ist'], ['19:v']]);
    });

    it('titles a pair with what the two names share', () => {
        expect(pairTitle('吸気VANOS バンク1 目標角', '吸気VANOS バンク1 実角')).toBe('吸気VANOS バンク1');
        expect(pairTitle('A', 'B')).toBe('A');
    });
});
