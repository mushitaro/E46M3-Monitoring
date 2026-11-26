import { connectPractice, tool } from './_lib.mjs';
import { always, check, screenText } from './_ij.mjs';

/**
 * Which module is fitted where the car's IDENT cannot say (owner, 2026-11-26: docs/NO-STOP.md §4 D2).
 *
 * 0x56 is ASC MK20 on an early E46 and DSC on a late one, and no group rule tells them apart. Until
 * 2026-11-26 only the screen's ACTUATOR could record which, so the assistant stopped on "say which on
 * the screen". Now the owner says it and the assistant records their words with monitoring_variant, in
 * the same place the screen's choice goes. Nothing is sent by it. Where the IDENT does decide (0x12,
 * 0x32, 0x80), the owner is not asked and the tool refuses.
 */
const scenario = {
    id: '28',
    title: 'どちらが付いているかを、オーナーの言葉で AI が残す（0x56 の ASC MK20 か DSC）',
    story:
        '0x56 は前期なら ASC MK20、後期なら DSC で、IDENT の規則では分けられない。オーナーが「後期の DSC」と言い、AI が monitoring_variant で残す。' +
        '残したあと、ASC MK20 のものは「この車の 0x56 は DSC」と断られる。IDENT が決めるアドレス（0x12）は聞かずに断る。言葉が無ければ残さない。',
    steps: always([
        ...connectPractice,
        check('言葉が無ければ残さない', async (page) => {
            const r = await tool(page, 'monitoring_variant', { module: 'dsc_e46' });
            return r?.recorded === false && /owner_said/.test(r.reason ?? '') ? true : JSON.stringify(r).slice(0, 300);
        }),
        check('IDENT が決めるアドレス（0x12）は、オーナーの言葉では決めない', async (page) => {
            const r = await tool(page, 'monitoring_variant', { module: 'ms450ds0', owner_said: 'MS45 だよ' });
            return r?.recorded === false ? true : JSON.stringify(r).slice(0, 300);
        }),
        check('オーナーの「後期の DSC だよ」を残す：0x56 に DSC、ASC MK20 は外れる', async (page, st) => {
            const r = await tool(page, 'monitoring_variant', { module: 'dsc_e46', owner_said: '後期の DSC だよ' });
            st.recorded = r;
            return r?.recorded === true && r.address === '0x56' && (r.ruledOut ?? []).includes('ascmk20') ? true : JSON.stringify(r).slice(0, 300);
        }),
        check('残したあと、ASC MK20 は「この車の 0x56 は DSC」と断られる（画面にも出さない、何も送らない）', async (page) => {
            const r = await tool(page, 'monitoring_module', { module: 'ascmk20' });
            if (r?.switched === true || r?.ok === true) {
                const cat = await tool(page, 'monitoring_catalog', { module: 'ascmk20', kind: 'test' });
                const job = (cat?.jobs ?? [])[0]?.job;
                const a = job ? await tool(page, 'monitoring_actuate', { module: 'ascmk20', job, owner_said: 'いいよ' }) : null;
                return a?.started === false && /0x56 is/.test(a.reason ?? '') ? true : `ASC MK20 に替わり、動かすものが断られない: ${JSON.stringify(a ?? cat).slice(0, 300)}`;
            }
            return /0x56 is|DSC/.test(JSON.stringify(r)) ? true : JSON.stringify(r).slice(0, 300);
        }),
        check('DSC を画面に出す', async (page) => {
            const r = await tool(page, 'monitoring_module', { module: 'dsc_e46' });
            await page.waitForTimeout(1500);
            return r && !r.error && r.switched !== false ? true : JSON.stringify(r).slice(0, 300);
        }),
        { ui: 'tab', name: 'ACTUATOR', settle: 1200 },
        check('画面の ACTUATOR は、もう「どちらですか」と聞かない', async (page) => {
            const t = await screenText(page);
            return /0x56 には年式でちがう|どちらですか/.test(t) ? `まだ聞いている: ${t.slice(0, 200)}` : true;
        }),
        { shot: 's01-variant-recorded' },
    ]),
};

export default scenario;
