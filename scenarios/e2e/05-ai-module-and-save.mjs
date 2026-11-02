import { connectPractice, tool } from './_lib.mjs';

/** The assistant changes the module on the screen, and later keeps "the one just now". */
const scenario = {
    id: 'S05',
    title: 'AI モジュール切替と「さっきのを保存して」',
    story:
        'AI が画面のモジュールを SMG II に切り替えて故障を読む（解読器が無いのでバイトのまま）。オーナーが切断したあと「さっきのを保存して」と言うと、' +
        'AI は残していないまとまりの一覧から選び、どれかを言ってから残す。',
    steps: [
        ...connectPractice,
        {
            ai: 'monitoring_module',
            args: { module: 'smg2' },
            means: '切断して、同じ口で SMG II につなぎ直す',
            expect: (r) => (JSON.stringify(r).includes('smg2') ? true : JSON.stringify(r)),
        },
        { wait: 2500 },
        { ai: 'monitoring_status', means: '画面のモジュールが SMG II', expect: (r) => (r?.module?.id === 'smg2' && r.link === 'connected' ? true : JSON.stringify(r).slice(0, 200)) },
        { screen: { desc: '状態行のモジュールが SMG II', has: ['SMG II'] } },
        {
            ai: 'monitoring_faults',
            args: { module: 'smg2', refresh: true },
            means: 'SMG II の故障をその SGBD のフレームで読む。解読器が無いので、バイトのまま',
            expect: (r) => (r && !JSON.stringify(r).includes('"error"') ? true : JSON.stringify(r)),
        },
        { shot: 'smg2' },
        { ui: 'click', text: 'DISCONNECT', settle: 1500, means: 'オーナーが切断する' },
        { say: 'さっきのを保存して' },
        {
            ai: 'monitoring_sessions',
            means: '残していないまとまりの一覧（名前・時刻・件数、中身は無い）',
            expect: (r) => (r?.notKept?.length >= 1 && !JSON.stringify(r).includes('77 83 73') ? true : JSON.stringify(r).slice(0, 300)),
            keep: (r, st) => (st.episode = r.notKept[0].episode),
        },
        {
            check: {
                desc: 'AI が一番新しいまとまりを残す',
                run: async (page, st) => {
                    const r = await tool(page, 'monitoring_save', { confirmed: true, episode: st.episode });
                    return r?.saved ? true : JSON.stringify(r);
                },
            },
        },
        { ui: 'tab', name: 'MEMORY' },
        { screen: { desc: '残した記録が「この端末」に', has: ['この端末', 'SMG2'] } },
        { shot: 'saved' },
    ],
};

export default scenario;
