/**
 * MANUAL, as an owner uses it without an assistant: read, record, disconnect — and keep it
 * afterwards from MEMORY (operator, 2026-11-02: tried first, kept afterwards).
 */
const scenario = {
    id: 'S01',
    title: 'MANUAL：故障を読み、記録し、後から MEMORY で残す',
    story:
        'オーナーがナビで MONITORING を開く。PRACTICE（模擬の E46 M3）につなぎ、DME の故障を読み、データログを 3 秒取って切断する。' +
        'あとで MEMORY を開くと、その接続が「まだ残していない」に並んでいる。SAVE で残し、読み込み直しても消えていないことを確かめる。',
    steps: [
        { screen: { desc: '起動直後：タブの並びとハブ', has: ['DIAGNOSIS', 'DATALOG', 'MEMORY', 'CONNECT'] } },
        { ui: 'practice', means: 'PRACTICE に印が付く' },
        { ui: 'click', text: 'CONNECT', settle: 2000, means: '模擬の車につながる' },
        { screen: { desc: 'つながった', has: ['DISCONNECT', 'READ'] } },
        { ui: 'click', text: 'READ', settle: 2500, means: 'DME の故障を読む' },
        { screen: { desc: 'DME の故障 2 件と説明', has: ['0x2A', '0xD1'] } },
        { shot: 'faults' },
        { ui: 'tab', name: 'DATALOG' },
        { ui: 'click', text: 'RECORD', settle: 3000, means: '記録が始まる' },
        { ui: 'click', text: 'STOP', settle: 1000, means: '記録が止まる' },
        { ui: 'click', text: 'DISCONNECT', settle: 1500, means: '切断。この接続が一つのまとまりとして終わる' },
        { ui: 'tab', name: 'MEMORY' },
        { screen: { desc: '「まだ残していない」にまとまりが一つ', has: ['まだ残していない', '故障 2', 'あと 7 日'] } },
        { shot: 'not-kept' },
        {
            check: {
                desc: '残していないまとまりは 1 件、端末の記録は 0 件',
                run: async (page) => {
                    const r = await page.evaluate(() => window.__monitoringE2E.tool('monitoring_sessions', {}));
                    return r.notKept.length === 1 && r.saved.length === 0 ? true : `notKept ${r.notKept.length}, saved ${r.saved.length}`;
                },
            },
        },
        { ui: 'click', text: 'SAVE', settle: 1200, means: 'まとまりを丸ごと残す' },
        { screen: { desc: '残した記録が「この端末」へ', has: ['この端末', '故障 2'], hasNot: ['あと 7 日'] } },
        { reload: true, means: 'キーを回し直したナビと同じ' },
        { ui: 'tab', name: 'MEMORY' },
        {
            check: {
                desc: '読み込み直しても、残した記録は 1 件',
                run: async (page) => {
                    const r = await page.evaluate(() => window.__monitoringE2E.tool('monitoring_sessions', {}));
                    return r.saved.length === 1 && r.saved[0].faultCount === 2 ? true : JSON.stringify(r).slice(0, 200);
                },
            },
        },
        { shot: 'kept' },
    ],
};

export default scenario;
