import { connectPractice } from './_lib.mjs';

let interruptedId, durableSamples, firstSavedId;
const scenario = {
    id: 'S12', title: '記録中の保存と、ページ消失後の記録回収',
    story: '記録中に保存して件数を確かめ、次の未完了runはページを閉じても端末保存済み部分を回収する。',
    steps: [
        ...connectPractice,
        { ai: 'monitoring_log_channels', args: { channels: ['3:n', '3:tmot'] }, expect: r => r.changed === true },
        { ai: 'monitoring_start_log', expect: r => r.started === true },
        { check: { desc: '記録中SAVEは現在のサンプルと正しい保存IDを返す', run: async page => {
            await page.waitForFunction(async () => (await window.__monitoringE2E.tool('monitoring_datalog', {})).samples >= 5);
            const r = await page.evaluate(async () => {
                const before = await window.__monitoringE2E.tool('monitoring_datalog', {});
                const saved = await window.__monitoringE2E.tool('monitoring_save', { confirmed: true });
                return { before, saved };
            });
            firstSavedId = r.saved.id;
            return r.saved.saved && r.saved.id && r.saved.sampleCount >= r.before.samples ? true : JSON.stringify(r);
        } } },
        { ai: 'monitoring_stop_log', args: { confirmed: true } },
        { ai: 'monitoring_save', args: { confirmed: true }, expect: r => r.saved && r.id === firstSavedId && r.sampleCount > 0 },
        { wait: 700 },
        { ai: 'monitoring_start_log', expect: r => r.started === true },
        { check: { desc: '新しいrunのchunkが端末へcommitされた', run: async page => {
            await page.waitForTimeout(1200);
            const h = await page.evaluate(async () => {
                const db = await new Promise((resolve, reject) => { const q = indexedDB.open('e46m3-monitoring'); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
                const rows = await new Promise(resolve => { const q = db.transaction('recordingHeaders').objectStore('recordingHeaders').getAll(); q.onsuccess = () => resolve(q.result); });
                db.close(); return rows.find(h => !h.complete && h.count > 0);
            });
            if (!h) return 'no durable active recording';
            interruptedId = h.id; durableSamples = h.count; return true;
        } } },
        { check: { desc: '別タブを開いても、実行中の記録を回収・削除しない', run: async page => {
            const other = await page.context().newPage();
            try {
                await other.goto(page.url());
                await other.waitForFunction(() => !!window.__monitoringE2E);
                await other.waitForTimeout(500);
                const result = await other.evaluate(() => window.__monitoringE2E.tool('monitoring_sessions', {}));
                return !result.saved.some(s => s.id === interruptedId) ? true : 'active recording was consumed';
            } finally { await other.close(); }
        } } },
        { reload: true, means: 'STOPせずページを破棄する（物理電源断ではない）' },
        { check: { desc: '未完了runを同じID・由来・端末保存済み件数で回収', run: async page => {
            await page.waitForFunction(async id => (await window.__monitoringE2E.tool('monitoring_sessions', {})).saved.some(s => s.id === id), interruptedId);
            const r = await page.evaluate(() => window.__monitoringE2E.tool('monitoring_sessions', {}));
            const saved = r.saved.filter(s => s.id === interruptedId);
            return saved.length === 1 && saved[0].sampleCount >= durableSamples && saved[0].practice && saved[0].label.includes('INTERRUPTED') ? true : JSON.stringify(r);
        } } },
    ],
};

export default scenario;
