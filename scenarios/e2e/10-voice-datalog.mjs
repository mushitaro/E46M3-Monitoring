import { connectPractice } from './_lib.mjs';

/**
 * The head unit, 2026-11-04: driving, by voice — "read the faults", "set the datalog items and find
 * the cause", "save". Each step failed on the car that day; here each must work while moving.
 */
const scenario = {
    id: 'S10',
    title: '走行中、声だけで：故障を読む → VANOS と油温を選んで記録 → 中身を読む → 保存に故障と記録が入る',
    story:
        '時速 40 キロで走りながら、オーナーが故障の読み取りを頼む。AI はそのまま読む。次に「VANOS の原因を調べるのにログを取って」。' +
        'AI は値を探し（vanos、油温）、選び、記録を始め、走っている間に中身を読む。止めて保存すると、保存したまとまりに故障の読み取りと記録の両方が入っている。',
    car: { dmeFaults: [{ code: 0x43, type: 0x84, frequency: 2 }, { code: 0xb8, type: 0x84, frequency: 2 }] },
    steps: [
        { say: '故障コードをリードして' },
        ...connectPractice,
        { car: { speedKmh: 40 }, means: '走っている' },
        {
            ai: 'monitoring_faults',
            args: { refresh: true },
            means: '走行中に読める。0x43 が返る',
            expect: (r) => (r && r.refreshed === true && /0x43/i.test(JSON.stringify(r)) ? true : JSON.stringify(r).slice(0, 300)),
        },
        { say: 'VANOS の原因を調べるのに、ログを取って' },
        {
            ai: 'monitoring_log_channels',
            args: { query: 'evan1' },
            means: '吸気 VANOS の実角と目標角が見つかる',
            expect: (r) => {
                const ids = (r?.found ?? []).map((c) => c.channel);
                return ids.includes('35:evan1_ist') && ids.includes('35:evan1_soll') ? true : JSON.stringify(ids);
            },
        },
        {
            ai: 'monitoring_log_channels',
            args: { channels: ['STATUS_EVANOS1_IST'] },
            means: 'カタログのジョブ名は値ではない：断って候補を出す',
            expect: (r) => (r && r.changed === false && (r.suggestions ?? []).length > 0 ? true : JSON.stringify(r).slice(0, 300)),
        },
        {
            ai: 'monitoring_log_channels',
            args: { channels: ['35:evan1_ist', '35:evan1_soll', '3:toel', '3:n'] },
            means: '選ぶ：2 ブロック',
            expect: (r) => (r && r.changed && r.cost?.blocks === 2 ? true : JSON.stringify(r)),
        },
        {
            ai: 'monitoring_start_log',
            means: '記録を始め、記録するチャンネルを言う',
            expect: (r) => (r && r.started && (r.selected ?? []).includes('35:evan1_ist') ? true : JSON.stringify(r).slice(0, 300)),
        },
        { wait: 4000 },
        {
            ai: 'monitoring_datalog',
            args: { max: 10 },
            means: '記録中に中身を読める：チャンネルごとの値と間引いたトレース',
            expect: (r) => {
                const ev = (r?.stats ?? []).find((x) => x.channel === '35:evan1_ist');
                return r && r.running && r.samples > 0 && ev && ev.n > 0 && (r.trace ?? []).length > 0 ? true : JSON.stringify(r).slice(0, 400);
            },
        },
        {
            ai: 'monitoring_log_channels',
            args: { channels: ['3:n'] },
            means: '記録中は選び直せない',
            expect: (r) => (r && r.changed === false ? true : JSON.stringify(r)),
        },
        { ai: 'monitoring_stop_log', args: { confirmed: true }, means: '復唱のあと止める', expect: (r) => (r && r.stopped === 'recording' ? true : JSON.stringify(r)) },
        { wait: 1000 },
        { say: '保存して' },
        {
            ai: 'monitoring_save',
            args: { confirmed: true },
            means: '保存したまとまりに、故障の読み取りと記録の両方が入る',
            expect: (r) => (r && r.saved && r.faultCount === 2 && r.sampleCount > 0 ? true : JSON.stringify(r)),
        },
        { shot: 'saved' },
    ],
};

export default scenario;
