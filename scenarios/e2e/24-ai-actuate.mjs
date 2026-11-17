import { connectPractice, tool } from './_lib.mjs';

/**
 * The owner's table opens a job to the assistant (policy `who: 'ai'`): it reads back, waits for the
 * owner's OK, and starts it through the same gate, measurement and arming as the screen's RUN.
 * Refused while the car moves, without the owner's words, and while another output is on. STOP is
 * anyone's, any time.
 */
const scenario = {
    id: 'S24',
    title: 'AI が始める作動テスト：決まりの表が AI に開いた項目を、オーナーの「いいよ」のあと停車中に（練習モード）',
    story:
        '運営者の決定（2026-11-15・16）：表の「誰が」が AI のものは、AI が読み返してオーナーの「いいよ」を待ち、画面の RUN と同じ関門・測定・時間切れで始める。' +
        '走行中の AI は読むだけ。一度に一つ。止めるは誰でもいつでも。ラジオの選局（音響の作動、AI に開いている）で確かめる。',
    steps: [
        ...connectPractice,
        {
            ai: 'monitoring_module',
            args: { module: 'radio' },
            means: '画面のモジュールをラジオに（同じ口でつなぎ直す）',
            expect: (r) => (JSON.stringify(r).includes('radio') ? true : JSON.stringify(r).slice(0, 200)),
        },
        { wait: 2500 },
        { ai: 'monitoring_status', means: '画面のモジュールがラジオ', expect: (r) => (r?.module?.id === 'radio' && r.link === 'connected' ? true : JSON.stringify(r).slice(0, 200)) },
        {
            check: {
                desc: 'オーナーの言葉が無ければ始めない（読み返して「いいよ」を待つ）',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_actuate', { module: 'radio', job: 'STEUERN_SEEK_UP', phase: 'pulse', owner_said: '' });
                    return r?.started === false && /owner_said/.test(r.reason ?? '') ? true : JSON.stringify(r).slice(0, 200);
                },
            },
        },
        { car: { speedKmh: 40 }, means: '走り出す' },
        { wait: 2500 },
        {
            check: {
                desc: '走行中の AI は読むだけ：始めない',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_actuate', { module: 'radio', job: 'STEUERN_SEEK_UP', phase: 'pulse', owner_said: 'いいよ' });
                    return r?.started === false ? true : JSON.stringify(r).slice(0, 200);
                },
            },
        },
        { car: { speedKmh: 0 }, means: '止まる' },
        { wait: 6000 },
        {
            check: {
                desc: '停車中、「いいよ」のあと：車を測ってから一度送る',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_actuate', { module: 'radio', job: 'STEUERN_SEEK_UP', phase: 'pulse', owner_said: 'いいよ' });
                    return r?.started === true && r.mode === 'practice' ? true : JSON.stringify(r).slice(0, 300);
                },
            },
        },
        { screen: { desc: '画面は ACTUATOR に移っている', has: ['STEUERN_SEEK_UP'] } },
        { shot: 'ai-actuate' },
        {
            check: {
                desc: '止めるは誰でもいつでも：断られない',
                run: async (page) => {
                    const r = await tool(page, 'monitoring_stop_outputs');
                    return Array.isArray(r?.stopped) ? true : JSON.stringify(r).slice(0, 200);
                },
            },
        },
    ],
};

export default scenario;
