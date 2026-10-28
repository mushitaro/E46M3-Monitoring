/**
 * D1 for tests: the members functions/_lib/sync.ts declares, over Node's own SQLite, with this
 * repository's migrations applied in order — so a route and the desk Worker are tested against the
 * schema they will meet, not a hand-written imitation of it.
 *
 * `node:sqlite` is loaded through `createRequire` because this repository's @types/node predates it;
 * the few members used are typed here.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { D1Database, D1PreparedStatement, D1Result } from '../../../functions/_lib/sync';

interface Statement {
    all(...values: unknown[]): Record<string, unknown>[];
    get(...values: unknown[]): Record<string, unknown> | undefined;
    run(...values: unknown[]): { changes: number | bigint };
}
interface Database {
    exec(sql: string): void;
    prepare(sql: string): Statement;
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => Database };

const MIGRATIONS = path.resolve(import.meta.dirname, '../../../migrations');

/** D1 hands a BLOB back as bytes and takes one as a Uint8Array; SQLite needs a Buffer-like view. */
const bind = (values: unknown[]) => values.map((v) => (v === undefined ? null : v));

function statement(db: Database, sql: string, values: unknown[] = []): D1PreparedStatement {
    return {
        bind: (...next: unknown[]) => statement(db, sql, next),
        first: async <T>() => (db.prepare(sql).get(...bind(values)) as T | undefined) ?? null,
        all: async <T>() => ({ results: db.prepare(sql).all(...bind(values)) as T[], meta: { changes: 0 } }) as D1Result<T>,
        run: async () => {
            const r = db.prepare(sql).run(...bind(values));
            return { results: [], meta: { changes: Number(r.changes) } };
        },
    };
}

/** A fresh database with every migration applied, and the raw handle for a test's own queries. */
export function sqliteD1(): { d1: D1Database; db: Database } {
    const db = new DatabaseSync(':memory:');
    for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
        db.exec(readFileSync(path.join(MIGRATIONS, f), 'utf-8'));
    }
    return { d1: { prepare: (sql) => statement(db, sql) }, db };
}
