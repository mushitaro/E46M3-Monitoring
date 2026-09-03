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
/**
 * The SGBD's own words about a job outrank our reading of its name.
 *
 * MSS54's STATUS_TANK_DICHTHEIT was classified `read` because the name starts with
 * STATUS_, while its SGBD comment says "Tankleckpruefung mit DMTL anstossen" — trigger the
 * tank leak test. It took no arguments, so the only layer of mayRun between it and the car
 * was its telegram happening to be graded `shared`. Two mirror-memory modules had the same
 * shape: SPEICHER_LESEN, "Ansteuern von Funktionen des Steuergeraetes".
 *
 * BMW's naming convention is not a promise, and where it disagrees with BMW's own
 * description, the description is the one that says what the job does.
 */
describe('no job classified read describes an actuation', () => {
    // The same verbs classify.py keys on. Repeated here rather than imported — a test that
    // shares its rule with the code under test can only ever agree with it.
    const ACTUATES = /anstossen|anstoßen|durchfuehren|durchführen|ansteuern|starten|ausloesen|auslösen|einleiten|aktivieren/i;

    it('across every module', () => {
        const bad: string[] = [];
        for (const [id, p] of profiles) {
            for (const j of p.jobs) {
                if (j.class !== 'read' || j.desc === undefined) continue;
                const de = p.texts[j.desc]?.de ?? '';
                if (ACTUATES.test(de)) bad.push(`${id}.${j.id}: ${de}`);
            }
        }
        expect(bad).toEqual([]);
    });
});

describe('what writes the car’s identity is never addressed to its owner', () => {
    // 48 jobs write a VIN, a ZCS, the immobiliser's key material or the odometer offset.
    // Before the `identity` class existed the generic `_SCHREIBEN` rule filed all of them
    // as `calibration` with `audience: 'owner'`, so EWS3's ISN_SCHREIBEN was listed for a
    // car's owner under the sentence “rewrites a learned or adjusted value”.
    //
    // Two separate claims, because they can regress separately: who it is shown to, and
    // whether the gate has a sentence of its own for it.
    it('every identity job is addressed to a technician', () => {
        const owned: string[] = [];
        for (const [id, p] of profiles) {
            for (const j of p.jobs) {
                if (j.class === 'identity' && j.audience !== 'technician') owned.push(`${id}.${j.id}`);
            }
        }
        expect(owned).toEqual([]);
    });

    it('and mayRun refuses it by its class, before anything about the session', () => {
        // Not `run_block_notRead`/`notVerified`: those say “nobody has proven this”, which
        // would send a reader to the ledger. The refusal here is about the job.
        const wrong: string[] = [];
        for (const [id, p] of profiles) {
            for (const j of p.jobs) {
                if (j.class !== 'identity') continue;
                const v = mayRun(j, null, EMPTY_LEDGER, { moduleId: id });
                if (v.allowed || v.reason !== 'run_block_identity') wrong.push(`${id}.${j.id}`);
            }
        }
        expect(wrong).toEqual([]);
    });

    it('and there are still some — a rule that matches nothing proves nothing', () => {
        let n = 0;
        for (const [, p] of profiles) n += p.jobs.filter((j) => j.class === 'identity').length;
        expect(n).toBeGreaterThan(40);
    });
});

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
