import { defineConfig } from 'vitest/config';
import path from 'node:path';

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
        include: ['packages/**/*.test.ts', 'src/**/*.test.ts'],
    },
});
