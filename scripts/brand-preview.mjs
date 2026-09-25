/**
 * Brands an exported build as a non-production variant, so an install of it cannot be mistaken for
 * the release — on the home screen, in the install prompt, or in the app's own idea of itself.
 *
 *     node scripts/brand-preview.mjs <out-dir> <variant>        e.g.  out preview
 *
 * Runs AFTER `next build` and `build-id.mjs`, and BEFORE `gen-sw.mjs` (package.json
 * `build:preview`). gen-sw names the cache after a hash of the bytes; brand after it and two builds
 * differing only in branding share a cache name, and a device holding the first keeps serving it.
 *
 * The source — public/manifest.webmanifest and layout.tsx — is PRODUCTION's identity and is never
 * edited for a preview. This patches the bytes the compile produced, the way tsunagi-m-release §4.2
 * lays out, so one compiled output serves every variant and the only thing that differs is here:
 *
 *   manifest.name         += " — <LABEL>"
 *   manifest.short_name    = "<LABEL[0]> <production short_name>"   (the home-screen label)
 *   manifest.description  += " — <LABEL> BUILD, not the production tool."
 *   every icon reference   → the M ICON dev set (white on black), maskable entries included
 *   every .html            : <meta name="app-variant" content="<variant>"> and
 *                            <meta name="app-label" content="<LABEL>">, removed then inserted;
 *                            apple-mobile-web-app-title rewritten where one is present
 *
 * LABEL is not an argument. It is looked up by the variant in scripts/brand-label.mjs
 * (`preview` → WORKS, `staging` → STAGING).
 *
 * theme_color and background_color are the app's ground and stay as they are.
 * <title> is not rewritten, on purpose: tsunagi-m-release §4.2 leaves it as the production name.
 *
 * ## Both arguments are required, and neither has a default
 *
 * A default is the value somebody forgot to pass, and the symptom would be two identically labelled
 * icons — the failure this script exists to prevent. A variant the table does not know is refused,
 * not guessed at. The label it maps to is capped at 12 characters for the same reason Android caps
 * the label: past it, two labels can truncate into one.
 *
 * ## The variant is what the build IS; the label is what it is CALLED
 *
 * The app reads `app-variant` back (src/lib/build-variant.ts), and the preview-only features —
 * SESSIONS, SYNC, the error records — open on the one value `preview`. Production carries no tag at
 * all. That value is compared; the label is only shown — the manifest's names, and the header's
 * badge, which reads `app-label`. So the variant is passed, the label is looked up, and neither is
 * computed from the other.
 *
 * They used to be one value: the argument was the label and the variant was its lower case. The
 * operator renamed the owner build from PREVIEW to WORKS for its users (2026-09-25), and passing
 * WORKS would have stamped `works` and closed every preview-only feature without a word
 * (tsunagi-m-release §5.7). The name changed; the variant, and everything that compares it, did not.
 *
 * ## Why the .txt files too
 *
 * Next's export writes the page's head a second time into its RSC payloads (`__next._head.txt`,
 * `index.txt`). A client-side navigation renders the head from those, so a production icon left in
 * one of them would come back after the first navigation. scripts/verify-export.mjs then refuses a
 * branded build in which any document still names a production icon.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { labelFor } from './brand-label.mjs';

const [OUT, VARIANT] = process.argv.slice(2);
const fail = (msg) => {
    console.error(`[brand-preview] ${msg}`);
    process.exit(1);
};
if (!OUT || !VARIANT) fail('usage: node scripts/brand-preview.mjs <out-dir> <variant>   (both required)');
const LABEL = (() => {
    try {
        return labelFor(VARIANT);
    } catch (e) {
        return fail(e.message);
    }
})();
// The table's entry, held to what the argument used to be held to: past 12 characters two labels can
// truncate into one, and the already-branded test below reads a label as upper-case letters and digits.
if (LABEL.length > 12) fail(`label "${LABEL}" (variant "${VARIANT}") is ${LABEL.length} characters; the limit is 12.`);
if (!/^[A-Z][A-Z0-9]*$/.test(LABEL)) fail(`label "${LABEL}" (variant "${VARIANT}") must be upper-case letters and digits.`);

const manifestPath = join(OUT, 'manifest.webmanifest');
if (!existsSync(manifestPath)) fail(`${manifestPath} is missing — run next build first.`);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// Branding twice would append the label twice. `next build` copies a fresh manifest from public/
// every time, so a manifest that already says it is branded means this out/ was not rebuilt.
if (/ — [A-Z0-9]+$/.test(manifest.name)) fail(`${manifestPath} is already branded ("${manifest.name}"). Rebuild first.`);

/** `/icons/monitoring-192.png` → `/icons/monitoring-dev-192.png`, maskable included. */
const devOf = (src) => {
    const m = src.match(/^\/icons\/([a-z0-9]+(?:-[a-z0-9]+)*?)-((?:maskable-)?\d+\.png)$/);
    if (!m || m[1].endsWith('-dev')) return null;
    return `/icons/${m[1]}-dev-${m[2]}`;
};

// Every production icon in the export, and its dev twin — which must exist, or the branded build
// would point at a file that is not there.
const iconDir = join(OUT, 'icons');
if (!existsSync(iconDir)) fail(`${iconDir} is missing.`);
const swaps = new Map();
for (const name of readdirSync(iconDir)) {
    const src = `/icons/${name}`;
    const dev = devOf(src);
    if (!dev) continue;
    if (!existsSync(join(OUT, dev.slice(1)))) fail(`${src} has no dev counterpart (${dev}).`);
    swaps.set(src, dev);
}
if (swaps.size === 0) fail(`no production icons under ${iconDir} — nothing to brand.`);

// --- The manifest ------------------------------------------------------------------------------
const productionShort = manifest.short_name;
manifest.name = `${manifest.name} — ${LABEL}`;
manifest.short_name = `${LABEL[0]} ${productionShort}`;
if (manifest.short_name.length > 12) fail(`short_name "${manifest.short_name}" is over 12 characters.`);
manifest.description = `${manifest.description} — ${LABEL} BUILD, not the production tool.`;
manifest.icons = manifest.icons.map((icon) => {
    const dev = swaps.get(icon.src);
    if (!dev) fail(`manifest icon ${icon.src} has no dev counterpart.`);
    return { ...icon, src: dev };
});
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// --- Every document and RSC payload ------------------------------------------------------------
function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

const swapIcons = (text) => {
    let out = text;
    for (const [src, dev] of swaps) out = out.split(src).join(dev);
    return out;
};

let documents = 0;
let payloads = 0;
for (const file of walk(OUT)) {
    const ext = extname(file);
    if (ext !== '.html' && ext !== '.txt') continue;
    const before = readFileSync(file, 'utf8');
    let after = swapIcons(before);
    if (ext === '.html') {
        after = after
            .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/g, `$1${manifest.short_name}$2`)
            // Removed, then inserted: out/ is not guaranteed fresh (build-id.mjs records the case),
            // and an insert-only stamp leaves two tags with the stale one first.
            .replace(/<meta name="app-(?:variant|label)" content="[^"]*"\s*\/?>/g, '');
        if (!after.includes('</head>')) fail(`${file} has no </head> to carry app-variant and app-label.`);
        after = after.replace(
            '</head>',
            `<meta name="app-variant" content="${VARIANT}"><meta name="app-label" content="${LABEL}"></head>`,
        );
        documents++;
    } else if (after !== before) {
        payloads++;
    }
    if (after !== before) writeFileSync(file, after);
}

console.log(
    `[brand-preview] ${OUT}: "${manifest.name}" / ${manifest.short_name} / app-variant=${VARIANT} app-label=${LABEL}; ` +
        `${swaps.size} icons → dev set; ${documents} document(s), ${payloads} RSC payload(s) patched`,
);
