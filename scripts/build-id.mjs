/**
 * Stamps every exported document with a build id you can say out loud, and writes
 * `out/version.json` so the deploy verifier can compare what is served against what was built.
 *
 * Ported from E46M3CSL_TuningTool. Its prose is kept in English because it is the record of
 * incidents measured on that deployment, and a translation of a measurement is a paraphrase of
 * evidence. Where this copy diverges, the reason is written next to the divergence.
 *
 * ## Why this is not the service worker's cache name
 *
 * `gen-sw.mjs` names the cache after a hash of the built bytes, and its reasoning is right: the
 * cache must be invalidated exactly when the contents change, never on a commit that changed no
 * output. That makes `e46m3mon-2e5ca880d950` a correct cache key and a useless build number — you
 * cannot tell whether it is newer than `e46m3mon-7bedb7d1bbef`, and it points at no commit.
 *
 * Those are two different questions, so they get two different values. This one answers "which
 * build is this, and where did it come from".
 *
 * ## The format: `<count>.<sha>`, e.g. `55.eec48b9`
 *
 * `git rev-list --count HEAD` is monotonic on a linear history, which this repo has, so a larger
 * number is a later build and the phone can be compared against the desk by eye. The short sha is
 * what turns the number back into a diff. A `+` suffix marks a build made with uncommitted changes —
 * which is most of them during development, and is exactly the thing you want to know before
 * trusting a number that looks like a commit.
 *
 * NOTE for this repository: the history was rewritten on 2026-09-03 to remove the SGBD-derived
 * tables from every commit (docs/PRESERVED.md). The COUNT survived intact — no commit became empty
 * — so the number line is continuous. Every short sha recorded before that date is unresolvable.
 *
 * ## The comparison holds within a branch, and NOT across them
 *
 * There is one branch here today, so the number is a straight ordering. If a squashed release
 * branch is ever added, main would count releases while development counts commits, and the two
 * numbers would be different number lines entirely. Read the sha, not the number alone, whenever
 * two builds could have come from different branches.
 *
 * Falls back to `dev` when git is unavailable rather than failing the build: a build id is a
 * convenience, and refusing to produce a deployable export because `git` is missing would not be.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const OUT = 'out';

// Kept from this repository's previous version. `next build` failing and this script then stamping
// nothing is a build that reports success and ships no id at all.
if (!existsSync(join(OUT, 'index.html'))) {
    console.error(`[FATAL] ${OUT}/index.html is missing. Run \`next build\` first.`);
    process.exit(1);
}

function git(args) {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function buildId() {
    try {
        const count = git(['rev-list', '--count', 'HEAD']);
        const sha = git(['rev-parse', '--short', 'HEAD']);
        // `--porcelain` is empty exactly when the tree is clean. Untracked files count: a build can
        // depend on a file that was never added, and a number that hid that would be lying.
        //
        // In this repository the working tree is normally dirty by design — public/ecu-data/ and
        // tools/terms/ are present locally and gitignored — so `+` is the expected state for a real
        // deploy rather than a warning sign. It still means exactly what it says.
        const dirty = git(['status', '--porcelain']).length > 0 ? '+' : '';
        return `${count}.${sha}${dirty}`;
    } catch {
        return 'dev';
    }
}

function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

const id = buildId();
// ISO to the minute. Seconds add noise to something read by a human comparing two devices.
const at = new Date().toISOString().slice(0, 16) + 'Z';

let patched = 0;
for (const path of walk(OUT)) {
    if (extname(path) !== '.html') continue;
    const html = readFileSync(path, 'utf8');
    if (!html.includes('</head>')) continue;
    // STRIP FIRST, then insert. `out/` is not guaranteed to be a fresh export — Next can leave an
    // unchanged document in place, and another session building in this checkout can leave one
    // behind entirely — so an insert-only stamp appends a SECOND tag to a document that already had
    // one. Measured on the tuner's preview deployment: two `build-id` metas, the stale one first,
    // which is the one every reader takes; the deploy readback then reported the previous build.
    //
    // This replaced a version that instead REFUSED to run twice. That turns the same situation into
    // a failed build rather than a wrong stamp — safer, but it stops the deploy on a condition that
    // is normal, and a build step that cries wolf gets removed rather than heeded.
    writeFileSync(path, html
        .replace(/<meta name="build-(?:id|at)" content="[^"]*"\s*\/?>/g, '')
        .replace(
            /<\/head>/,
            `<meta name="build-id" content="${id}"><meta name="build-at" content="${at}"></head>`,
        ));
    patched++;
}

if (patched === 0) {
    console.error('[FATAL] no document carried a </head> to stamp. Nothing would say which build this is.');
    process.exit(1);
}

// scripts/verify-deploy.mjs reads this back and compares it against the meta tag it fetched from
// the live URL. Without a local record there is nothing to compare against — the verifier could
// only confirm that SOME build is deployed, which is the question it exists not to settle that way.
writeFileSync(
    join(OUT, 'version.json'),
    JSON.stringify({ buildId: id, builtAt: at, documents: patched }, null, 2) + '\n',
);

// Deliberately after the documents exist and BEFORE gen-sw.mjs runs. gen-sw hashes the bytes it is
// about to cache, so a stamp written after it would ship under the previous build's cache name and
// the device would keep serving the older HTML from disk.
console.log(`[build-id] ${id} (${at}) -> ${patched} document(s)`);
