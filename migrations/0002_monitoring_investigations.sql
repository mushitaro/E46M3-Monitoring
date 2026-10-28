-- What the WORKS build sends by itself beyond error records, and the desk that reads part of it.
--
-- The privacy policy (m3 /privacy-policy#preview) names each of these: read records, sent success
-- or failure (「読み取りの記録」); and the CO-WORK record and PROBE runs of an investigation the owner
-- handed over, sent only while it is handed over (「調査の記録」「調査の委任」). The same rules as
-- 0001 hold: every table is `monitoring_`-prefixed (the database is shared with M35080), `owner` is
-- the m3 account the gate resolved and is NOT NULL, and every query from functions/api carries
-- `owner = ?`.
--
-- The desk (workers/desk) reads these across owners, but only what lib/investigation/share.ts says
-- a standing mandate covers, and never the owner id or a VIN. Every call it answers leaves a row in
-- monitoring_desk_audit.

-- CO-WORK entries of delegated investigations. Entries never change (lib/notebook/rules), so a row
-- is written once; the same id again is the same entry.
CREATE TABLE monitoring_notebook (
    id         TEXT PRIMARY KEY,
    owner      TEXT NOT NULL,
    -- The CO-WORK record (`sessionId` on the device).
    record     TEXT NOT NULL,
    at         INTEGER NOT NULL,
    by         TEXT NOT NULL,
    kind       TEXT NOT NULL,
    -- The entry exactly as written, JSON.
    entry      TEXT NOT NULL,
    synced_at  INTEGER NOT NULL
);

CREATE INDEX monitoring_notebook_record ON monitoring_notebook (owner, record, at);
-- The desk's list of investigations starts from the mandates.
CREATE INDEX monitoring_notebook_kind ON monitoring_notebook (kind, at);

-- PROBE runs of delegated investigations, finished ones only.
CREATE TABLE monitoring_runs (
    id            TEXT PRIMARY KEY,
    owner         TEXT NOT NULL,
    record        TEXT NOT NULL,
    -- 1, 2, 3 … within the record: what a fact's evidence names.
    n             INTEGER NOT NULL,
    plan_v        INTEGER NOT NULL,
    started_at    INTEGER NOT NULL,
    ended_at      INTEGER NOT NULL,
    end_reason    TEXT NOT NULL,
    sample_count  INTEGER NOT NULL,
    mock          INTEGER NOT NULL DEFAULT 0,
    app_build     TEXT,
    synced_at     INTEGER NOT NULL,
    -- The run as the device holds it (lib/probe/runStore `StoredRun`), gzipped JSON.
    run_gz        BLOB NOT NULL
);

CREATE INDEX monitoring_runs_record ON monitoring_runs (owner, record, n);

-- Read records: one row per kind of read per minute (lib/investigation/readRecord `readKey`), real
-- car only — PRACTICE sends nothing to a car, so it has none.
CREATE TABLE monitoring_reads (
    id          TEXT PRIMARY KEY,
    owner       TEXT NOT NULL,
    at          INTEGER NOT NULL,
    synced_at   INTEGER NOT NULL,
    module      TEXT NOT NULL,
    job         TEXT NOT NULL,
    request     TEXT,
    response    TEXT,
    outcome     TEXT NOT NULL,
    reason      TEXT,
    speed_kmh   REAL,
    motion      TEXT NOT NULL,
    app_build   TEXT
);

CREATE INDEX monitoring_reads_owner_at ON monitoring_reads (owner, at);

-- Who may call the desk. Only the SHA-256 of a token is kept; the token itself is shown once, to
-- the person who issued it (scripts/desk-token.mjs). Every token expires; revoking one is a date.
CREATE TABLE monitoring_desk_tokens (
    id          TEXT PRIMARY KEY,
    hash        TEXT NOT NULL UNIQUE,
    label       TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    revoked_at  INTEGER
);

-- Every call the desk answered: which token, what, which record. Written before the answer goes.
CREATE TABLE monitoring_desk_audit (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    at      INTEGER NOT NULL,
    token   TEXT NOT NULL,
    action  TEXT NOT NULL,
    record  TEXT,
    detail  TEXT
);

CREATE INDEX monitoring_desk_audit_at ON monitoring_desk_audit (at);
