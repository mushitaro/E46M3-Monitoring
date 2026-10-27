import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDE_TOOL, MONITORING_TOOLS } from './toolNames';

/**
 * The examples in scenarios/ evaluate the guide and the desk; they are not written into either.
 * What is checked here is only that they still point at things that exist — a topic the guide
 * dropped, a tool the tab renamed or a capability nobody declared would leave an example measuring
 * nothing. Whether an assistant answers them well is judged elsewhere (docs/AUTONOMY.md §3).
 */

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const readJson = (p: string) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf-8'));

interface Case {
    id: string;
    type: string;
    words: string;
    context: string;
    entry: string;
    topics: string[];
    tools: string[];
    never: string[];
    answered: string;
    needs: string[];
}

const { nevers, cases } = readJson('scenarios/cases.json') as { nevers: Record<string, string>; cases: Case[] };
const capabilities = readJson('scenarios/capabilities.json') as Record<string, { status: string; what: string; where: string }>;
delete (capabilities as Record<string, unknown>)._comment;
const topics = readdirSync(path.join(ROOT, 'public', 'guide'))
    .filter((f) => f.endsWith('.md') && f !== 'index.md')
    .map((f) => f.replace(/\.md$/, ''));

/** The cycle in public/guide/index.md; '-' is a request that sits outside it (save, autonomy, a tool fault). */
const ENTRIES = ['symptom', 'hypothesis', 'evidence', 'plan', 'execution', 'judgement', 'next-step', 'countermeasure', '-'];
const CONTEXTS = ['parked', 'moving', 'desk'];

describe('the examples', () => {
    it('are named once each and say what answering means', () => {
        const ids = cases.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const c of cases) {
            expect(c.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
            expect(c.words.trim(), c.id).not.toBe('');
            expect(c.answered.trim(), c.id).not.toBe('');
            expect(CONTEXTS, `${c.id} context`).toContain(c.context);
            expect(ENTRIES, `${c.id} entry`).toContain(c.entry);
        }
    });

    it('point only at guide topics, tools, rules and capabilities that exist', () => {
        const tools = new Set<string>([...Object.keys(MONITORING_TOOLS), GUIDE_TOOL]);
        for (const c of cases) {
            for (const t of c.topics) expect(topics, `${c.id} topic`).toContain(t);
            for (const t of c.tools) expect(tools.has(t), `${c.id} tool ${t}`).toBe(true);
            for (const n of c.never) expect(Object.keys(nevers), `${c.id} never`).toContain(n);
            for (const n of c.needs) expect(Object.keys(capabilities), `${c.id} needs`).toContain(n);
        }
    });

    it('need the bridge whenever they are answered through a tool', () => {
        for (const c of cases.filter((x) => x.tools.length > 0)) expect(c.needs, c.id).toContain('bridge');
    });

    it('reach every topic of the guide, and every rule is used', () => {
        const reached = new Set(cases.flatMap((c) => c.topics));
        for (const t of topics) expect(reached.has(t), `no example reads ${t}`).toBe(true);
        const used = new Set(cases.flatMap((c) => c.never));
        for (const n of Object.keys(nevers)) expect(used.has(n), `no example tests ${n}`).toBe(true);
    });
});

describe('the capabilities', () => {
    it('have a status and say where it comes from', () => {
        for (const [k, v] of Object.entries(capabilities)) {
            expect(['car', 'built', 'missing'], k).toContain(v.status);
            expect(v.what.trim(), k).not.toBe('');
            expect(v.where.trim(), k).not.toBe('');
        }
    });

    it('cite only files that exist in this repository', () => {
        for (const [k, v] of Object.entries(capabilities)) {
            for (const m of v.where.matchAll(/\b((?:src|packages|public|tools|docs)\/[\w./-]+\.\w+)/g)) {
                expect(existsSync(path.join(ROOT, m[1])), `${k} cites ${m[1]}`).toBe(true);
            }
        }
    });
});
