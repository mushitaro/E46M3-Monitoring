import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertLoadableProfile, type EcuIndex, type EcuProfile } from './ecuCatalog';
import { STRINGS } from './i18n';
import { mayRun } from './runGate';
import { EMPTY_LEDGER } from './ledger';

/**
 * The whole shipped catalogue, checked against the code that has to read it.
 *
 * Every other test in this repo names its modules, and all of them name the same three —
 * mss54, smg2, dsc_e46. That was fine while there were three. At 51 it means the tests
 * exercise 6% of the data, and two regressions shipped through a green suite:
 *
 *   - `unclassified` was added to the JobClass union but not to the runtime allowlist
 *     `assertLoadable` checks against, so 41 of the 51 modules threw on load. The ten that
 *     did not are the ten with no unclassified job — and mss54, smg2 and dsc_e46 are three
 *     of those ten.
 *   - Ten `system` values arrived with the body/comfort/AV modules and no i18n label, so
 *     533 jobs rendered a raw English token in the Japanese UI. Neither locale had them,
 *     and `Record<string, string>` cannot complain.
 *
 * Both are the same shape of mistake: a vocabulary grew in the generator and something
 * downstream kept an older copy of it. So this file asserts over EVERY module and EVERY
 * facet value, and it reads the index rather than a list, because a list here would be one
 * more copy to fall behind.
 */

const DATA = path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data');
const read = <T,>(f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf-8')) as T;

const index = read<EcuIndex>('index.json');
const modules = index.modules.map((m) => m.id);
const profiles = modules.map((id) => [id, read<EcuProfile>(`${id}.jobs.json`)] as const);

describe('the shipped catalogue', () => {
    it('has modules to check at all', () => {
        // A guard on the guard: if index.json were empty or the wrong shape, every
        // `for (const …)` below would pass by doing nothing.
        expect(modules.length).toBeGreaterThanOrEqual(51);
    });

    it('loads — every module, through the app’s own invariants', () => {
        const failed: string[] = [];
        for (const [id, p] of profiles) {
            try {
                assertLoadableProfile(p);
            } catch (e) {
                failed.push(`${id}: ${(e as Error).message}`);
            }
        }
        expect(failed).toEqual([]);
    });
});

/**
 * Facet vocabularies, as the data actually uses them.
 *
 * The UI renders each of these through a lookup table in i18n.ts. A value with no entry
 * renders as the raw token — English, lower-case, in the middle of a Japanese screen — and
 * nothing in the type system objects, because these maps are keyed by `string`.
 */
describe('every facet value the data ships has a label in both locales', () => {
    const collect = (pick: (j: EcuProfile['jobs'][number]) => string | undefined) => {
        const seen = new Map<string, string>();
        for (const [id, p] of profiles) {
            for (const j of p.jobs) {
                const v = pick(j);
                if (v !== undefined && !seen.has(v)) seen.set(v, `${id}.${j.id}`);
            }
        }
        return seen;
    };

    const FACETS: Array<[string, (j: EcuProfile['jobs'][number]) => string | undefined, keyof (typeof STRINGS)['ja']]> = [
        ['class', (j) => j.class, 'jobClass'],
        ['audience', (j) => j.audience, 'audience'],
        ['system', (j) => j.system, 'system'],
    ];

    for (const [name, pick, key] of FACETS) {
        it.each(['ja', 'en'] as const)(`${name} — %s`, (lang) => {
            const table = STRINGS[lang][key] as Record<string, string>;
            const missing: string[] = [];
            for (const [value, witness] of collect(pick)) {
                if (!table[value]) missing.push(`${value} (first seen at ${witness})`);
            }
            expect(missing).toEqual([]);
        });
    }

    it.each(['ja', 'en'] as const)('precondition tokens — %s', (lang) => {
        const table = STRINGS[lang] as unknown as Record<string, string>;
        const missing: string[] = [];
        const seen = new Map<string, string>();
        for (const [id, p] of profiles) {
            for (const j of p.jobs) {
                for (const c of j.preconditions ?? []) if (!seen.has(c)) seen.set(c, `${id}.${j.id}`);
            }
        }
        for (const [token, witness] of seen) {
            if (!table[`precond_${token}`]) missing.push(`${token} (first seen at ${witness})`);
        }
        expect(missing).toEqual([]);
    });
});

/**
 * The gate, over the whole fleet.
 *
 * runGate.test.ts asserts this too, but over the three modules it has telegram tables for.
 * The other 48 have none, so `mayRun` refuses them at the telegram layer — which is a fact
 * about missing data, not about the gate. Asserting it here anyway is what makes the day
 * those tables arrive (Phase 4 step 39) a visible change rather than a silent one.
 */
describe('nothing outside the three telegram-bearing modules can run today', () => {
    it('refuses every non-read job in every module, with no telegram and an empty ledger', () => {
        // runGate.test.ts makes this assertion over the three modules it has telegram tables
        // for. The port's largest classification changes landed on the other 48, where it
        // never ran — including the 177 jobs that are `unclassified` because the SGBD says
        // nothing about them, several of which write a VIN or reset a controller.
        const allowed: string[] = [];
        for (const [id, p] of profiles) {
            for (const j of p.jobs) {
                if (j.class === 'read') continue;
                if (mayRun(j, null, EMPTY_LEDGER, { moduleId: id }).allowed) allowed.push(`${id}.${j.id}`);
            }
        }
        expect(allowed).toEqual([]);
    });

    it('and the reason is the absent telegram table, not the classification', () => {
        const withTelegrams = new Set(
            index.modules.filter((m) => m.sidecars.some((s) => s.endsWith('.telegrams.json'))).map((m) => m.id),
        );
        expect([...withTelegrams].sort()).toEqual(['dsc_e46', 'mss54', 'smg2']);
    });
});
