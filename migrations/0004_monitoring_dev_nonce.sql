-- The relay's dev tickets that were used (functions/_lib/devTicket.ts): one row per ticket nonce.
--
-- TSUNAGI///Matrix (the relay) hands the operator's words to the development desk when the tab is
-- not there to carry them (POST /api/bridge/dev-request). Each call carries a sixty-second ticket the
-- relay signed; a ticket is good once. A row is kept until its ticket has expired, then deleted on
-- the next call. Nothing else is kept here: no owner, no words.
CREATE TABLE monitoring_dev_nonce (
    n    TEXT PRIMARY KEY,
    exp  INTEGER NOT NULL
);

CREATE INDEX monitoring_dev_nonce_exp ON monitoring_dev_nonce (exp);
