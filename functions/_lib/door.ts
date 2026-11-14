// What a Mainstay's SERVER needs to use the platform's doors (the engine door and the parts door):
// a v2 ticket for exactly one request, the engine's data bundle read in memory, and what each kind
// of refusal means.
//
// CANONICAL COPY. This file lives in tsunagi-m-platform/gate/server/ and is copied, byte for byte,
// into each Mainstay that calls the doors (GREN BLUE: packages/m-platform/src/door.ts). The app's
// `gate:verify --door <path>` fails when its copy differs. It says, in code with no imports, what
// the platform's contract says with zod: contract/src/tickets.ts (the ticket) and
// contract/src/endpoints/engine.ts (`readEngineBundle`). The platform's tests hold the two
// together (gate/test/door.test.mjs): a ticket minted here passes the doors' own verifier, and
// this reader accepts and refuses exactly the bundles the contract's reader does.
//
// The rules a Mainstay keeps with it (docs/runbook-s5.md §10 of the platform):
//
//   - A key is a secret of the Mainstay's own deployment, one per purpose. It is never sent:
//     each request carries a ticket minted from it, bound to that request, good for 60 seconds.
//   - The engine's data is held ONLY in the server's memory, for the life of a data version —
//     never in a database, a bucket, a KV, a cache, a disk, a build, or a browser cache
//     (`no-store` on the way to the Mainstay's own pages). A new isolate fetches it again.
//   - The bundle is cut by length, never parsed as one JSON document: 7 MB of JSON.parse would
//     spend the Function's CPU allowance.
//   - 429 is "the platform's day is spent, back at 00:00 UTC", never "no". 503 or a page that is
//     not JSON is "could not ask", never "no".
//
// No imports and no runtime types from @cloudflare/workers-types, so the same bytes compile in
// every app whatever its tsconfig.

/** The purposes a Mainstay's server mints for the doors (contract TICKET_PURPOSES, the Mainstay's part). */
export type DoorPurpose = 'engine-data' | 'engine-report' | 'parts' | 'grant';

/** A Mainstay's key for one purpose, as its deployment holds it. */
export interface DoorKey {
  /** The Mainstay's slug: the ticket's `s`. */
  mainstay: string;
  /** The key: 32 random bytes, base64url (43 characters or more). A secret. */
  key: string;
  /** The credential's id (`cred_…`), not a secret. Required while two keys of the purpose are alive. */
  keyId?: string | null;
}

/** How long a ticket lasts. The doors refuse an expiry more than 90 seconds ahead. */
export const TICKET_TTL_S = 60;
const KEY = /^[A-Za-z0-9_-]{43,86}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;
const CREDENTIAL_ID = /^cred_[0-9a-z]{16}$/;

/** Whether a key, a slug and (if given) a key id have the shapes the platform accepts. */
export function doorKeyUsable(k: Partial<DoorKey> | null | undefined): k is DoorKey {
  return (
    !!k &&
    typeof k.mainstay === 'string' &&
    SLUG.test(k.mainstay) &&
    typeof k.key === 'string' &&
    KEY.test(k.key) &&
    (k.keyId === undefined || k.keyId === null || k.keyId === '' || (typeof k.keyId === 'string' && CREDENTIAL_ID.test(k.keyId)))
  );
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(s: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
}

/**
 * `Authorization: Bearer <ticket>` for one request: the method, the URL exactly as it will be
 * sent (its path and query are what the ticket is bound to), and the body exactly as it will be
 * sent ('' for a GET). A ticket fits that request and no other, once, for sixty seconds.
 */
export async function doorAuthorization(k: DoorKey, purpose: DoorPurpose, method: string, url: string, body = '', nowMs = Date.now()): Promise<string> {
  if (!doorKeyUsable(k)) throw new Error('door key is not usable');
  const u = new URL(url);
  const claims: Record<string, unknown> = {
    s: k.mainstay,
    a: purpose,
    ...(k.keyId ? { k: k.keyId } : {}),
    e: Math.floor(nowMs / 1000) + TICKET_TTL_S,
    n: b64url(crypto.getRandomValues(new Uint8Array(18))),
    h: await sha256(`${method.toUpperCase()} ${u.pathname}${u.search}\n${body}`),
  };
  const payload = b64url(enc.encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey('raw', enc.encode(k.key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`v2.${payload}`)));
  return `Bearer v2.${payload}.${b64url(sig)}`;
}

// ── what a door's answer means ──────────────────────────────────────────────────────────────

/**
 * A door's answer that is not a success, read the way the platform means it:
 *
 *   auth          401 — the ticket did not pass (key, purpose, time, binding, clock). Check settings.
 *   suspended     403 — the Mainstay is stopped on the platform.
 *   not_found     404 — no such file in the active version (or no active version).
 *   limited       429, or a page that is not JSON — the day's allowance; `retryAfterS` until 00:00 UTC.
 *   unavailable   503, a network failure, anything else — could not ask. Never "no".
 */
export type DoorFailure =
  | { kind: 'auth' | 'suspended' | 'not_found' | 'unavailable' }
  | { kind: 'limited'; retryAfterS: number };

/** Seconds to the next 00:00 UTC — when the platform's daily allowance comes back. */
export function secondsToUtcMidnight(nowMs = Date.now()): number {
  return Math.max(1, Math.ceil((86_400_000 - (nowMs % 86_400_000)) / 1000));
}

/** What a non-2xx/304 answer of a door means. `bodyText` is the answer's body, read as text. */
export function doorFailureOf(status: number, bodyText: string, nowMs = Date.now()): DoorFailure {
  type Answer = { error?: unknown; retry_after_s?: unknown };
  let body: Answer | null = null;
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    body = parsed !== null && typeof parsed === 'object' ? (parsed as Answer) : null;
  } catch {
    body = null;
  }
  // Cloudflare's own error page (the account's daily request limit, a Worker that ran out of
  // CPU) is not the door speaking: treated as the day's limit, never as a refusal.
  if (body === null) return { kind: 'limited', retryAfterS: secondsToUtcMidnight(nowMs) };
  if (status === 429) {
    const s = typeof body.retry_after_s === 'number' && body.retry_after_s > 0 ? Math.ceil(body.retry_after_s) : secondsToUtcMidnight(nowMs);
    return { kind: 'limited', retryAfterS: s };
  }
  if (status === 401) return { kind: 'auth' };
  if (status === 403) return { kind: 'suspended' };
  if (status === 404) return { kind: 'not_found' };
  return { kind: 'unavailable' };
}

// ── the engine's data, as one bundle ────────────────────────────────────────────────────────
//
//     <header: one line of JSON, UTF-8>\n<the bytes of file 1><the bytes of file 2>…
//
// GET <server>/engine/data/_bundle with an `engine-data` ticket. The answer's ETag is `"<version>"`;
// ask again with If-None-Match and an unchanged version is 304 with no body.

/** The last path segment that asks for the bundle. */
export const ENGINE_DATA_BUNDLE = '_bundle';
/** The response header naming the version of the data set. */
export const ENGINE_DATA_VERSION_HEADER = 'x-m-dataset-version';
/** The names a Mainstay's server may read, and nothing else (contract ENGINE_DATA_FILE; widened 2026-11-14). */
export const ENGINE_DATA_FILE = /^(?:[a-z0-9_]+\.(?:jobs|telegrams|jobtext|hydraulics|results)\.json|index\.json|variants\.json|fault-layouts\.json|smg2-workflows\.json)$/;
const DATASETS = ['e46-diagnosis'];
const HEADER_MAX_BYTES = 262_144;
const VERSION = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface EngineBundleHeader {
  v: 1;
  dataset: string;
  version: string;
  files: { name: string; sha256: string; bytes: number }[];
}

export interface EngineBundle {
  header: EngineBundleHeader;
  /** The bytes of one file, as a view into the bundle (nothing is copied); undefined for a name it does not hold. */
  file(name: string): Uint8Array | undefined;
}

const onlyKeys = (o: Record<string, unknown>, keys: string[]): boolean => Object.keys(o).every((k) => keys.includes(k));
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The header, checked as strictly as the contract's `engineBundleHeader`; null when it is not one. */
function headerOf(v: unknown): EngineBundleHeader | null {
  if (!isObject(v) || !onlyKeys(v, ['v', 'dataset', 'version', 'files'])) return null;
  if (v.v !== 1 || typeof v.dataset !== 'string' || !DATASETS.includes(v.dataset)) return null;
  if (typeof v.version !== 'string' || !VERSION.test(v.version)) return null;
  if (!Array.isArray(v.files) || v.files.length < 1 || v.files.length > 2000) return null;
  const files: EngineBundleHeader['files'] = [];
  for (const f of v.files) {
    if (!isObject(f) || !onlyKeys(f, ['name', 'sha256', 'bytes'])) return null;
    if (typeof f.name !== 'string' || !ENGINE_DATA_FILE.test(f.name)) return null;
    if (typeof f.sha256 !== 'string' || !SHA256_HEX.test(f.sha256)) return null;
    if (typeof f.bytes !== 'number' || !Number.isInteger(f.bytes) || f.bytes < 1 || f.bytes > 64 * 1024 * 1024) return null;
    files.push({ name: f.name, sha256: f.sha256, bytes: f.bytes });
  }
  return { v: 1, dataset: v.dataset, version: v.version, files };
}

/**
 * Read a bundle the server fetched. Null for anything that is not one: a header that does not
 * parse, a name twice, or bytes that are not exactly as long as the header says. Pure: it only
 * cuts the bytes it was given, in memory.
 */
export function readEngineBundle(bytes: Uint8Array): EngineBundle | null {
  const end = bytes.subarray(0, HEADER_MAX_BYTES).indexOf(0x0a);
  if (end < 0) return null;
  let header: EngineBundleHeader | null;
  try {
    header = headerOf(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end))));
  } catch {
    return null;
  }
  if (!header) return null;
  const at = new Map<string, [number, number]>();
  let offset = end + 1;
  for (const f of header.files) {
    if (at.has(f.name)) return null;
    at.set(f.name, [offset, offset + f.bytes]);
    offset += f.bytes;
  }
  if (offset !== bytes.byteLength) return null;
  return {
    header,
    file(name) {
      const span = at.get(name);
      return span ? bytes.subarray(span[0], span[1]) : undefined;
    },
  };
}
