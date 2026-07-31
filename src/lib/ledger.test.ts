import { describe, expect, it } from 'vitest';
import { EMPTY_LEDGER, applyKillList, mayRunOnVehicle, type Ledger } from './ledger';

const ledgerWith = (records: Ledger['records']): Ledger => ({ version: 1, records });

describe('mayRunOnVehicle', () => {
    it('refuses anything with no ledger entry', () => {
        // Default-deny. Everything in the app is currently in this state.
        const r = mayRunOnVehicle(EMPTY_LEDGER, 'mss54:STEUERN_EV1');
        expect(r.allowed).toBe(false);
        expect(r.reason).toContain('not verified');
    });

    it('allows a verified entry', () => {
        const r = mayRunOnVehicle(
            ledgerWith({
                'mss54:IDENT': { id: 'mss54:IDENT', status: 'verified', verifiedAt: '2026-08-01T10:00:00Z' },
            }),
            'mss54:IDENT',
        );
        expect(r.allowed).toBe(true);
    });

    it('refuses a candidate even when a record exists', () => {
        expect(
            mayRunOnVehicle(ledgerWith({ x: { id: 'x', status: 'candidate' } }), 'x').allowed,
        ).toBe(false);
    });

    it('keeps a refuted entry refused, and keeps its reason', () => {
        const r = mayRunOnVehicle(
            ledgerWith({ x: { id: 'x', status: 'refuted', reason: 'wrong argument order' } }),
            'x',
        );
        expect(r.allowed).toBe(false);
        expect(r.reason).toBe('wrong argument order');
    });
});

describe('the kill list', () => {
    it('revokes a previously verified entry', () => {
        const ledger = ledgerWith({
            'mss54:STEUERN_EKP': { id: 'mss54:STEUERN_EKP', status: 'verified' },
        });
        const merged = applyKillList(ledger, {
            version: 3,
            revoked: [{ id: 'mss54:STEUERN_EKP', reason: 'argument layout was wrong in build 41' }],
        });

        const r = mayRunOnVehicle(merged, 'mss54:STEUERN_EKP');
        expect(r.allowed).toBe(false);
        expect(r.reason).toContain('build 41');
    });

    it('can only revoke, never grant', () => {
        // A stale or tampered list must be able to make the app more cautious
        // and never less. There is deliberately no "allow" direction.
        const merged = applyKillList(EMPTY_LEDGER, {
            version: 1,
            revoked: [{ id: 'anything', reason: 'x' }],
        });
        expect(mayRunOnVehicle(merged, 'anything').allowed).toBe(false);
        expect(mayRunOnVehicle(merged, 'something-else').allowed).toBe(false);
    });

    it('does not mutate the ledger it was given', () => {
        const ledger = ledgerWith({ a: { id: 'a', status: 'verified' } });
        applyKillList(ledger, { version: 1, revoked: [{ id: 'a', reason: 'r' }] });
        expect(ledger.records.a.status).toBe('verified');
    });

    it('revokes an id that has no local record at all', () => {
        const merged = applyKillList(EMPTY_LEDGER, {
            version: 1,
            revoked: [{ id: 'unknown', reason: 'withdrawn' }],
        });
        expect(merged.records.unknown.status).toBe('revoked');
    });
});
