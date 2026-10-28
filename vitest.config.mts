import { defineConfig } from 'vitest/config';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Test files that read the private, BMW-derived data in public/ecu-data, found by what they say
 * rather than listed — a list here would be one more copy to fall behind (shippedData.test.ts
 * makes the same argument about vocabularies). A file that names the folder reads it.
 *
 * On a clone without the data (it lives in E46M3-Monitoring-data, docs/PRESERVED.md) they are left
 * out and the run says so, instead of failing with ENOENT for a reason that is about the machine
 * and not the code. Newer tests guard themselves per block through src/lib/testing/shipped.ts and
 * are not affected. CI and cloud sessions place the data (.claude/hooks/session-start.sh), so there
 * every file runs.
 */
const ROOT = import.meta.dirname;
const HAVE_DATA = existsSync(path.join(ROOT, 'public', 'ecu-data', 'index.json'));

function testFilesNamingTheData(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...testFilesNamingTheData(p));
        else if (e.name.endsWith('.test.ts') && /['"]ecu-data['"]/.test(readFileSync(p, 'utf-8'))) {
            out.push(path.relative(ROOT, p).split(path.sep).join('/'));
        }
    }
    return out;
}

const NEEDS_DATA = HAVE_DATA ? [] : testFilesNamingTheData(path.join(ROOT, 'src'));
if (NEEDS_DATA.length > 0) {
    console.warn(
        `[vitest] public/ecu-data is not here, so ${NEEDS_DATA.length} test file(s) that read it are skipped:\n  ` +
            NEEDS_DATA.join('\n  '),
    );
}

// .mts, not .ts: the repo's package.json has no "type": "module", so a .ts
// config is loaded as CommonJS and Vite warns that its ESM syntax will stop
// working. The explicit extension is the fix that does not change how every
// other file in the repo is interpreted.
export default defineConfig({
    resolve: {
        alias: {
            '@tsunagi/ds2-core': path.resolve(import.meta.dirname, 'packages/ds2-core/src/index.ts'),
            '@tsunagi/ds2-mss54': path.resolve(import.meta.dirname, 'packages/ds2-mss54/src/index.ts'),
            '@': path.resolve(import.meta.dirname, 'src'),
        },
    },
    test: {
        // The codec is pure and needs no DOM. Anything that does (hooks, the
        // transport) gets its own environment when it arrives — a browser-ish
        // global soup here would let a "pure" module quietly start depending on
        // one.
        environment: 'node',
        include: ['packages/**/*.test.ts', 'src/**/*.test.ts', 'workers/**/*.test.ts'],
        exclude: ['**/node_modules/**', ...NEEDS_DATA],
    },
});
