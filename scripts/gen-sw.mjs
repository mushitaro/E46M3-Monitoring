/**
 * Turns scripts/sw.template.js into out/sw.js, with this build's file list and a cache name
 * derived from this build's contents.
 *
 * Ported from E46M3CSL_TuningTool. Runs after `next build` and after `build-id.mjs` (see
 * package.json). After the build because the thing it is listing is the export itself — the hashed
 * chunk names under `_next/static/` do not exist until the build has produced them. After the
 * stamp because it hashes the bytes it is about to cache, and a stamp written afterwards would
 * ship under the previous build's cache name, leaving the device serving the older HTML from disk.
 *
 * ## The cache name is a content hash, not a version or a git sha
 *
 * A git sha changes on every commit, including ones that do not change a single byte of the
 * output, and each change throws away a cache the car has already downloaded over a garage's WiFi.
 * A hand-maintained version number changes when somebody remembers. Hashing the bytes that are
 * actually being cached makes the name change exactly when the contents do, which is the only rule
 * that is both automatic and correct.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const OUT = 'out';
const TEMPLATE = join('scripts', 'sw.template.js');
const CACHE_PREFIX = 'e46m3mon-';

/**
 * Not precached, each for its own reason:
 *
 *   sw.js          the worker cannot be one of its own assets
 *   version.json   build-id.mjs writes it for the deploy verifier, which fetches it from the
 *                  network on purpose. A cached copy would answer "which build is deployed" with
 *                  whatever was deployed last time, which is the one wrong answer that matters.
 *   *.map          source maps are for a debugger on a desk, not for a car
 *   .well-known/*  reserved for host-level verification files that the browser fetches outside
 *                  this scope. Nothing uses it today; the exclusion is here so that adding one
 *                  later does not silently enter the precache.
 *
 * The tuner also excluded /CNAME. There is none here — this app has no GitHub Pages deployment
 * (CLAUDE.md), so the rule would guard a file that cannot exist.
 */
const isAsset = (url) =>
    url !== '/sw.js' &&
    url !== '/version.json' &&
    !url.endsWith('.map') &&
    !url.startsWith('/.well-known/');

function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

const paths = walk(OUT).sort();

/**
 * `{ url, bytes }` rather than a bare url, so the worker can report a download the page can show.
 *
 * The size has to come from here. The worker could read `content-length` off each response instead,
 * but that is the COMPRESSED length where the host compresses and the decoded length where it does
 * not, so a total summed from it would be a different number from the bytes that actually arrive,
 * and the bar would end somewhere other than 100 %. The on-disk size is what the browser hands the
 * worker after decoding, on every host, which makes it the only total the parts can be counted
 * against.
 *
 * Counting files instead of bytes was the other option and it is not close: the ECU catalogue is a
 * handful of files that dwarf the rest, so a file-counted bar would sit still and then jump.
 */
const assets = paths
    .map((path) => ({ url: '/' + relative(OUT, path).split(sep).join('/'), path }))
    .filter(({ url }) => isAsset(url))
    .map(({ url, path }) => ({ url, bytes: statSync(path).size }));

if (!assets.some(({ url }) => url === '/index.html')) {
    // Without the document there is no offline app, only a cache. Fail here rather than ship a
    // worker that installs cleanly and serves nothing.
    throw new Error('gen-sw: out/index.html is missing — did next build run?');
}

// Every document in the export, so the worker's navigate branch can resolve a deep link to the
// right one instead of always answering with the shell. See sw.template.js.
const documents = assets.map(({ url }) => url).filter((url) => url.endsWith('.html'));

// Hash the bytes, in a fixed order, with the name alongside the content so that moving a file to a
// new path counts as a change even if its bytes do not.
const digest = createHash('sha256');
for (const path of paths) {
    const url = '/' + relative(OUT, path).split(sep).join('/');
    if (!isAsset(url)) continue;
    digest.update(url);
    digest.update(readFileSync(path));
}
const cacheName = `${CACHE_PREFIX}${digest.digest('hex').slice(0, 12)}`;

const worker = readFileSync(TEMPLATE, 'utf8')
    .replace("'__CACHE_NAME__'", JSON.stringify(cacheName))
    .replace('__DOCUMENTS__', JSON.stringify(documents, null, 4))
    .replace('__ASSETS__', JSON.stringify(assets, null, 4));

for (const placeholder of ['__CACHE_NAME__', '__ASSETS__', '__DOCUMENTS__']) {
    // A template whose placeholder silently survived produces a worker that throws on load, which
    // presents as "the app has no offline cache" with nothing pointing here.
    if (worker.includes(placeholder)) throw new Error(`gen-sw: ${placeholder} was not substituted`);
}

writeFileSync(join(OUT, 'sw.js'), worker);

const bytes = assets.reduce((sum, { bytes: n }) => sum + n, 0);

console.log(
    `gen-sw: ${assets.length} assets (${documents.length} documents), ` +
    `${(bytes / 1024 / 1024).toFixed(1)} MB, cache ${cacheName}`
);
