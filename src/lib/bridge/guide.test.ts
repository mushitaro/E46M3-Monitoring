import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDE_TOPICS, loadGuide } from './guide';
import { GUIDE_TOOL, MONITORING_TOOLS, helloTools } from './tools';

/**
 * The procedure the voice assistant follows (`monitoring_guide`), checked the way the relay will
 * check it and against the tools the tab declares.
 *
 * The relay refuses a hello whose guide breaks its limits (matrix-tsunagi 0.11.0: index and each
 * topic ≤ 16 KB, ≤ 16 topics, ≤ 160 KB in all, topic names ^[a-z0-9][a-z0-9-]{0,31}$). A refused
 * hello leaves the assistant with the previous guide, or none — so the limits are a build failure
 * here rather than a surprise in the car.
 */

const DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'public', 'guide');
const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));
const read = (f: string) => readFileSync(path.join(DIR, f), 'utf-8');
const bytes = (s: string) => Buffer.byteLength(s, 'utf-8');
const index = read('index.md');
const topics = files.filter((f) => f !== 'index.md').map((f) => f.replace(/\.md$/, ''));

describe('the guide fits what the relay accepts', () => {
    it('keeps every part and the whole within the limits', () => {
        expect(bytes(index)).toBeLessThanOrEqual(16 * 1024);
        expect(topics.length).toBeLessThanOrEqual(16);
        for (const t of topics) {
            expect(t, 'topic name').toMatch(/^[a-z0-9][a-z0-9-]{0,31}$/);
            const body = read(`${t}.md`);
            expect(body.trim().length, `${t} is empty`).toBeGreaterThan(0);
            expect(bytes(body), `${t}.md`).toBeLessThanOrEqual(16 * 1024);
        }
        const total = bytes(index) + topics.reduce((n, t) => n + bytes(read(`${t}.md`)), 0);
        expect(total).toBeLessThanOrEqual(160 * 1024);
    });

    it('declares exactly the topics there are', () => {
        expect([...GUIDE_TOPICS].sort()).toEqual([...topics].sort());
    });

    it('loads as the hello carries it, with a version that follows the text', async () => {
        const serve = (edit = '') =>
            (async (url: string) => new Response(read(String(url).replace('./guide/', '')) + edit)) as unknown as typeof fetch;
        const a = await loadGuide(serve());
        const b = await loadGuide(serve(' '));
        expect(a.index).toBe(index);
        expect(Object.keys(a.topics).sort()).toEqual([...topics].sort());
        expect(a.version).toMatch(/^[0-9a-f]{8}$/);
        expect(b.version).not.toBe(a.version);
    });

    it('lists exactly the topics there are, each with when to read it', () => {
        const listed = [...index.matchAll(/^- \*\*([a-z0-9-]+)\*\* — .+読むとき：/gm)].map((m) => m[1]);
        expect(listed.sort()).toEqual([...topics].sort());
    });
});

describe('the tools fit what the relay accepts', () => {
    it('keeps names, descriptions, schemas and the whole within its rules', () => {
        const tools = helloTools();
        expect(tools.length).toBeLessThanOrEqual(64);
        expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
        for (const t of tools) {
            expect(t.name).toMatch(/^monitoring_[a-z0-9_]{1,52}$/);
            expect(t.name).not.toBe(GUIDE_TOOL);
            expect(t.description.trim().length, t.name).toBeGreaterThan(0);
            expect(bytes(t.description), t.name).toBeLessThanOrEqual(4 * 1024);
            expect(t.inputSchema.type).toBe('object');
            expect(['read', 'control']).toContain(t.scope);
        }
        expect(bytes(JSON.stringify(tools))).toBeLessThanOrEqual(64 * 1024);
    });
});

describe('the guide names only tools the tab has', () => {
    it('mentions no monitoring_* tool missing from the registry', () => {
        const known = new Set<string>([...Object.keys(MONITORING_TOOLS), GUIDE_TOOL]);
        for (const f of files) {
            for (const m of read(f).matchAll(/`(monitoring_[a-z0-9_]+)`/g)) {
                expect(known.has(m[1]), `${f} names ${m[1]}`).toBe(true);
            }
        }
    });

    it('keeps the house rules the relay and the tab enforce in its preamble', () => {
        // Advisory text, but the lines a reader must not miss: the tab enforces these, and the guide
        // must not tell the assistant otherwise.
        for (const rule of ['画面で人が', '送ってよいかはタブが決める', '復唱', 'ドライバーの言葉がログに勝つ']) {
            expect(index, rule).toContain(rule);
        }
    });
});
