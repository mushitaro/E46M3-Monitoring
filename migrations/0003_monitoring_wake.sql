-- When the desk was last woken for a record (functions/_lib/wake.ts): one row per CO-WORK record.
--
-- The WORKS build wakes the autonomous loop the moment a delegated investigation asks something of
-- it — a mandate given, a question put to the desk, a run recorded — instead of leaving it for the
-- next scheduled firing. This table is how that stays a nudge and not a flood: a record wakes the
-- loop at most once in ten minutes, and the account at most twenty times an hour (the scheduled
-- task takes thirty). Only the record id leaves for the loop; what was asked stays here, for the
-- desk to read (workers/desk).
CREATE TABLE monitoring_wake (
    record      TEXT PRIMARY KEY,
    owner       TEXT NOT NULL,
    last_fired  INTEGER NOT NULL,
    reason      TEXT NOT NULL
);

CREATE INDEX monitoring_wake_fired ON monitoring_wake (last_fired);
