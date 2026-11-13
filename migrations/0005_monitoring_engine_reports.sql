-- Engine reports from the Mainstays, as they reach the desk (workers/desk/src/inbox.ts; operator 2026-11-11/12).
--
-- A store that runs this repository's diagnostic engine in its own app (GREN BLUE SUITE is the
-- first) sends the engine's errors — refused telegrams, answers the engine cannot read, faults with
-- no text, exceptions — to M's platform (the engine door, `POST /engine/report`), already redacted
-- on the store's server (no VIN, name, contact, cost, free text or identification answer). The door
-- redacts again, counts, and hands each report to the desk's inbox (`POST /inbox/engine-report`),
-- where it becomes a question for the desk, so the autonomous loop fixes the engine for every
-- entrance at once.
--
-- Numbered 0005: 0004 is taken by the relay's development tickets (PR #42). Either may land first;
-- wrangler applies whichever it has not applied, by name.
--
-- This file was first written for the engine gateway (workers/engine-gateway), which was never
-- deployed and whose migration was never applied anywhere; it was rewritten in place when the
-- gateway's door moved to the platform (feat/desk-inbox): the key gained `entrance`.

-- The platform's delivery tickets that were used: one row per ticket nonce, kept until the ticket
-- has expired. No store, no content.
CREATE TABLE monitoring_engine_report_nonce (
    n    TEXT PRIMARY KEY,
    exp  INTEGER NOT NULL
);
CREATE INDEX monitoring_engine_report_nonce_exp ON monitoring_engine_report_nonce (exp);

-- One row per kind of error, per entrance, per Mainstay, keyed by the store's fingerprint. An
-- entrance is one of a store's own apps (its SUITE, its demo), each counting for itself. `total` is
-- the store's own count; `last_delivery` (`<fingerprint>.<total>`) makes a delivery the door sends
-- again after a lost answer a no-op. `record` / `ask_entry` / `asked_at` say which CO-WORK question
-- the desk was given; a question is asked once per (Mainstay, fingerprint), whichever entrance.
CREATE TABLE monitoring_engine_reports (
    mainstay       TEXT NOT NULL,
    entrance       TEXT NOT NULL,
    fingerprint    TEXT NOT NULL,
    kind           TEXT NOT NULL,
    report         TEXT NOT NULL,
    total          INTEGER NOT NULL,
    first_seen     TEXT NOT NULL,
    last_seen      TEXT NOT NULL,
    last_delivery  TEXT NOT NULL,
    received_at    INTEGER NOT NULL,
    record         TEXT NOT NULL,
    ask_entry      TEXT,
    asked_at       INTEGER,
    PRIMARY KEY (mainstay, entrance, fingerprint)
);
CREATE INDEX monitoring_engine_reports_asked ON monitoring_engine_reports (mainstay, fingerprint, asked_at);
