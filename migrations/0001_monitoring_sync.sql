-- The preview's SYNC store: saved sessions and automatic error records, per owner.
--
-- The database is SHARED. `tsunagi-m-preview-runs` also holds the M35080 tool's tables, which is
-- why everything here is prefixed `monitoring_` and why this file's name is not a bare `0001_*.sql`:
-- wrangler records applied migrations by file name in one `d1_migrations` table per database, so
-- two repositories both shipping `0001_init.sql` would each see the other's as already applied.
-- Nothing in this file touches a table it did not create.
--
-- `owner` is the m3 account id the owner gate resolved for the request that wrote the row
-- (functions/_owner-gate/owner.ts). It is NOT NULL from the start: these tables are new, so there
-- is no legacy row to adopt and no window in which a row could be written without one. Every
-- query in functions/api/ carries `owner = ?`, and the index below is the shape they all take.

CREATE TABLE monitoring_sessions (
    id            TEXT PRIMARY KEY,
    owner         TEXT NOT NULL,
    label         TEXT NOT NULL,
    -- When the session was saved on the device, and when it reached here. Both kept: they differ
    -- whenever the phone was offline in the garage, and choosing one loses the other.
    created_at    INTEGER NOT NULL,
    synced_at     INTEGER NOT NULL,
    ecu           TEXT,
    -- PRACTICE. A simulated session listed beside real ones without saying so is worse than none.
    mock          INTEGER NOT NULL DEFAULT 0,
    -- NULL = fault memory was not read in this session, which is not the same as zero faults.
    fault_count   INTEGER,
    sample_count  INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    app_build     TEXT,
    -- The session exactly as the device's IndexedDB holds it, as gzipped JSON. The list never
    -- reads it; only GET /api/sessions/:id does.
    session_gz    BLOB NOT NULL
);

CREATE INDEX monitoring_sessions_owner_created ON monitoring_sessions (owner, created_at DESC);

CREATE TABLE monitoring_diagnostics (
    id          TEXT PRIMARY KEY,
    owner       TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    synced_at   INTEGER NOT NULL,
    ecu         TEXT,
    -- What was being attempted, in the caller's words ("Read fault memory", "Connect", …). Stated
    -- by the caller rather than inferred from the payload, because a failed connect has no payload.
    job         TEXT NOT NULL,
    error       TEXT,
    error_kind  TEXT,
    transport   TEXT,
    mock        INTEGER NOT NULL DEFAULT 0,
    app_build   TEXT,
    -- gzipped JSON: the ECU identity if one was read, and the comms-log lines around the failure.
    payload_gz  BLOB
);

CREATE INDEX monitoring_diagnostics_owner_created ON monitoring_diagnostics (owner, created_at DESC);
