import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NATURES, OWNER_DECISION, RUN_BLOCK_STOP, STOP_IDS } from '@tsunagi/monitoring-engine';
import { NATURE_TOOLS, capabilities, capabilitiesMarkdown, moduleRoster, type Capabilities } from './capabilities';
import { MONITORING_TOOLS } from './tools';
import { en } from '../i18n/en';
import { ja } from '../i18n/ja';

/**
 * The assistant's "can you…?" and "why did it stop?" come from the code (owner, 2026-11-26: Chat
 * answered from README and docs, which were older than the code, and said "can't" to what it can).
 *
 * Held here: the answer covers every tool and every kind of job; each kind the owner opened to the
 * assistant names a tool that exists; each refusal is one of the closed list of stops; and
 * docs/CAPABILITIES.md is exactly the answer's text (WRITE_CAPABILITIES=1, npm run gen:capabilities,
 * writes it). Then the retired claims: words that said "can't" under a rule the owner retired must not
 * come back into the files a reader (person or assistant) takes as current.
 */
const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const DOC = path.join(ROOT, 'docs', 'CAPABILITIES.md');

describe('monitoring_capabilities is built from the code', () => {
    const c = capabilities();

    it('names every tool the tab declares', () => {
        const names = new Set(c.tools.map((t) => t.name));
        for (const t of Object.keys(MONITORING_TOOLS)) expect(names.has(t), t).toBe(true);
    });

    it('says every kind of job, as the owner decided it', () => {
        expect(c.owner.map((o) => o.nature)).toEqual(NATURES.map((n) => n.nature));
        for (const o of c.owner) {
            const d = OWNER_DECISION[o.nature];
            expect([o.when, o.how, o.who]).toEqual([d.when, d.how, d.who]);
        }
    });

    it('gives each kind the owner opened to the assistant a tool that exists, and none to what is off', () => {
        for (const n of NATURES.map((x) => x.nature)) {
            const d = OWNER_DECISION[n];
            for (const t of NATURE_TOOLS[n]) expect(t in MONITORING_TOOLS, `${n}: ${t}`).toBe(true);
            if (d.how === 'run' && d.who === 'ai') expect(NATURE_TOOLS[n].length, n).toBeGreaterThan(0);
            if (d.how === 'off') expect(NATURE_TOOLS[n], n).toEqual([]);
        }
    });

    it('maps every refusal of the gate to a stop of the closed list (docs/NO-STOP.md §2)', () => {
        for (const [k, v] of Object.entries(RUN_BLOCK_STOP)) expect(v === 'route' || (STOP_IDS as readonly string[]).includes(v), k).toBe(true);
        // Every refusal the screen and the assistant can say is in the map.
        for (const k of Object.keys(en.runBlock)) expect(k in RUN_BLOCK_STOP, k).toBe(true);
        expect(c.stops.map((s) => s.id)).toEqual([...STOP_IDS]);
        for (const s of c.stops) expect(s.next.length, s.id).toBeGreaterThan(0);
    });

    it('fits in one answer', () => {
        expect(Buffer.byteLength(JSON.stringify(c), 'utf-8')).toBeLessThanOrEqual(24 * 1024);
    });


    it('is what docs/CAPABILITIES.md says', () => {
        const md = capabilitiesMarkdown();
        if (process.env.WRITE_CAPABILITIES) writeFileSync(DOC, md);
        expect(existsSync(DOC), 'docs/CAPABILITIES.md: run npm run gen:capabilities').toBe(true);
        expect(readFileSync(DOC, 'utf-8'), 'docs/CAPABILITIES.md is not what the code says: run npm run gen:capabilities').toBe(md);
    });
});

/**
 * Claims a rule the owner retired once made, which an assistant reading the repository took as today's
 * and answered "can't" with. Each names the decision that retired it. The history (docs/PLAN.md) and the
 * record of what was retired (docs/NO-STOP.md) may quote them.
 */
const RETIRED: ReadonlyArray<{ re: RegExp; why: string }> = [
    { re: /安全機構が揃うまで解禁しない/, why: 'actuators run under the owner’s table (2026-11-15)' },
    { re: /既定はすべて無効/, why: 'the owner’s table opens them (2026-11-15)' },
    { re: /1\s*ジョブずつ解禁/, why: 'per nature by the owner’s table (2026-11-15), not unlocked one by one on a car' },
    { re: /実車に送るのは読取だけ(?!」の決まり)/, why: 'retired 2026-11-14' },
    { re: /運営者がまだ決めていません/, why: 'the owner decided every nature (2026-11-15)' },
    { re: /none exists for these yet/, why: 'monitoring_actuate and monitoring_procedure exist (2026-11-16)' },
    { re: /There is no\s+\*?\s*tool for those, and the facade has no method/, why: 'monitoring_actuate exists (2026-11-16)' },
    { re: /PRACTICE で一度動かす(まで|してから)/, why: 'practice is the build’s (2026-11-26)' },
    { re: /練習(モード)?で一度動かしたあと/, why: 'practice is the build’s (2026-11-26)' },
    { re: /実車で(確かめて|確認して)いないので(でき|送れ|送り)ません/, why: 'never a reason to stop (2026-11-26, NO-STOP §1)' },
    { re: /You cannot connect to the car/, why: 'the assistant reconnects the cable already allowed (2026-10-28)' },
    { re: /停車して画面で接続し直してください/, why: 'monitoring_connect reconnects by voice (2026-10-28)' },
];

const SCANNED_DIRS = ['docs', 'public/guide', 'src', 'packages/monitoring-engine/src'];
const SKIP = new Set(['docs/PLAN.md', 'docs/NO-STOP.md', 'src/lib/bridge/capabilities.test.ts']);

function files(): string[] {
    const out = ['README.md', 'CLAUDE.md'];
    const walk = (rel: string) => {
        for (const e of readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
            const r = `${rel}/${e.name}`;
            if (e.isDirectory()) walk(r);
            else if (/\.(md|ts|tsx)$/.test(e.name)) out.push(r);
        }
    };
    for (const d of SCANNED_DIRS) walk(d);
    return out.filter((f) => !SKIP.has(f));
}

describe('retired claims do not come back', () => {
    it('no file a reader takes as current says what a retired rule said', () => {
        const hits: string[] = [];
        for (const f of files()) {
            const text = readFileSync(path.join(ROOT, f), 'utf-8');
            for (const { re, why } of RETIRED) {
                const m = re.exec(text);
                if (m) hits.push(`${f}: 「${m[0]}」 — ${why}`);
            }
        }
        expect(hits).toEqual([]);
    });

    // A list of retired phrases only stops the phrases it knows: "見つかっても実行しない" and
    // "押すのは停車中に人" got past it. So, line by line over what the assistant and the desk read:
    // a job that drives something, said to be a person's alone, while the owner's table opens it to
    // the assistant. A line may still say what the table leaves to the person on the screen.
    it('no guide topic or Skill says a person alone runs what the owner opened to the assistant', () => {
        const opened = OWNER_DECISION.a_engine.who === 'ai' && OWNER_DECISION.c_adapt.who === 'ai' && OWNER_DECISION.c_clear.who === 'ai' && OWNER_DECISION.c_check.who === 'ai';
        expect(opened).toBe(true);
        const read = [
            ...readdirSync(path.join(ROOT, 'public/guide')).filter((f) => f.endsWith('.md')).map((f) => `public/guide/${f}`),
            '.claude/skills/monitoring-desk/SKILL.md',
            '.claude/skills/monitoring-loop/SKILL.md',
            'docs/AUTONOMY.md',
        ];
        const DRIVE = /作動テスト|調整|学習(値)?の(リセット|初期化)|ゼロ点|消去|システムチェック/;
        const HUMAN = /(リセット|調整|作動テスト)[^。]*は画面に置く|人が実行|押すのは[^。]*人|見つかっても実行しない|画面に置くところまで|AI は(動かさない|始めない)|人だけが/;
        const SCREEN_PERSON = /画面の人に任せた|表が画面の人/;
        const hits: string[] = [];
        for (const f of read) {
            for (const line of readFileSync(path.join(ROOT, f), 'utf-8').split('\n')) {
                if (DRIVE.test(line) && HUMAN.test(line) && !SCREEN_PERSON.test(line)) hits.push(`${f}: ${line.trim().slice(0, 120)}`);
            }
        }
        expect(hits).toEqual([]);
    });

    it('the Japanese refusal texts say no retired rule either', () => {
        for (const [k, v] of Object.entries(ja.runBlock)) for (const { re } of RETIRED) expect(re.test(v), k).toBe(false);
    });
});

const DATA = path.join(ROOT, 'public', 'ecu-data');
const HAVE_DATA = existsSync(path.join(DATA, 'index.json')) && existsSync(path.join(DATA, 'variants.json'));

/**
 * The modules part (ASSISTANT-LAYERS.md 5.3): which modules this build reads and how, so "is DSC read?"
 * is answered from the data the app runs on, not from a guide that said "DSC has no way to read it".
 * The relay keeps the whole answer from the hello (at most 48 KB, bridge/src/catalog.ts) and answers it
 * while the tab sleeps.
 */
describe.skipIf(!HAVE_DATA)('monitoring_capabilities: the modules, from the catalogue', () => {
    const json = (f: string) => (HAVE_DATA ? JSON.parse(readFileSync(path.join(DATA, f), 'utf-8')) : null);
    const index = json('index.json') ?? { modules: [] };
    const layouts = existsSync(path.join(DATA, 'fault-layouts.json')) ? json('fault-layouts.json') : { schema: 1, verifiedOnCar: false, modules: {} };
    const roster = moduleRoster(index, json('variants.json') ?? { schema: 1, generatedAt: '', groups: [] }, layouts);
    const by = new Map(roster.map((m) => [m.id, m]));

    it('lists every module in the catalogue once', () => {
        expect(roster.map((m) => m.id)).toEqual(index.modules.map((m: { id: string }) => m.id));
    });

    it('tells the modules apart the way the link does', () => {
        expect(by.get('mss54')).toMatchObject({ chosenBy: 'ident', faults: 'decoder', address: '0x12' });
        expect(by.get('smg2')?.chosenBy).toBe('ident');
        expect(by.get('gs20')?.chosenBy).toBe('ident');
        expect(by.get('kombi46')?.chosenBy).toBe('ident');
        // 0x56: ASC MK20 early, DSC late, no rule — the owner says which (monitoring_variant).
        expect(by.get('ascmk20')?.chosenBy).toBe('owner');
        expect(by.get('dsc_e46')?.chosenBy).toBe('owner');
        // MK60 is read on an M3 (KWP on the DS2 line, CLAUDE.md).
        expect(by.get('dsc_mk60')?.chosenBy).toBe('m3');
        expect(by.get('lws5')?.chosenBy).toBe('m3');
    });

    it('says every module\'s faults are read, and by what', () => {
        for (const m of roster) expect(['decoder', 'layout', 'own'], m.id).toContain(m.faults);
        for (const id of Object.keys(layouts.modules)) if (by.has(id)) expect(by.get(id)?.faults, id).toBe('layout');
    });

    it('fits in the hello with the rest, well under the relay\'s 48 KB', () => {
        const whole: Capabilities = { ...capabilities(), modules: roster, moduleRules: ['x'] };
        expect(Buffer.byteLength(JSON.stringify(whole), 'utf-8')).toBeLessThanOrEqual(40 * 1024);
    });
});
