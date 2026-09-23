/**
 * What the two SYNC routes share: the binding, the request shape Pages hands a handler, and the
 * few byte-level checks both make before anything reaches D1.
 *
 * Who a row belongs to is NOT decided here. It comes from `ownerOf(context.data)` — the account the
 * owner gate resolved for this request — and each handler reads it itself, first, so that a route
 * whose owner check was forgotten is visible in the route rather than hidden behind a helper.
 *
 * The D1 types are the handful of members these routes call, declared here rather than taken from
 * @cloudflare/workers-types: the root tsconfig compiles functions/ alongside the app with the DOM
 * library, and the Workers globals declare the same names differently.
 */

export interface D1Result<T> {
    results: T[];
    meta: { changes: number };
}

export interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
    run(): Promise<D1Result<unknown>>;
}

export interface D1Database {
    prepare(sql: string): D1PreparedStatement;
}

export interface Env {
    RUNS_DB: D1Database;
}

export interface SyncContext {
    request: Request;
    env: Env;
    data: Record<string, unknown>;
    params: Record<string, string | string[]>;
}

/**
 * A row id the client minted. Opaque to the server, but shaped: an id is a URL path segment on the
 * way back, and a key a person may read in a list, so it is kept to characters that are both.
 */
export const isRowId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);

export function paramId(ctx: SyncContext): string | null {
    const raw = ctx.params.id;
    const id = Array.isArray(raw) ? raw[0] : raw;
    return isRowId(id) ? id : null;
}

export function decodeBase64(b64: string): Uint8Array {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function encodeBase64(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

/** The gzip magic. The blob columns hold compressed JSON and nothing else. */
export const isGzip = (b: Uint8Array) => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;

/**
 * A BLOB as D1 hands it back. The runtime has returned these as a plain array of numbers and as an
 * ArrayBuffer at different times; both are accepted rather than one assumed.
 */
export function blobBytes(v: unknown): Uint8Array | null {
    if (v == null) return null;
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (Array.isArray(v)) return Uint8Array.from(v as number[]);
    return null;
}

/** A gzip blob sent as base64: decoded and checked, or the reason it was refused. */
export function gzipField(b64: unknown, name: string): Uint8Array | string {
    if (typeof b64 !== 'string' || b64.length === 0) return `${name} is required.`;
    let bytes: Uint8Array;
    try {
        bytes = decodeBase64(b64);
    } catch {
        return `${name} is not valid base64.`;
    }
    return isGzip(bytes) ? bytes : `${name} is not gzip data.`;
}

export const optText = (v: unknown, max = 200): string | null =>
    typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;

export const optInt = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null;
