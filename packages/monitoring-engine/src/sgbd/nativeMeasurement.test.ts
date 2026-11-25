import { describe, expect, it } from 'vitest';
import { HAVE_SHIPPED_DATA, readShipped } from '../testing/shipped.ts';
import { nativeMeasurement, validMeasurement, verifyMeasurements } from './nativeMeasurement.ts';
import type { SgbdResultsTable } from './results.ts';

describe.skipIf(!HAVE_SHIPPED_DATA)('reviewed measurement descriptors', () => {
    it('binds the module, job, request and decoding rule to the reviewed private version', async () => {
        const table = readShipped<SgbdResultsTable>('ms450ds0.results.json');
        const [job, source] = Object.entries(table.nativeMeasurements!)[0];
        await verifyMeasurements(table);
        const spec = nativeMeasurement(table, table.module, job)!;
        expect(validMeasurement(spec, table.module, job)).toBe(true);
        expect(validMeasurement({ ...spec }, table.module, job)).toBe(false);
        expect(validMeasurement(spec, 'unrelated', job)).toBe(false);
        expect(Object.isFrozen(spec.service)).toBe(true);
        source.service[0] ^= 1;
        expect(spec.service).not.toEqual(source.service);
        await verifyMeasurements(table);
        expect(nativeMeasurement(table, table.module, job)).toBeNull();
        source.service[0] ^= 1;
        source.scale *= 2;
        await verifyMeasurements(table);
        expect(nativeMeasurement(table, table.module, job)).toBeNull();
    });
});
