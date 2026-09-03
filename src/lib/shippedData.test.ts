import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertLoadableProfile, type EcuIndex, type EcuProfile } from './ecuCatalog';
import { STRINGS } from './i18n';
import { READ_ONLY_CONTROLS, mayRun } from './runGate';
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

type TelegramTable = {
    module: string;
    address: number;
    jobs: Record<string, { hex: string; cmd: number; confidence: string }[]>;
};
const telegrams = new Map(
    modules.map((id) => [id, read<TelegramTable>(`${id}.telegrams.json`)] as const),
);

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

describe('no non-read job can run, on any module, with any telegram', () => {
    it('refuses every non-read job in every module', () => {
        // runGate.test.ts makes this assertion over three modules. The port's largest
        // classification changes landed on the other 48, and until the telegram tables
        // arrived those 48 were also being held back by the missing table — so this had
        // never actually exercised the classification gate on them. Now it does: every
        // module has a table, and the class is the only thing refusing these.
        const allowed: string[] = [];
        for (const [id, p] of profiles) {
            const table = telegrams.get(id)!;
            for (const j of p.jobs) {
                if (j.class === 'read') continue;
                const entries = table.jobs[j.id] ?? [];
                const tel =
                    entries.length === 1
                        ? { hex: entries[0].hex, confidence: entries[0].confidence as 'single' }
                        : null;
                if (mayRun(j, tel as never, EMPTY_LEDGER, { moduleId: id }).allowed) {
                    allowed.push(`${id}.${j.id}`);
                }
            }
        }
        expect(allowed).toEqual([]);
    });
});

describe('a telegram table only ever addresses its own module', () => {
    // 0x56 carries two SGBDs — ASCMK20 on early cars, DSC_E46 on late ones — and the
    // extractor is driven by address, so this was the first time two tables could be built
    // for one address. If a frame from one leaked into the other's table, mayRun would
    // accept a neighbouring ECU's frame as this job's own and the app would send it.
    //
    // Checked over every frame in the catalogue, not just 0x56, because the property is not
    // special to that address — it is what makes a per-module table mean anything.
    it('every frame in every table starts with that module’s address', () => {
        const wrong: string[] = [];
        let frames = 0;
        for (const m of index.modules) {
            const table = telegrams.get(m.id)!;
            expect(table.address).toBe(m.address);
            for (const [job, entries] of Object.entries(table.jobs)) {
                for (const e of entries) {
                    frames++;
                    if (parseInt(e.hex.split(' ')[0], 16) !== m.address) {
                        wrong.push(`${m.id}.${job} ${e.hex}`);
                    }
                }
            }
        }
        expect(wrong).toEqual([]);
        // A property checked over nothing is not checked.
        expect(frames).toBeGreaterThan(2000);
    });

    it('the two tables at 0x56 were extracted separately, and show it', () => {
        // They share 24 frames, and that is correct: both speak DS2 to the same address, so
        // IDENT really is `56 04 00 52` on each. Common frames are the protocol, not a leak.
        //
        // What proves they came from two different .prg files is where they DIFFER. Several of
        // the 27 shared job names have different frame sets, and the differences sit in the
        // hydraulic valve byte — ASCMK20 drives `f3` where DSC_E46 drives `f1`. A table
        // copied from its neighbour could not disagree about that.
        const a = telegrams.get('ascmk20')!;
        const d = telegrams.get('dsc_e46')!;
        expect(a.address).toBe(d.address);

        const hexes = (t: TelegramTable, job: string) =>
            (t.jobs[job] ?? []).map((e) => e.hex).sort();
        const shared = Object.keys(a.jobs).filter((j) => j in d.jobs);
        const differing = shared.filter(
            (j) => JSON.stringify(hexes(a, j)) !== JSON.stringify(hexes(d, j)),
        );
        expect(shared.length).toBe(27);
        expect(differing).toContain('DRUCKAUFBAU_VL');
        expect(differing.length).toBeGreaterThan(5);
    });
});

describe('what a real car would accept today', () => {
    // Reads do not consult the ledger — mayRun's remaining gates for them are the class,
    // a certain telegram, taking no arguments, and a read-only control byte. Until the
    // telegram tables landed, 48 modules were held back by the third of those alone.
    //
    // This is a tripwire, not a rule: the number moves when the extractor or the classifier
    // moves, and both of those are exactly when someone should look at the list. Same
    // reasoning as tools/ecu_data_counts.json.
    const allowed: string[] = [];
    for (const [id, p] of profiles) {
        const table = telegrams.get(id)!;
        for (const j of p.jobs) {
            const entries = table.jobs[j.id] ?? [];
            if (entries.length !== 1 || entries[0].confidence !== 'single') continue;
            const tel = { hex: entries[0].hex, confidence: 'single' as const };
            if (mayRun(j, tel as never, EMPTY_LEDGER, { moduleId: id }).allowed) {
                allowed.push(`${id}.${j.id}`);
            }
        }
    }

    it('is 96 jobs across 36 modules', () => {
        // Was 86 across 36. The ten that arrived are seven `IS_LESEN` /
        // `FS_SHADOW_LESEN` (control 0x14) and two
        // `STATUS_AUSSCHWINGZEIT_LESEN` (0x0d) — both control bytes already
        // named in `READ_ONLY_CONTROLS`, whose frames the extractor had been
        // dropping. Nothing was lost, and the policy did not move: the gate was
        // already willing to send these, and now their frames exist.
        expect(allowed.length).toBe(96);
        expect(new Set(allowed.map((a) => a.split('.')[0])).size).toBe(36);
    });

    it('and every one of them is classified read and takes no arguments', () => {
        const byId = new Map(profiles.map(([id, p]) => [id, new Map(p.jobs.map((j) => [j.id, j]))]));
        for (const a of allowed) {
            const [mid, jid] = [a.slice(0, a.indexOf('.')), a.slice(a.indexOf('.') + 1)];
            const j = byId.get(mid)!.get(jid)!;
            expect(j.class).toBe('read');
            expect(j.args).toEqual([]);
        }
    });
});

describe('reads whose control byte we cannot vouch for', () => {
    /**
     * The extractor used to filter frames through an 18-entry command whitelist
     * written for MSS54, so this list was empty by construction. With that
     * filter replaced by an evidence model, 47 jobs we classify `read` turn out
     * to use seven command bytes nobody has established as reads.
     *
     * A FINDING, not a violation, and the two must not be confused:
     *
     *   - `READ_ONLY_CONTROLS` is NOT extended to cover them. Fourteen modules
     *     spelling `PRUEFSTEMPEL_LESEN` as 0x0e is strong evidence that 0x0e
     *     reads an inspection stamp — and evidence is not verification. That
     *     list decides what a real car receives.
     *   - so `mayRun` refuses all 42, and its wording is already careful: the
     *     frame COULD change the car, not does.
     *
     * What is pinned is the SET of command bytes. A new one is a new question
     * about the wire and fails here; the seven known ones do not.
     */
    const UNVOUCHED: ReadonlyMap<number, string> = new Map([
        [0x02, 'lsz.FG_NR_LESEN, SIA_LESEN'],
        [0x08, 'smg2.CODIERDATEN_LESEN, mrs4.BARCODE_*_LESEN'],
        [0x0e, 'PRUEFSTEMPEL_LESEN on 14 modules — an inspection stamp, evidently'],
        [0x1b, 'BETRIEBSSTUNDENZAEHLER_LESEN, STATUS_LESEN'],
        [0x40, 'SYSTEM_PARAMETER_LESEN on the nav units'],
        [0x63, 'cdc_46.SER_NR_DOM_LESEN'],
        [0x80, 'mrs4.C_FS_LESEN'],
    ]);

    const found = new Map<number, string[]>();
    for (const [id, p] of profiles) {
        const table = telegrams.get(id)!;
        for (const j of p.jobs) {
            if (j.class !== 'read') continue;
            const entries = table.jobs[j.id] ?? [];
            if (entries.length !== 1 || entries[0].confidence !== 'single') continue;
            const control = Number.parseInt(entries[0].hex.split(' ')[2], 16);
            if (READ_ONLY_CONTROLS.has(control)) continue;
            if (!found.has(control)) found.set(control, []);
            found.get(control)!.push(`${id}.${j.id}`);
        }
    }

    it('names every one of the command bytes involved', () => {
        const surprises = [...found.keys()].filter((c) => !UNVOUCHED.has(c));
        expect(surprises.map((c) => `0x${c.toString(16)}`)).toEqual([]);
    });

    it('pins nothing that has since disappeared', () => {
        const gone = [...UNVOUCHED.keys()].filter((c) => !found.has(c));
        expect(gone.map((c) => `0x${c.toString(16)}`)).toEqual([]);
    });

    it('covers 47 jobs', () => {
        expect([...found.values()].reduce((n, a) => n + a.length, 0)).toBe(47);
    });

    it('refuses all of them, rather than trusting the name', () => {
        // `_LESEN` is German for read. It does not mean the byte on the wire is
        // a read, and this is the assertion that keeps those two apart.
        const byId = new Map(profiles.map(([id, p]) => [id, new Map(p.jobs.map((j) => [j.id, j]))]));
        for (const [, list] of found) {
            for (const ref of list) {
                const mid = ref.slice(0, ref.indexOf('.'));
                const jid = ref.slice(ref.indexOf('.') + 1);
                const table = telegrams.get(mid)!;
                const tel = { hex: table.jobs[jid][0].hex, confidence: 'single' as const };
                const v = mayRun(byId.get(mid)!.get(jid)!, tel as never, EMPTY_LEDGER, { moduleId: mid });
                expect(v.allowed, ref).toBe(false);
            }
        }
    });
});
