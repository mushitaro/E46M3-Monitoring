import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { instructionsIn } from './instructions';

describe('instructionsIn: what a caution tells the person to do, for the visible body', () => {
    it('lifts the instruction and leaves the description', () => {
        expect(instructionsIn('実行中はブレーキペダルに触れないでください。', 'ja')).toEqual(['実行中はブレーキペダルに触れないでください。']);
        expect(instructionsIn('Do not touch the brake pedal while it runs.', 'en')).toEqual(['Do not touch the brake pedal while it runs.']);
        const ja =
            'エンジン稼働中に開くと、燃焼していない生ガスが筒内と排気系に入ります。触媒を傷めます。**必ずエンジンを止めてから**実行してください。燃圧が残っているので、配管を外した状態では行わないこと。';
        expect(instructionsIn(ja, 'ja')).toEqual(['必ずエンジンを止めてから実行してください。', '燃圧が残っているので、配管を外した状態では行わないこと。']);
    });

    it("reads the authors' terse preconditions as instructions", () => {
        expect(instructionsIn('舵角センサのゼロ点を合わせ直します。平坦な場所で、車輪を直進に向け、車両を完全に静止させてから。ずれたまま合わせると DSC が誤って介入します。', 'ja')).toEqual([
            '平坦な場所で、車輪を直進に向け、車両を完全に静止させてから。',
        ]);
        expect(instructionsIn('Re-zeroes the steering-angle sensor. Level ground, wheels straight, car completely still. Zeroed off-centre, DSC intervenes when it should not.', 'en')).toEqual([
            'Level ground, wheels straight, car completely still.',
        ]);
    });

    it("keeps the job's mechanics (arguments, values) in the details", () => {
        expect(instructionsIn('リアウインドウ熱線のリレーを EIN/AUS します。大電流負荷なので AUS で終えること。', 'ja')).toEqual([]);
        expect(instructionsIn('Switches the rear-window heater relay EIN/AUS. It is a heavy load — finish with AUS.', 'en')).toEqual([]);
    });

    it('drops whose the instruction is: that is the details', () => {
        expect(instructionsIn('リアデフロスタのボタンを押したことにします。SGBD の前提: エンジンが回っていること。', 'ja')).toEqual(['エンジンが回っていること。']);
        expect(instructionsIn("Simulates pressing the button. The SGBD's precondition: the engine must be running.", 'en')).toEqual(['The engine must be running.']);
    });

    it('says nothing for a caution with no instruction, or none at all', () => {
        expect(instructionsIn('ALC 制御ユニットが再起動します。数秒間、通信と機能が途切れます。', 'ja')).toEqual([]);
        expect(instructionsIn(null, 'en')).toEqual([]);
    });

    // Every caution the catalogues ship: the two languages lift the same instructions, give or take the one
    // the authors wrote as one Japanese sentence and two English clauses.
    const dir = 'public/ecu-data';
    const present = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.jobtext.json'));
    it.skipIf(!present)('lifts as many in English as in Japanese, across the catalogues', () => {
        const cautions = new Map<string, { ja: string; en: string }>();
        for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jobtext.json'))) {
            const t = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')) as { jobs: { caution?: { ja: string; en: string } }[] };
            for (const j of t.jobs) if (j.caution) cautions.set(j.caution.ja, j.caution);
        }
        const differ = [...cautions.values()].filter((c) => instructionsIn(c.ja, 'ja').length !== instructionsIn(c.en, 'en').length);
        expect(differ.length).toBeLessThanOrEqual(1);
    });
});
