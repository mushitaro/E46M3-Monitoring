import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The engine is a part another app takes in (GREN BLUE SUITE, as a git submodule in its npm
 * workspaces; docs/ENGINE.md). What makes that possible is held here, not by convention:
 *
 *   - nothing in the package reaches into the app — no `@/…`, no relative path out of the package
 *     (the other app has no `src/` of ours to find), only the sibling DS2 packages by name;
 *   - React is imported by the thin hook (`react.ts`) alone, so the main entry runs without it;
 *   - every relative import names its `.ts` file, and the code is erasable TypeScript only, so Node
 *     itself loads it (GREN BLUE's `node --test`, type stripping; the package's tsconfig has
 *     `erasableSyntaxOnly` and `verbatimModuleSyntax`, as GREN BLUE's do);
 *   - no Next.js, and no screen: the engine has no words of its own for a person to read beyond the
 *     log's and the refusals' English, which the screens put in their own language.
 */
const SRC = import.meta.dirname;

function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const p = path.join(dir, name);
        return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
    });
}

// A module name or path, not any quoted text: a regex literal in a test (`from '([^']+)'`) is not an import.
const SPECIFIER = /(?:from\s+|import\s*\(\s*|^import\s+)['"]([\w@./:-]+)['"]/gm;

describe('the engine stands on its own', () => {
    const all = files(SRC).filter((f) => !f.endsWith('boundary.test.ts'));

    it('imports nothing of the app, and nothing outside itself but the DS2 packages and zod', () => {
        const problems: string[] = [];
        for (const f of all) {
            for (const m of readFileSync(f, 'utf-8').matchAll(SPECIFIER)) {
                const spec = m[1];
                const where = path.relative(SRC, f);
                if (spec.startsWith('@/')) problems.push(`${where}: ${spec}`);
                else if (spec.startsWith('.')) {
                    const target = path.resolve(path.dirname(f), spec);
                    if (path.relative(SRC, target).startsWith('..')) problems.push(`${where}: ${spec} leaves the package`);
                } else if (!/^(@tsunagi\/ds2-(core|mss54)|react|vitest|zod|node:[a-z]+)$/.test(spec)) {
                    problems.push(`${where}: ${spec}`);
                }
            }
        }
        expect(problems).toEqual([]);
    });

    it('keeps React to the thin hook', () => {
        const withReact = all.filter((f) => /from\s+['"]react['"]/.test(readFileSync(f, 'utf-8'))).map((f) => path.relative(SRC, f));
        expect(withReact).toEqual(['react.ts']);
    });

    it('keeps test helpers out of the main entry', () => {
        const index = readFileSync(path.join(SRC, 'index.ts'), 'utf-8');
        expect(index).not.toMatch(/testing\//);
        expect(index).not.toMatch(/['"]\.\/react['"]/);
    });

    it('names the .ts file in every relative import', () => {
        const bare: string[] = [];
        for (const f of all) {
            for (const m of readFileSync(f, 'utf-8').matchAll(SPECIFIER)) {
                if (m[1].startsWith('.') && !m[1].endsWith('.ts')) bare.push(`${path.relative(SRC, f)}: ${m[1]}`);
            }
        }
        expect(bare).toEqual([]);
    });

    it('loads in Node itself, with no bundler — the way GREN BLUE’s node --test reads it', () => {
        const run = spawnSync(
            process.execPath,
            ['--input-type=module', '-e', `const m = await import(${JSON.stringify(new URL('./index.ts', import.meta.url).href)}); console.log(typeof m.LinkSession, typeof m.buildIntakeCheck, typeof m.configureEcuData);`],
            { encoding: 'utf-8', timeout: 60_000 },
        );
        expect(run.stderr).toBe('');
        expect(run.stdout.trim()).toBe('function function function');
    }, 60_000);
});
