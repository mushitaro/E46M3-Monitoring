-- Engine reports from the Mainstays (workers/engine-gateway, M's engine door for Mainstays; operator 2026-11-11/12).
--
-- A store that runs this repository's diagnostic engine in its own app (GREN BLUE SUITE is the
-- first) sends the engine's errors here — refused telegrams, answers the engine cannot read, faults
-- with no text, exceptions — already redacted on the store's server (no VIN, name, contact, cost,
-- free text or identification answer). They become questions for the desk, so the autonomous loop
-- fixes the engine for every entrance at once.
--
-- Numbered 0005: 0004 is taken by the relay's development tickets (PR #42). Either may land first;
-- wrangler applies whichever it has not applied, by name.

-- The store tickets that were used: one row per ticket nonce, kept until the ticket has expired.
-- No store, no content.
CREATE TABLE monitoring_engine_report_nonce (
    n    TEXT PRIMARY KEY,
    exp  INTEGER NOT NULL
);
CREATE INDEX monitoring_engine_report_nonce_exp ON monitoring_engine_report_nonce (exp);

-- One row per kind of error per Mainstay, keyed by the store's fingerprint. `total` is the store's
-- own count; `last_delivery` (`<fingerprint>.<total>`) makes a delivery retried after a lost answer
-- a no-op. `record` / `ask_entry` / `asked_at` say which CO-WORK question the desk was given.
CREATE TABLE monitoring_engine_reports (
    mainstay       TEXT NOT NULL,
    fingerprint    TEXT NOT NULL,
    entrance       TEXT NOT NULL,
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
    PRIMARY KEY (mainstay, fingerprint)
);
