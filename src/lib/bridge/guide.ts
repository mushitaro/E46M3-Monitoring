/**
 * The guide the tab declares in its hello: public/guide/index.md and one file per topic, fetched
 * from this origin when the bridge says hello, with a version that changes when any of it does.
 *
 * The files are served with the build, so the guide the relay keeps is the one this build was
 * written with; guide.test.ts holds GUIDE_TOPICS to the files and the whole to the relay's limits.
 */
export const GUIDE_TOPICS = [
    'drive',
    'faults',
    'investigate',
    'catalog',
    'cowork',
    'moment',
    'overview',
    'service',
    'tuning',
    'session',
    'trouble',
    'autonomy',
] as const;

export interface HelloGuide {
    version: string;
    index: string;
    topics: Record<string, string>;
}

/** The first 8 hex digits of SHA-256 over the guide's text, topic by topic. */
async function versionOf(index: string, topics: Record<string, string>): Promise<string> {
    const text = [index, ...GUIDE_TOPICS.map((t) => `\n## ${t}\n${topics[t]}`)].join('');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
    return [...digest.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function loadGuide(fetcher: typeof fetch = fetch): Promise<HelloGuide> {
    const get = async (name: string) => {
        const res = await fetcher(`./guide/${name}.md`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`guide/${name}.md: HTTP ${res.status}`);
        return res.text();
    };
    const [index, ...bodies] = await Promise.all([get('index'), ...GUIDE_TOPICS.map(get)]);
    const topics = Object.fromEntries(GUIDE_TOPICS.map((t, i) => [t, bodies[i]]));
    return { version: await versionOf(index, topics), index, topics };
}
