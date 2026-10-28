#!/usr/bin/env node
// ============================================================================
//  desk-token.mjs — the desk's tokens: issue one, list them, revoke one
// ----------------------------------------------------------------------------
//  Run by the operator, on the machine where wrangler is signed in, from this
//  repository's root (wrangler finds the database through ./wrangler.jsonc):
//
//    node scripts/desk-token.mjs issue <label> [--days 30]
//    node scripts/desk-token.mjs list
//    node scripts/desk-token.mjs revoke <id>
//
//  `issue` prints the token on stdout and nothing else, ONCE: only its SHA-256
//  is kept (monitoring_desk_tokens), so it cannot be shown again. Put it where
//  the desk reads it — the cloud environment's MONITORING_DESK_TOKEN — and
//  nowhere else: not in a chat, not in a file in this public repository.
//  Every token expires (30 days unless told otherwise, 90 at most); a new one
//  is issued before the old one runs out, and the old one is then revoked.
// ============================================================================
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const DB = 'tsunagi-m-preview-runs';
const DAY = 86_400_000;

function d1(sql) {
    const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', sql], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        shell: process.platform === 'win32',
    });
    return JSON.parse(out)[0]?.results ?? [];
}

const fail = (msg) => {
    console.error(msg);
    process.exit(1);
};

const [cmd, arg] = process.argv.slice(2);
const daysAt = process.argv.indexOf('--days');
const days = daysAt > 0 ? Number(process.argv[daysAt + 1]) : 30;

if (cmd === 'issue') {
    if (!/^[a-z0-9-]{1,32}$/.test(arg ?? '')) fail('usage: issue <label>   (a-z, 0-9, -; e.g. loop, pc-desk)');
    if (!Number.isInteger(days) || days < 1 || days > 90) fail('--days must be 1-90');
    const token = `desk_${randomBytes(30).toString('base64url')}`;
    const hash = createHash('sha256').update(token).digest('hex');
    const id = `tok-${randomBytes(6).toString('hex')}`;
    const now = Date.now();
    d1(`INSERT INTO monitoring_desk_tokens (id, hash, label, created_at, expires_at, revoked_at) VALUES ('${id}', '${hash}', '${arg}', ${now}, ${now + days * DAY}, NULL)`);
    console.error(`issued ${id} (${arg}), expires ${new Date(now + days * DAY).toISOString()}. The token follows on stdout; it is not kept anywhere.`);
    process.stdout.write(token + '\n');
} else if (cmd === 'list') {
    for (const r of d1('SELECT id, label, created_at, expires_at, revoked_at FROM monitoring_desk_tokens ORDER BY created_at')) {
        const state = r.revoked_at ? 'revoked' : r.expires_at < Date.now() ? 'expired' : 'live';
        console.log(`${r.id}  ${r.label.padEnd(12)}  ${state.padEnd(8)}  expires ${new Date(r.expires_at).toISOString()}`);
    }
} else if (cmd === 'revoke') {
    if (!/^tok-[0-9a-f]{12}$/.test(arg ?? '')) fail('usage: revoke <id>   (tok-…, from `list`)');
    d1(`UPDATE monitoring_desk_tokens SET revoked_at = ${Date.now()} WHERE id = '${arg}' AND revoked_at IS NULL`);
    console.error(`revoked ${arg}`);
} else {
    fail('usage: node scripts/desk-token.mjs issue <label> [--days 30] | list | revoke <id>');
}
