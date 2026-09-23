/**
 * Checks the export before it is allowed to be deployed.
 *
 * Everything here is a failure that has actually happened to one of these apps, or that the build
 * pipeline's ordering makes possible. They share a shape: the build reports success, the artefact
 * is wrong, and nothing says so until a device is in a garage.
 *
 * Runs last in `npm run build`, after build-id.mjs and gen-sw.mjs.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const OUT = 'out';
const rows = [];
const check = (name, ok, detail) => rows.push({ name, ok: !!ok, detail: String(detail ?? '') });

function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

if (!existsSync(OUT)) {
    console.error(`[FATAL] ${OUT}/ does not exist. Run \`next build\` first.`);
    process.exit(1);
}

const files = walk(OUT);
const urls = files.map((p) => '/' + relative(OUT, p).split(sep).join('/'));
const documents = urls.filter((u) => u.endsWith('.html'));

// ---- 1. the service worker exists and is fully substituted --------------------------------
const swPath = join(OUT, 'sw.js');
check('sw.js exists', existsSync(swPath), swPath);
const sw = existsSync(swPath) ? readFileSync(swPath, 'utf8') : '';
// The owner gate's own routes and the SYNC API must never be answered from the cache — and the
// bypass has to come BEFORE the navigate branch, or /_gate/start is served the app shell.
const bypassAt = sw.indexOf("url.pathname.startsWith('/_gate/')");
check('sw.js lets /_gate/* and /api/* through to the network, ahead of navigations',
    bypassAt > 0 && sw.includes("url.pathname.startsWith('/api/')") && bypassAt < sw.indexOf("request.mode === 'navigate'"), '');
for (const placeholder of ['__CACHE_NAME__', '__ASSETS__', '__DOCUMENTS__']) {
    // A surviving placeholder produces a worker that throws on load. The page then simply has no
    // offline cache, and nothing in the UI distinguishes that from "not installed yet".
    check(`sw.js has no ${placeholder}`, sw && !sw.includes(placeholder), '');
}

// ---- 2. the cache name is this app's, and shaped like a content hash -----------------------
// A prefix-blind check is how a rename gets deployed unnoticed: the old app's verifier only
// compared the trailing hash, so `oldbmw-diag-<hash>` passed a check meant to prove the rename.
const cacheName = (sw.match(/const CACHE = ['"]([^'"]+)['"]/) || [])[1];
check('sw.js cache name is e46m3mon-<12 hex>', /^e46m3mon-[0-9a-f]{12}$/.test(cacheName || ''), cacheName || '(none)');

// ---- 3. the asset list is a list of assets -------------------------------------------------
let assets = [];
try {
    assets = JSON.parse((sw.match(/const ASSETS = (\[[\s\S]*?\n\]);/) || [])[1] || '[]');
} catch { /* reported by the checks below */ }
check('ASSETS is non-empty', assets.length > 0, `${assets.length} entries`);
check('ASSETS contains /index.html', assets.some((a) => a.url === '/index.html'), '');
check('ASSETS excludes sw.js', !assets.some((a) => a.url === '/sw.js'), '');
check('ASSETS excludes version.json', !assets.some((a) => a.url === '/version.json'),
    'the deploy verifier fetches it from the network; a cached copy answers with the previous build');
check('ASSETS excludes source maps', !assets.some((a) => a.url.endsWith('.map')), '');
check('every ASSETS entry exists on disk',
    assets.every((a) => urls.includes(a.url)), '');
// Behind the gate an unexpected redirect is a failed install (sw.template.js `isGenuine`), so a
// document is fetched from the URL the host serves without one, and kept under its own key.
check('every document is fetched from its extensionless URL',
    assets.filter((a) => a.url.endsWith('.html')).every((a) => typeof a.fetch === 'string' && !a.fetch.endsWith('.html')),
    assets.filter((a) => a.url.endsWith('.html')).map((a) => `${a.url}←${a.fetch}`).join(', '));
check('ASSETS excludes Pages configuration', !assets.some((a) => ['/_headers', '/_routes.json', '/_redirects'].includes(a.url)),
    'the host never serves these, and one unanswerable entry fails the whole install');
check('every ASSETS entry carries its byte size',
    assets.every((a) => Number.isInteger(a.bytes) && a.bytes >= 0),
    'the install progress bar is fed from these, not from content-length');

// ---- 4. every exported document is reachable through the worker ----------------------------
let swDocuments = [];
try {
    swDocuments = JSON.parse((sw.match(/const DOCUMENTS = (\[[\s\S]*?\n\]);/) || [])[1] || '[]');
} catch { /* reported below */ }
const missingDocs = documents.filter((d) => !swDocuments.includes(d));
check('DOCUMENTS lists every exported .html', missingDocs.length === 0,
    missingDocs.length ? missingDocs.join(', ') : `${swDocuments.length} documents`);

// This is the assertion that settles which filename shape Next emitted for a second route, rather
// than the worker assuming one. A route the worker cannot resolve is served the shell instead —
// silently, which on /usb-check means the diagnostic page shows the app it was meant to diagnose.
for (const route of ['/usb-check']) {
    const shapes = [`${route}/index.html`, `${route}.html`];
    const found = shapes.filter((s) => documents.includes(s));
    // Only assert a route the build actually emitted. Keying this on the document COUNT instead
    // was wrong from the first run: the export carries /404.html and /_not-found.html from the
    // start, so the count is never 1 and the check demanded a route that does not exist yet.
    if (found.length === 0) continue;
    check(`route ${route} resolves to exactly one document`,
        found.length === 1 && swDocuments.includes(found[0]), found[0]);
}

// ---- 5. exactly one build-id per document --------------------------------------------------
// Measured on the tuner's preview: two build-id metas, the stale one first, which is the one every
// reader takes — including the deploy readback, which then reported the previous build as live.
for (const doc of documents) {
    const html = readFileSync(join(OUT, doc.slice(1)), 'utf8');
    const n = (html.match(/<meta name="build-id"/g) || []).length;
    check(`exactly one build-id in ${doc}`, n === 1, `${n} found`);
}

// ---- 6. version.json agrees with what was stamped ------------------------------------------
const vPath = join(OUT, 'version.json');
check('version.json exists', existsSync(vPath), vPath);
if (existsSync(vPath) && documents.length) {
    const v = JSON.parse(readFileSync(vPath, 'utf8'));
    const html = readFileSync(join(OUT, 'index.html'), 'utf8');
    const stamped = (html.match(/name="build-id" content="([^"]*)"/) || [])[1];
    check('version.json buildId matches the stamped document', v.buildId === stamped,
        `${v.buildId} vs ${stamped}`);
}

// ---- 7. the icons, in every variant --------------------------------------------------------
// tsunagi-m-release §4.1: a maskable icon is its own file, scaled into the circle a launcher crops
// to. The same file declared as `any` AND `maskable` has its ends cut off on every round-mask
// home screen — measured on a sibling app, where the mark lost 66 px each side.
const manifestPath = join(OUT, 'manifest.webmanifest');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { icons: [] };
const icons = manifest.icons ?? [];
const anySrc = new Set(icons.filter((i) => (i.purpose ?? 'any').split(/\s+/).includes('any')).map((i) => i.src));
const maskable = icons.filter((i) => (i.purpose ?? '').split(/\s+/).includes('maskable'));
check('manifest declares maskable icons', maskable.length > 0, `${maskable.length}`);
check('no maskable entry reuses an "any" file',
    maskable.every((i) => !anySrc.has(i.src) && /-maskable-/.test(i.src)),
    maskable.map((i) => i.src).join(', '));
const missingIcons = icons.filter((i) => !urls.includes(i.src)).map((i) => i.src);
check('every manifest icon exists in out/', missingIcons.length === 0, missingIcons.join(', ') || `${icons.length} icons`);
check('short_name is 12 characters or fewer', (manifest.short_name ?? '').length <= 12, manifest.short_name);

/** The icon files a document names: <link rel="icon" | "apple-touch-icon" …>. */
const linkedIcons = (html) =>
    [...html.matchAll(/<link[^>]*rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*>/g)]
        .map((m) => (m[0].match(/href="([^"]+)"/) || [])[1])
        .filter(Boolean);

// ---- 8. a branded build is branded all the way through ------------------------------------
// Only when brand-preview.mjs ran (the documents carry app-variant). A production build carries
// none, and must not: production is the build nobody branded.
const variants = new Set();
for (const doc of documents) {
    const html = readFileSync(join(OUT, doc.slice(1)), 'utf8');
    const tags = [...html.matchAll(/<meta name="app-variant" content="([^"]*)"/g)].map((m) => m[1]);
    if (tags.length > 1) check(`at most one app-variant in ${doc}`, false, `${tags.length} found`);
    tags.forEach((v) => variants.add(v));
    // The shared upload token is retired. A build that still embeds one publishes a write key.
    check(`no sync-token meta in ${doc}`, !/<meta name="sync-token"/.test(html), '');
}
if (variants.size > 0) {
    const [variant] = variants;
    const label = variant.toUpperCase();
    check('one app-variant across every document', variants.size === 1 && documents.every((d) =>
        readFileSync(join(OUT, d.slice(1)), 'utf8').includes(`<meta name="app-variant" content="${variant}">`)),
        [...variants].join(', '));
    check(`manifest name ends " — ${label}"`, (manifest.name ?? '').endsWith(` — ${label}`), manifest.name);
    check(`manifest short_name starts "${label[0]} "`, (manifest.short_name ?? '').startsWith(`${label[0]} `), manifest.short_name);
    check('every manifest icon is from the dev set', icons.every((i) => /-dev-/.test(i.src)),
        icons.filter((i) => !/-dev-/.test(i.src)).map((i) => i.src).join(', ') || 'all -dev-');

    const referenced = new Set(['/manifest.webmanifest', ...icons.map((i) => i.src)]);
    const stale = [];
    for (const file of files.filter((p) => /\.(html|txt)$/.test(p))) {
        const text = readFileSync(file, 'utf8');
        if (file.endsWith('.html')) linkedIcons(text).forEach((h) => referenced.add(h));
        // A production icon still named anywhere comes back on the first client-side navigation.
        const withoutDev = text.replace(/\/icons\/[a-z0-9-]+?-dev-(?:maskable-)?\d+\.png/g, '');
        if (/\/icons\/[a-z0-9-]+?-(?:maskable-)?\d+\.png/.test(withoutDev)) {
            stale.push('/' + relative(OUT, file).split(sep).join('/'));
        }
    }
    check('no document or payload names a production icon', stale.length === 0, stale.join(', ') || 'none');
    const notDev = [...referenced].filter((h) => h !== '/manifest.webmanifest' && !/-dev-/.test(h));
    check('every linked icon is from the dev set', notDev.length === 0, notDev.join(', ') || 'all -dev-');
    const absent = [...referenced].filter((h) => !urls.includes(h));
    check('every referenced icon exists in out/', absent.length === 0, absent.join(', ') || `${referenced.size} files`);

    // The browser fetches the manifest and its icons WITHOUT cookies. The gate lets through only
    // what functions/_middleware.ts lists, so a referenced icon missing there installs iconless.
    const mw = existsSync('functions/_middleware.ts') ? readFileSync('functions/_middleware.ts', 'utf8') : '';
    const notPublic = [...referenced].filter((h) => !mw.includes(`'${h}'`));
    check('the gate serves every referenced icon without a session', notPublic.length === 0,
        notPublic.join(', ') || `${referenced.size} public paths`);
}

// ---- report ---------------------------------------------------------------------------------
const width = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}`);
const failed = rows.filter((r) => !r.ok).length;
console.log(failed === 0
    ? `[verify-export] ${rows.length} checks, all pass`
    : `[verify-export] ${failed} of ${rows.length} checks FAILED`);
process.exit(failed === 0 ? 0 : 1);
