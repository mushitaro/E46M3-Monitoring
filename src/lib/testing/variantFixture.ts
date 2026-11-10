/**
 * Variant rules shaped like the generated ones (ecu-data/variants.json: D_0012's chain of lookups,
 * D_0032's nested branch and its "XYZ"), cut down to a few rows, for tests that must run on a clone
 * without the private data. The codes are the ones the practice cars answer with (lib/practiceCar).
 */
import { ds2IdentData, type PracticeIdent } from '../practiceCar';
import type { VariantRules } from '../variants';

export const FIXTURE_RULES: VariantRules = {
    schema: 1,
    generatedAt: '',
    groups: [
        {
            address: 0x12,
            group: 'D_0012',
            groupSha256: '',
            positive: 0xa0,
            unknown: [],
            choose: {
                key: [[3, 7]],
                rows: [['1234567', 'DM338DS0']],
                else: { key: [[10, 2], [14, 2]], rows: [['1B90', 'MSS54DS0'], ['1910', 'MS430DS0']], else: null },
            },
        },
        {
            address: 0x32,
            group: 'D_0032',
            groupSha256: '',
            positive: 0xa0,
            unknown: ['XYZ'],
            choose: {
                key: [[10, 2]],
                rows: [
                    ['22', { key: [[14, 1]], rows: [['1', 'GS836']], else: 'GS832' }],
                    ['2F', 'SMG2'],
                    ['29', 'GS20'],
                ],
                else: 'XYZ',
            },
        },
    ],
};

export const FIXTURE_MODULES = [
    { id: 'mss54', sgbd: 'MSS54DS0.prg' },
    { id: 'smg2', sgbd: 'SMG2.prg' },
    { id: 'kombi46', sgbd: 'KOMBI46.prg' },
];

/** A whole IDENT answer frame, as the link hands it to `fittedFrom`. */
export function identFrame(address: number, ident: PracticeIdent, status = 0xa0): Uint8Array {
    const body = [address, 0, status, ...ds2IdentData(ident)];
    body[1] = body.length + 1;
    return Uint8Array.from([...body, body.reduce((a, b) => a ^ b, 0)]);
}
