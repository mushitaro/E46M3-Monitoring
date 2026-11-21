import { describe, expect, it } from 'vitest';
import { formatDuration, procedureMaxSec } from './duration';
import { headline } from './jobName';
import { sharedReason } from '@/views/shared/RunReason';
import type { RunVerdict } from '@tsunagi/monitoring-engine';

const ja = { dur_sec: (n: number) => `${n} 秒`, dur_min: (n: number) => `${n} 分` };

describe('formatDuration (UX-12: 秒 and 分, never the SGBD sek / 3,0 min)', () => {
    it('says seconds below a minute, minutes on the minute, and both between', () => {
        expect(formatDuration(10, ja)).toBe('10 秒');
        expect(formatDuration(180, ja)).toBe('3 分');
        expect(formatDuration(150, ja)).toBe('2 分 30 秒');
    });
    it('takes a procedure length only where the SGBD states one', () => {
        expect(procedureMaxSec({ durMax: '3,0 min', durMaxSec: 180 })).toBe(180);
        // The 60 s is the app's default for a program the SGBD gives no length: not shown as the SGBD's.
        expect(procedureMaxSec({ durMax: '', durMaxSec: 60 })).toBeNull();
    });
});

describe('headline (UX-27: a row says the first line of the SGBD comment)', () => {
    it('keeps the name and drops the instructions after it', () => {
        expect(headline('実行中のテストプログラムの終了 / TESTPRG_STARTENの前に送信すること！ / （ECUタイムアウト: 10秒！）')).toBe('実行中のテストプログラムの終了');
        expect(headline('アクチュエータ駆動')).toBe('アクチュエータ駆動');
    });
});

describe('sharedReason (UX-28: one reason on (nearly) every row is said once on the list)', () => {
    const no = (reason: string) => ({ allowed: false, reason }) as unknown as RunVerdict;
    const yes = { allowed: true } as unknown as RunVerdict;
    it('finds the reason four rows in five share, on a list of three or more', () => {
        expect(sharedReason([no('run_block_practiceFirst'), no('run_block_practiceFirst'), no('run_block_practiceFirst'), no('run_block_practiceFirst'), yes])).toEqual({ reason: 'run_block_practiceFirst', count: 4 });
    });
    it('leaves a short list and a mixed one to their rows', () => {
        expect(sharedReason([no('run_block_practiceFirst'), no('run_block_practiceFirst')])).toBeNull();
        expect(sharedReason([no('run_block_practiceFirst'), no('run_block_noTelegram'), no('run_block_practiceFirst'), yes])).toBeNull();
    });
});
