import { describe, expect, it } from 'vitest';
import { mintTicket } from '../../../functions/api/bridge/ticket';

/**
 * The tab's ticket to the relay names the Mainstay this deployment serves (`s`), so that once the M
 * platform checks the tickets of MONITORING (m3 as a Mainstay, operator 2026-11-27) the same ticket
 * passes there; the relay ignores `s` for this app until then.
 */

const claimsOf = (ticket: string) => {
    const [v, payload] = ticket.split('.');
    expect(v).toBe('v1');
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
};

const SECRET = 'x'.repeat(32);

describe('the bridge ticket', () => {
    it('names the Mainstay when one is set', async () => {
        const c = claimsOf(await mintTicket(SECRET, 'acct-00000001', 1_000, 'm3'));
        expect(c).toMatchObject({ o: 'acct-00000001', a: 'monitoring', s: 'm3', e: 1_060 });
        expect(typeof c.n).toBe('string');
    });

    it('leaves it out when none is set, or it is not a slug', async () => {
        expect(claimsOf(await mintTicket(SECRET, 'acct-00000001', 1_000))).not.toHaveProperty('s');
        expect(claimsOf(await mintTicket(SECRET, 'acct-00000001', 1_000, 'M3 '))).not.toHaveProperty('s');
    });
});
