import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CatalogJob, EcuProfile } from './ecuCatalog';
import {
    ECU_TIMEOUT_MS,
    STATUS_INTERVAL_MS,
    decodeTestStatus,
    finishedWell,
    planProcedure,
    stillRunning,
} from './procedureRun';
import { practiceEcu } from './practiceEcu';
import type { Smg2Procedure, Smg2Workflows } from './smg2Workflows';
import type { TelegramTable } from './telegrams';

const DATA = path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data');
const read = <T,>(f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf-8')) as T;

const profile = read<EcuProfile>('smg2.jobs.json');
const telegrams = read<TelegramTable>('smg2.telegrams.json');
const workflows = read<Smg2Workflows>('smg2-workflows.json');
const jobs = new Map<string, CatalogJob>(profile.jobs.map((j) => [j.id, j]));
const proc = (id: string) => workflows.procedures.find((p) => p.id === id) as Smg2Procedure;

const plan = (over: Partial<Parameters<typeof planProcedure>[0]> = {}) =>
    planProcedure({ procedure: proc('0x01'), jobs, telegrams, mode: 'practice', ...over });

describe('the cadence', () => {
    it('re-sends well inside the ECU timeout the SGBD states', () => {
        // "(Steuergeraete-Timeout: 10s!)" appears on four of these jobs. A
        // status interval anywhere near it would make one late tick a dropped
        // session rather than late news.
        expect(ECU_TIMEOUT_MS).toBe(10_000);
        expect(STATUS_INTERVAL_MS).toBeLessThan(ECU_TIMEOUT_MS / 4);
    });
});

describe('planning a procedure', () => {
    it('refuses on a vehicle, and says that is why', () => {
        // TESTPRG_STARTEN is not a read and 0x32 is not in READ_ONLY_CONTROLS.
        // The plan reports the refusal rather than building a frame nobody may
        // send — there is no second opinion here about what reaches a car.
        const r = plan({ mode: 'vehicle' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('proc_block_vehicle');
    });

    it('sends STOP before START, because the ECU requires it', () => {
        // "Muss VOR TESTPRG_STARTEN geschickt werden!"
        const r = plan();
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.plan.stopHex).toBe('32 04 33 05');
        expect(r.plan.startHex).toBe('32 06 32 01 00 07');
    });

    it('carries the procedure’s own TESTPRG_NR, not a neighbour’s', () => {
        const a = plan({ procedure: proc('0x01') });
        const b = plan({ procedure: proc('0x02') });
        expect(a.ok && b.ok && a.plan.startHex).not.toBe(b.ok && b.plan.startHex);
    });

    it('takes the duration from the SGBD table rather than a timer of ours', () => {
        const r = plan();
        expect(r.ok && r.plan.durMaxSec).toBe(proc('0x01').durMaxSec);
    });

    it('demands a gear for the one procedure that selects one', () => {
        const gear = workflows.procedures.find((p) => p.auswahl) as Smg2Procedure;
        expect(gear, 'the shipped data must still have an auswahl procedure').toBeTruthy();
        const missing = plan({ procedure: gear });
        expect(missing.ok === false && missing.reason).toBe('proc_block_selection');

        const ok = plan({ procedure: gear, selection: 3 });
        expect(ok.ok).toBe(true);
        if (ok.ok) expect(ok.plan.startHex.split(' ')[4]).toBe('03');
    });

    it('refuses a gear outside 0..7 — neutral, six gears, reverse', () => {
        const gear = workflows.procedures.find((p) => p.auswahl) as Smg2Procedure;
        for (const bad of [-1, 8, 1.5, 255]) {
            const r = plan({ procedure: gear, selection: bad });
            expect(r.ok === false && r.reason, String(bad)).toBe('proc_block_selection');
        }
    });

    it('refuses a selection for a procedure that takes none', () => {
        // "Alle anderen Testprg benoetigen kein Auswahlbyte." Quietly ignoring
        // it would put a byte on the wire the ECU was never told to expect.
        const r = plan({ procedure: proc('0x01'), selection: 2 });
        expect(r.ok === false && r.reason).toBe('proc_block_selection');
    });

    it('refuses when the module has no such job', () => {
        const r = plan({ jobs: new Map() });
        expect(r.ok === false && r.reason).toBe('proc_block_noJob');
    });

    it('refuses when the frames are not there', () => {
        const r = plan({ telegrams: null });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('argframe_noTemplate');
    });

    it('plans every one of the fourteen shipped procedures', () => {
        // If this ever thins out, a procedure has lost its frame and the wizard
        // would offer a step it cannot take.
        let planned = 0;
        for (const p of workflows.procedures) {
            const r = planProcedure({
                procedure: p,
                jobs,
                telegrams,
                mode: 'practice',
                selection: p.auswahl ? 0 : undefined,
            });
            expect(r.ok, p.id).toBe(true);
            planned++;
        }
        expect(planned).toBe(14);
    });
});

describe('reading the status back', () => {
    it('takes the status from the first payload byte', () => {
        const r = decodeTestStatus('01 05 20');
        expect(r).toEqual({ statusByte: 1, infoByte: 5, infoByte2: 0x20, provenance: 'inferred' });
    });

    it('marks itself inferred, because that is what it is', () => {
        // The SGBD names the positions in the specification's numbering, not
        // ours. Reading "Byte 5 (Lastenheft)" as payload index 1 is a reading of
        // a document, and the wizard prints the raw bytes beside the decode
        // until a bench session turns it into a measurement.
        expect(decodeTestStatus('02')?.provenance).toBe('inferred');
    });

    it('reports absent bytes as absent rather than as zero', () => {
        expect(decodeTestStatus('02')).toEqual({
            statusByte: 2,
            infoByte: null,
            infoByte2: null,
            provenance: 'inferred',
        });
    });

    it('refuses anything that is not a payload', () => {
        expect(decodeTestStatus('')).toBeNull();
        expect(decodeTestStatus('zz')).toBeNull();
        expect(decodeTestStatus('1ff')).toBeNull();
    });
});

describe('when to stop asking', () => {
    it('keeps going only while the status is 1', () => {
        // "Job solange anstossen, bis dieses Result ungleich 1 liefert!"
        expect(stillRunning(0x01)).toBe(true);
        for (const b of [0x00, 0x02, 0x03, 0xff]) expect(stillRunning(b), String(b)).toBe(false);
    });

    it('treats "test condition not met" as an answer, not as a reason to wait', () => {
        // 0x00 ends the run. It is the ECU saying no, and asking again would be
        // a spinner that never resolves.
        expect(stillRunning(0x00)).toBe(false);
        expect(finishedWell(0x00)).toBe(false);
    });

    it('calls only 0x02 a good ending', () => {
        expect(finishedWell(0x02)).toBe(true);
        for (const b of [0x00, 0x01, 0x03, 0xff]) expect(finishedWell(b), String(b)).toBe(false);
    });

    it('has a name for every status the SGBD publishes', () => {
        // The four codes plus 0xFF, straight out of STATTESTTEXTE. If the table
        // grows a code, the wizard must have a word for it before it can show it.
        const codes = workflows.testStatus.map((s) => s.code);
        expect(codes).toEqual(['0x00', '0x01', '0x02', '0x03', '0xFF']);
    });
});

describe('the simulator speaks the same protocol', () => {
    const ask = (ecu: ReturnType<typeof practiceEcu>, control: number, payload: number[] = []) =>
        ecu.respond!({ address: 0x12, controlOrStatus: control, payload: new Uint8Array(payload) } as never);

    it('answers TESTPRG_STARTEN with a status the decoder can read', () => {
        const ecu = practiceEcu();
        const a = ask(ecu, 0x32, [0x01, 0x00]);
        const decoded = decodeTestStatus([...(a!.payload ?? [])].map((b) => b.toString(16).padStart(2, '0')).join(' '));
        expect(decoded?.statusByte).toBe(0x01);
        expect(stillRunning(decoded!.statusByte)).toBe(true);
    });

    it('reports finished after a bounded number of asks, so a run ends', () => {
        // A simulator that says "running" forever is a simulator the wizard can
        // only ever be aborted out of, and the finish path would never execute.
        const ecu = practiceEcu();
        let last = 0;
        for (let i = 0; i < 20; i++) last = ask(ecu, 0x32, [0x01, 0x00])!.payload![0];
        expect(finishedWell(last)).toBe(true);
    });

    it('lets TESTPRG_STOP reset the run — the ECU’s own rule, not a convenience', () => {
        const ecu = practiceEcu();
        for (let i = 0; i < 20; i++) ask(ecu, 0x32, [0x01, 0x00]);
        expect(finishedWell(ask(ecu, 0x32, [0x01, 0x00])!.payload![0])).toBe(true);
        expect(ask(ecu, 0x33)).toBeNull(); // bare ACK, no payload declared
        expect(stillRunning(ask(ecu, 0x32, [0x01, 0x00])!.payload![0])).toBe(true);
    });

    it('fabricates no second infobyte', () => {
        // On procedure 0x04 that byte carries a pre-charge pressure. A simulated
        // 0 bar would be a measurement this app has no business producing, so
        // the payload is two bytes and stops.
        expect(ask(practiceEcu(), 0x32, [0x04, 0x00])!.payload!.length).toBe(2);
    });
});
