import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { HAVE_SHIPPED_DATA, SHIPPED_DATA } from '../testing/shipped.ts';
import { moduleChannels, moduleLogData } from './logChannels.ts';

/**
 * Every module's values in DATALOG (operator 2026-11-13: 「全モジュールのデータログ」). A channel is offered
 * only where the module's own status-read code reads one answer of its table's frame to the end.
 */
describe.skipIf(!HAVE_SHIPPED_DATA)('DATALOG channels across the modules', () => {
    const index = HAVE_SHIPPED_DATA ? (JSON.parse(readFileSync(path.join(SHIPPED_DATA, 'index.json'), 'utf-8')) as { modules: { id: string; address: number }[] }) : null;
    const shipped = HAVE_SHIPPED_DATA ? new Set(readdirSync(SHIPPED_DATA).filter((f) => f.endsWith('.results.json')).map((f) => f.slice(0, -'.results.json'.length))) : new Set<string>();

    it('offers values from many modules besides SMG II, and never a fault-read job', async () => {
        const g = globalThis as { fetch?: typeof fetch };
        const real = g.fetch;
        g.fetch = (async (u: string) => {
            const f = path.join(SHIPPED_DATA, String(u).replace(/^\.\/ecu-data\//, ''));
            try {
                return new Response(readFileSync(f, 'utf-8'), { status: 200 });
            } catch {
                return new Response('', { status: 404 });
            }
        }) as typeof fetch;
        try {
            const modules = new Set<string>();
            for (const m of index!.modules) {
                if (m.id === 'mss54' || !shipped.has(m.id)) continue;
                const d = await moduleLogData(m.id, m.address);
                if (!d) continue;
                for (const c of moduleChannels(m.id, d)) {
                    expect(c.job.startsWith('FS_')).toBe(false);
                    modules.add(c.module);
                }
            }
            expect(modules.has('smg2')).toBe(true);
            expect(modules.size).toBeGreaterThanOrEqual(10);
        } finally {
            g.fetch = real;
        }
    });
});
