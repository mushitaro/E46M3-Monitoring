// `e46.intake-check.v1`: the report E46 /// MONITORING writes after scanning every module of a car,
// and that a Mainstay's E46 /// MAINTENANCE imports as a source. Shared by both tools, so it is one
// file that depends on zod alone: E46 /// MAINTENANCE keeps the same bytes as
// `packages/contract/src/intakeCheck.ts`, and a change is made here and copied there.
//
// How it travels (operator, 2026-11-10, D5 and D6): a person presses SEND in MONITORING once. The
// report goes, by postMessage, to the MAINTENANCE tab that opened MONITORING, and MONITORING stays
// in front; MAINTENANCE checks its shape, matches the VIN on its server, keeps the report by its
// SHA-256 like any other source, and puts the findings in as proposals that nothing decides until a
// person signs. When no MAINTENANCE tab answers, the same JSON is saved as a file instead. The AI
// never carries it: the assistant's tools neither return it nor send it, and what a MAINTENANCE AI
// sees of it is a projection without the VIN and the modules' identification.
//
// Every field that MONITORING cannot know is null rather than guessed: an odometer it did not read,
// a VIN it did not see, an identification field a module did not answer in the common layout.

import { z } from 'zod';

export const INTAKE_CHECK_SCHEMA = 'e46.intake-check.v1';
export const INTAKE_HANDOFF_PROTOCOL = 'e46.intake-handoff.v1';

/** Bytes as compact lowercase hex, as they were read. */
const hex = z.string().regex(/^(?:[0-9a-f]{2})*$/);
const address = z.string().regex(/^0x[0-9A-F]{2}$/);
const vin = z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/);
/** The last seven characters of a VIN as BMW modules keep them: two letters, five digits. */
const vinShort = z.string().regex(/^[A-HJ-NPR-Z]{2}[0-9]{5}$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const nonce = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/**
 * A module's answer to the common DS2 IDENT (`<addr> 04 00`), and the fields read from it.
 *
 * `layout: 'ds2-common'`: read where the group files read them (part number at bytes 3..9,
 * hardware number 10..11, diagnosis index 14..15, D_0012 and D_0032) and where the DS2 IDENT
 * answer carries the coding index (12..13). Not checked module by module against each SGBD's own
 * IDENT job, so a field that is not printable text there is null, and `raw` stays the answer.
 * The software number has no fixed place in that layout: null.
 */
export const intakeIdent = z
    .object({
        partNo: z.string().max(40).nullable(),
        hw: z.string().max(40).nullable(),
        sw: z.string().max(40).nullable(),
        codingIndex: z.string().max(20).nullable(),
        diagIndex: z.string().max(20).nullable(),
        layout: z.enum(['ds2-common']).nullable(),
        /** The whole answer frame (address, length, status, data, checksum). */
        raw: hex.max(512),
    })
    .strict();

/** One address the scan asked, and what answered. */
export const intakeModule = z
    .object({
        address,
        /** The module's name as the app lists it; null when the app carries no module at the address. */
        name: z.string().max(80).nullable(),
        /** The SGBD chosen from the module's IDENT (or, on an M3, the one the address is fitted with). Null: `?`. */
        sgbd: z.string().min(1).max(40).nullable(),
        /** The app's module for that SGBD. Null while it is not known, or the app does not carry it. */
        variant: z.string().min(1).max(40).nullable(),
        /** On what ground the fault read went: its IDENT chose it, or the M3's fitment (no rule, an M3). */
        basis: z.enum(['identified', 'm3-fitment']).nullable(),
        /**
         * answered: it answered every frame. identified: it answered its IDENT and nothing more was
         * sent (`?`, or a module the app does not carry). silent: no answer. rejected: a refusal.
         * refused: the app held it back. skipped: the scan stopped before it.
         */
        outcome: z.enum(['answered', 'identified', 'silent', 'rejected', 'refused', 'skipped']),
        ident: intakeIdent.nullable(),
        /** The fault-read answers as read, in the order sent: what a later decoder reads again. */
        faultRaw: z.array(hex.max(4096)).max(8),
        reason: z.string().max(200).nullable(),
    })
    .strict();

/** One fault-memory entry. `text` comes from the module's own fault-text table. */
export const intakeFinding = z
    .object({
        id: z.string().min(1).max(80),
        address,
        code: z.string().min(1).max(20),
        text: z.string().max(200).nullable(),
        /** Whether it is present now or stored from before. `unknown` where the decoder does not say. */
        state: z.enum(['present', 'stored', 'unknown']),
        count: z.number().int().nonnegative().nullable(),
        /** True until this module's decoding has been checked on a real car. */
        unverified: z.boolean(),
        /** The answer it was decoded from, as read, kept so a later decoder can read it again. */
        raw: hex.max(4096),
    })
    .strict();

export const intakeReading = z
    .object({
        name: z.string().min(1).max(80),
        value: z.union([z.number(), z.string().max(80)]),
        unit: z.string().max(20).nullable(),
    })
    .strict();

export const intakeCheckReport = z
    .object({
        schema: z.literal(INTAKE_CHECK_SCHEMA),
        /** Made when the report is written; the same scan written twice is two reports. */
        id: z.string().uuid(),
        producer: z
            .object({
                app: z.string().min(1).max(80),
                build: z.string().min(1).max(80),
                /** Which generated SGBD set the scan used, so a report can be read against it later. */
                sgbdSet: z.string().min(1).max(80),
            })
            .strict(),
        /** PRACTICE: the simulator answered, not a car. A store never imports one into a vehicle. */
        practice: z.boolean(),
        /** The vehicle profile the scan found: the SGBDs at 0x12 (engine) and 0x32 (gearbox). */
        profile: z.object({ engine: z.string().max(20).nullable(), gearbox: z.string().max(20).nullable() }).strict(),
        measuredAt: z.string().datetime({ offset: true }),
        /**
         * Whose clock `measuredAt` is on. `server`: the page had heard the server's time. `device`:
         * it had not, and a head unit's clock can be years off.
         */
        clock: z.enum(['server', 'device']),
        scan: z
            .object({
                startedAt: z.string().datetime({ offset: true }),
                /** done, or why it ended early: the person stopped it, the line was lost. */
                end: z.enum(['done', 'not-parked', 'stopped', 'link-lost']),
            })
            .strict(),
        /** Not read by the scan: null. */
        odometerKm: z.number().int().nonnegative().nullable(),
        /**
         * Only for the store to match the car: the VIN as the bytes the scan read spelled it, when
         * exactly one was found. Never shown to an AI, never published; the store keeps the report
         * under its hash and strips the VIN from every row it derives.
         */
        vin: vin.nullable(),
        /** The short form modules keep (the VIN's last seven), when exactly one was found. */
        vinShort: vinShort.nullable(),
        modules: z.array(intakeModule).max(80),
        findings: z.array(intakeFinding).max(500),
        readings: z.array(intakeReading).max(100),
    })
    .strict();
export type IntakeCheckReport = z.infer<typeof intakeCheckReport>;
export type IntakeModule = z.infer<typeof intakeModule>;
export type IntakeFinding = z.infer<typeof intakeFinding>;
export type IntakeIdent = z.infer<typeof intakeIdent>;

// ---- The handoff: MONITORING's tab and the MAINTENANCE tab that opened it -----------------------
//
//   MONITORING                              MAINTENANCE (window.opener)
//     hello {nonce}            ───────▶     (shows nothing, comes to no front)
//                              ◀───────     ready {nonce, accepts, ref?}
//     report {nonce, json, sha256, ref}  ─▶ checks the shape, matches the VIN on its server
//                              ◀───────     received {nonce, sha256} | refused {nonce, reason}
//
// Every message names its counterpart: MONITORING posts with the registered origin as targetOrigin
// and reads only messages whose origin is registered and whose source is its opener; MAINTENANCE
// reads only MONITORING's origin. `json` is the report's text, so the hash both sides compute is of
// the same bytes, and the file saved when no tab answers is that text too.

const reason = z.enum(['vin-mismatch', 'vin-missing', 'practice', 'invalid', 'busy', 'other']);

export const handoffHello = z.object({ protocol: z.literal(INTAKE_HANDOFF_PROTOCOL), type: z.literal('hello'), nonce }).strict();
export const handoffReady = z
    .object({
        protocol: z.literal(INTAKE_HANDOFF_PROTOCOL),
        type: z.literal('ready'),
        nonce,
        accepts: z.array(z.string().max(40)).max(8),
        /** MAINTENANCE's own reference for the car page that opened MONITORING, echoed back with the report. */
        ref: z.string().max(80).nullable().optional(),
    })
    .strict();
export const handoffReport = z
    .object({
        protocol: z.literal(INTAKE_HANDOFF_PROTOCOL),
        type: z.literal('report'),
        nonce,
        ref: z.string().max(80).nullable(),
        sha256,
        /** The report as JSON text (`intakeCheckReport`), at most 1 MB. */
        json: z.string().max(1_000_000),
    })
    .strict();
export const handoffReceived = z
    .object({ protocol: z.literal(INTAKE_HANDOFF_PROTOCOL), type: z.literal('received'), nonce, sha256 })
    .strict();
export const handoffRefused = z
    .object({
        protocol: z.literal(INTAKE_HANDOFF_PROTOCOL),
        type: z.literal('refused'),
        nonce,
        reason,
        sha256: sha256.optional(),
    })
    .strict();
export type HandoffRefusal = z.infer<typeof reason>;

/** What MAINTENANCE answers with: the first message's shape it parses as, or null. */
export const handoffAnswer = z.discriminatedUnion('type', [handoffReady, handoffReceived, handoffRefused]);
export type HandoffAnswer = z.infer<typeof handoffAnswer>;
