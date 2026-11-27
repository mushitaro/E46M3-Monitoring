import { describe, expect, it } from 'vitest';
import { assistantLine, assistantMay, moduleRoster, ownerRules, ownerTable, refusal, refusalKinds, stopList } from './capabilities.ts';
import { NATURES, OWNER_DECISION } from './policy.ts';
import { RUN_BLOCK_STOP, STOP_IDS, STOP_REASONS } from './stopReasons.ts';
import type { EcuIndex } from './ecuCatalog.ts';

/**
 * What another app (GREN BLUE SUITE) builds its own capabilities answer from (GREN BLUE's asks 2-1 and
 * 2-2, 2026-11-27). WORKS's answer and docs/CAPABILITIES.md are held by src/lib/bridge/capabilities.test.ts.
 */
describe('the capabilities parts the engine hands out', () => {
    it('speaks of the app’s own tools, never of one app’s', () => {
        const suite = ownerRules({ stopTool: 'maintenance_car_stop', wordsArg: 'word' }).map((r) => r.en).join('\n');
        expect(suite).toContain('maintenance_car_stop');
        expect(suite).toContain('pass their words as word');
        expect(suite).not.toMatch(/monitoring_/);
    });

    it('says, nature by nature, what the owner’s table says', () => {
        const rows = ownerTable(() => ['x_tool']);
        expect(rows.map((r) => r.nature)).toEqual(NATURES.map((n) => n.nature));
        for (const r of rows) {
            const d = OWNER_DECISION[r.nature];
            expect([r.when, r.how, r.who]).toEqual([d.when, d.how, d.who]);
            const a = assistantMay(r.nature);
            expect(a.may, r.nature).toBe(d.how === 'run' && d.who === 'ai');
        }
        expect(assistantMay('w')).toEqual({ may: false, why: 'off' });
        expect(assistantLine('r_ident', ['a', 'b'])).toBe('yes, moving or parked (a, b)');
    });

    it('lists the closed stops in order, each with its next step, and maps every refusal of the gate', () => {
        expect(stopList().map((s) => s.id)).toEqual([...STOP_IDS]);
        for (const s of stopList()) expect(s.next).toBe(STOP_REASONS[s.id].nextEn);
        const kinds = refusalKinds();
        for (const k of Object.keys(RUN_BLOCK_STOP)) expect(kinds[k], k).toBeTruthy();
        expect(kinds.route).toMatch(/not a stop/);
        expect(kinds.state).toMatch(/not a stop/);
    });

    it('refuses in one shape', () => {
        expect(refusal('S1', 'The car is moving.')).toEqual({ started: false, reason: 'The car is moving.', stop: 'S1', next: STOP_REASONS.S1.nextEn });
        expect(refusal('state', 'A job is on.', 'Stop it first.')).toEqual({ started: false, reason: 'A job is on.', stop: 'state', next: 'Stop it first.' });
    });

    it('names the default fitment for the profile, not the M3', () => {
        const index = {
            modules: [
                { id: 'mss54', name_en: 'DME', address: 0x12, addressHex: '0x12', fit: 'std' },
                { id: 'x', name_en: 'X', address: 0x44, addressHex: '0x44', fit: 'std' },
                { id: 'y', name_en: 'Y', address: 0x44, addressHex: '0x44', fit: 'opt' },
                { id: 'z', name_en: 'Z', address: 0x45, addressHex: '0x45', fit: 'nonm3' },
            ],
        } as unknown as EcuIndex;
        const roster = moduleRoster(index, { schema: 1, generatedAt: '', groups: [] }, { schema: 1, verifiedOnCar: false, modules: {} } as never);
        const by = Object.fromEntries(roster.map((m) => [m.id, m.chosenBy]));
        expect(by).toMatchObject({ x: 'owner', y: 'owner', z: 'ident-only' });
        expect(roster.map((m) => m.chosenBy)).not.toContain('m3');
    });
});
