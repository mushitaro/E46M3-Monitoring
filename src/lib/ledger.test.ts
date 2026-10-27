import { describe, expect, it } from 'vitest';
import {
    EMPTY_LEDGER,
    MOVING_OK_MIN_OBSERVATIONS,
    applyKillList,
    grantMovingOk,
    mayReadWhileMoving,
    mayRunOnVehicle,
    recordParkedObservation,
    withdrawn,
    type Ledger,
} from './ledger';

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

describe('reads observed on a stationary car', () => {
    const id = 'dsc_e46:STATUS_LWS';
    const seen = (n: number, telegram = '56 05 0b 05 5d') => ({ telegram, response: 'aa bb', at: `2026-10-27T10:0${n}:00Z`, ecuIdent: '01 02' });

    it('are recorded as a fact, counted per bytes, and stay observed-parked however many there are', () => {
        let l = EMPTY_LEDGER;
        for (let i = 0; i < 5; i++) l = recordParkedObservation(l, id, seen(i));
        expect(l.records[id]).toMatchObject({ status: 'observed-parked', observations: 5, ecuIdent: '01 02' });
        expect(mayReadWhileMoving(l, id)).toBe(false);
    });

    it('start counting again when the bytes change — the observation was about the old bytes', () => {
        let l = recordParkedObservation(EMPTY_LEDGER, id, seen(0));
        l = recordParkedObservation(l, id, seen(1));
        l = recordParkedObservation(l, id, seen(2, '56 05 0b 06 5e'));
        expect(l.records[id]).toMatchObject({ observations: 1, telegram: '56 05 0b 06 5e' });
    });

    it('never argue with a withdrawal', () => {
        const l: Ledger = { version: 1, records: { [id]: { id, status: 'revoked', reason: 'bad frame' } } };
        expect(recordParkedObservation(l, id, seen(0))).toBe(l);
        expect(withdrawn(l, id)?.reason).toBe('bad frame');
    });

    it('become moving-ok only by the owner’s grant, and only with enough of them', () => {
        let l = EMPTY_LEDGER;
        for (let i = 0; i < MOVING_OK_MIN_OBSERVATIONS - 1; i++) l = recordParkedObservation(l, id, seen(i));
        const early = grantMovingOk(l, id, { who: 'owner', at: '2026-10-27T11:00:00Z' });
        expect(early.refused).toMatch(/needed/);
        expect(early.ledger).toBe(l);

        l = recordParkedObservation(l, id, seen(9));
        const granted = grantMovingOk(l, id, { who: 'owner', at: '2026-10-27T11:00:00Z' });
        expect(granted.refused).toBeNull();
        expect(mayReadWhileMoving(granted.ledger, id)).toBe(true);
        expect(granted.ledger.records[id]).toMatchObject({ movingOkBy: 'owner' });

        // A later observation keeps the grant.
        const later = recordParkedObservation(granted.ledger, id, seen(8));
        expect(later.records[id].status).toBe('moving-ok');
    });

    it('cannot be cleared from nothing', () => {
        expect(grantMovingOk(EMPTY_LEDGER, id, { who: 'owner', at: 'x' }).refused).toMatch(/candidate/);
    });

    it('do not make a non-read runnable', () => {
        let l = EMPTY_LEDGER;
        for (let i = 0; i < 3; i++) l = recordParkedObservation(l, id, seen(i));
        l = grantMovingOk(l, id, { who: 'owner', at: 'x' }).ledger;
        expect(mayRunOnVehicle(l, id).allowed).toBe(false);
    });
});
