import { describe, expect, it } from 'vitest';
import { jobIndex, type EcuProfile } from '../ecuCatalog.ts';
import { EMPTY_LEDGER, type Ledger } from '../ledger.ts';
import { bestTelegram, type TelegramTable } from '../telegrams.ts';
import { HAVE_SHIPPED_DATA, readShipped } from '../testing/shipped.ts';
import { isModuleChannel, moduleChannels, moduleLogGate, moduleLogValues, type ModuleLogRead } from './logChannels.ts';
import type { SgbdResultsTable } from './results.ts';

describe('module channel names', () => {
    it('are module:JOB:RESULT, and not the DME’s or RAM’s', () => {
        expect(isModuleChannel('smg2:STATUS_IO_LESEN:STAT_MOTORDREHZAHL_WERT')).toBe(true);
        expect(isModuleChannel('3:n')).toBe(false);
        expect(isModuleChannel('ram:FFD1A2')).toBe(false);
    });
});

describe.skipIf(!HAVE_SHIPPED_DATA)('SMG II as DATALOG channels', () => {
    const profile = HAVE_SHIPPED_DATA ? readShipped<EcuProfile>('smg2.jobs.json') : null;
    const telegrams = HAVE_SHIPPED_DATA ? readShipped<TelegramTable>('smg2.telegrams.json') : null;
    const results = HAVE_SHIPPED_DATA ? readShipped<SgbdResultsTable>('smg2.results.json') : null;
    const d = () => ({ address: 0x32, profile: profile!, jobs: jobIndex(profile!), telegrams: telegrams!, results: results! });

    it('offers the numbers of the argument-free reads, named and with the unit the job’s own code gives', () => {
        const list = moduleChannels('smg2', d());
        const rpm = list.find((c) => c.channel === 'smg2:STATUS_IO_LESEN:STAT_MOTORDREHZAHL_WERT');
        expect(rpm).toMatchObject({ module: 'smg2', job: 'STATUS_IO_LESEN', unit: '1/min' });
        expect(rpm!.name).not.toBe('');
        // The learned values take an argument: not a DATALOG channel.
        expect(list.some((c) => c.job === 'ADAPTIONSWERTE_LESEN')).toBe(false);
        expect(list.every((c) => !c.result.endsWith('_EINH') && c.result !== 'JOB_STATUS')).toBe(true);
    });

    const read = (): ModuleLogRead => ({
        module: 'smg2',
        address: 0x32,
        job: jobIndex(profile!).get('STATUS_IO_LESEN')!,
        telegram: bestTelegram(telegrams!, 'STATUS_IO_LESEN'),
        results: results!,
        wanted: new Set(['STAT_MOTORDREHZAHL_WERT']),
    });

    it('goes parked, waits moving or unmeasured, and goes moving once the owner has cleared it', () => {
        expect(moduleLogGate(read(), EMPTY_LEDGER, 'parked')).toEqual({ frame: Uint8Array.from([0x32, 0x05, 0x0b, 0x03, 0x3f]) });
        expect(moduleLogGate(read(), EMPTY_LEDGER, 'moving')).toEqual({ frame: null });
        expect(moduleLogGate(read(), EMPTY_LEDGER, 'unknown')).toEqual({ frame: null });
        const ok: Ledger = { ...EMPTY_LEDGER, records: { 'smg2:STATUS_IO_LESEN': { id: 'smg2:STATUS_IO_LESEN', status: 'moving-ok' } } };
        expect('frame' in moduleLogGate(read(), ok, 'moving') && moduleLogGate(read(), ok, 'moving')).toEqual({ frame: Uint8Array.from([0x32, 0x05, 0x0b, 0x03, 0x3f]) });
    });

    it('takes the wanted value from the answer', () => {
        const payload = new Uint8Array(128);
        payload[0] = 0x0b;
        payload[1] = 0xb8;
        const v = moduleLogValues(read(), Uint8Array.from([0x32, 0x05, 0x0b, 0x03, 0x3f]), { address: 0x32, length: 132, controlOrStatus: 0xa0, payload, checksum: 0 });
        expect(v).toEqual({ 'smg2:STATUS_IO_LESEN:STAT_MOTORDREHZAHL_WERT': 3000 });
    });
});
