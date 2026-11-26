import { connectPractice, tool } from './_lib.mjs';
import { always, check } from './_ij.mjs';

/**
 * 「何ができる？」「なぜ止まった？」をコードから答える（owner, 2026-11-26）.
 *
 * Chat answered from README and docs, which were older than the code, and said "can't" to things the
 * tab does. monitoring_capabilities is built by the build from its tool list, the owner's table and the
 * closed list of stops; here the real tab answers it, and what it says can be done is then done: a
 * clear (the table opens it to the assistant) is refused only for the read-back (S3), never as
 * "can't", and a write is refused as off in the owner's table (S6), as the answer says.
 */
const scenario = {
    id: '29',
    title: 'できること・止める理由を、README ではなくコードから答える（monitoring_capabilities）',
    story:
        'オーナーが「消去や作動テストって AI からできる？」と聞く。AI は monitoring_capabilities を呼び、運営者の表から「停車中に、読み返して『いいよ』のあとでできる」と答える。' +
        '言葉が無いまま頼むと、断りは「読み返してから」（S3）で、「できない」ではない。書き込みは表で「出さない」（S6）で、答えもそう言う。',
    steps: always([
        ...connectPractice,
        { say: '消去や作動テストって AI からできる？' },
        check('monitoring_capabilities が、道具・運営者の表・止める理由 S1〜S7 を返す', async (page, st) => {
            const c = await tool(page, 'monitoring_capabilities');
            st.c = c;
            const ok = Array.isArray(c?.tools) && c.tools.some((t) => t.name === 'monitoring_actuate') &&
                Array.isArray(c?.owner) && c.owner.length >= 20 &&
                Array.isArray(c?.stops) && c.stops.map((s) => s.id).join(',') === 'S1,S2,S3,S4,S5,S6,S7';
            return ok ? true : JSON.stringify(c).slice(0, 400);
        }),
        check('消去と作動テストは「AI も、停車中に」、書き込みと安全装置は「出さない」', async (page, st) => {
            const by = Object.fromEntries((st.c?.owner ?? []).map((o) => [o.nature, o]));
            const okClear = by.c_clear?.who === 'ai' && by.c_clear?.how === 'run' && /^yes, parked/.test(by.c_clear?.assistant ?? '');
            const okTest = by.a_engine?.who === 'ai' && /monitoring_actuate/.test(by.a_engine?.assistant ?? '');
            const okWrite = by.w?.how === 'off' && by.a_safety?.how === 'off';
            return okClear && okTest && okWrite ? true : JSON.stringify({ c_clear: by.c_clear, a_engine: by.a_engine, w: by.w }).slice(0, 400);
        }),
        check('答えが言う「できる」は、タブでも「できない」では断られない：言葉が無ければ読み返し待ち（S3）', async (page) => {
            const cat = await tool(page, 'monitoring_catalog', { module: 'mss54', query: 'LOESCHEN', limit: 12 });
            const job = (cat?.jobs ?? []).find((j) => /FS_LOESCHEN/.test(j.job ?? ''))?.job;
            if (!job) return `MSS54 の消去のジョブが見つからない: ${JSON.stringify(cat).slice(0, 300)}`;
            const r = await tool(page, 'monitoring_actuate', { module: 'mss54', job, owner_said: '' });
            if (r?.started) {
                await tool(page, 'monitoring_stop_outputs');
                return '言葉が無いのに始まった';
            }
            return /owner|OK|yes|read back/i.test(r?.reason ?? '') && !/not (yet )?(confirmed|verified)|cannot be done/i.test(r?.reason ?? '') ? true : JSON.stringify(r).slice(0, 300);
        }),
        check('どの断りも閉じた一覧（S1〜S7）か、別の道具（route）に当たる', async (page, st) => {
            const bad = Object.entries(st.c?.refusals ?? {}).filter(([, v]) => !/^S[1-7]$/.test(v) && !/^not a stop/.test(v));
            return bad.length === 0 && Object.keys(st.c?.refusals ?? {}).length >= 10 ? true : JSON.stringify(bad);
        }),
        { shot: 's01-capabilities' },
    ]),
};

export default scenario;
