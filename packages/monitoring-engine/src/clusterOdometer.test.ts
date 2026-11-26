import { describe, expect, it } from 'vitest';
import { CLUSTER_ODOMETER_JOBS, CLUSTER_ODOMETER_UNVERIFIED, clusterOdometerKm } from './clusterOdometer.ts';
import { plausibleVin } from './intake/build.ts';

/**
 * The instrument cluster's odometer read (operator, 2026-11-26): where KOMBI46's and KOMBI46R's own
 * SGBDs read AIF block 1 — bytes 4..6 as six BCD digits, in km — as EdiabasLib returned it for the
 * same simulated answers (tools/SgbdDump --exec KOMBI46 AIF_GWSZ_LESEN).
 */
const payload = (...b: number[]) => Uint8Array.from(b);

describe('the odometer in the cluster’s answer', () => {
    it('reads six BCD digits after the block, as the SGBD does', () => {
        expect(clusterOdometerKm(payload(0x01, 0x12, 0x34, 0x56, 0x78))).toBe(123456);
        expect(clusterOdometerKm(payload(0x01, 0x01, 0x23, 0x45))).toBe(12345);
        expect(clusterOdometerKm(payload(0x09, 0x99, 0x99, 0x99))).toBe(999999);
    });
    it('gives nothing for a short answer or a byte that is not two digits, where the SGBD would make a number up', () => {
        expect(clusterOdometerKm(payload(0x01, 0x12))).toBeNull();
        expect(clusterOdometerKm(payload(0x01, 0x1a, 0x34, 0x56))).toBeNull();
    });
    it('names both clusters’ own jobs, and says it is not yet confirmed on a car', () => {
        expect(CLUSTER_ODOMETER_JOBS).toEqual({ kombi46: ['AIF_GWSZ_LESEN'], kombi46r: ['STATUS_AIF_GWSZ_LESEN'] });
        expect(CLUSTER_ODOMETER_UNVERIFIED).toBe(true);
    });
});

describe('what the intake takes as a VIN', () => {
    it('a VIN, but not a part number spelled in the same characters', () => {
        expect(plausibleVin('WBSBL93060JR12345')).toBe(true);
        expect(plausibleVin('4USBT33453LR12345')).toBe(true);
        expect(plausibleVin('7834511229876543A')).toBe(false);
        expect(plausibleVin('WBSBL93060JR1234')).toBe(false);
    });
});
