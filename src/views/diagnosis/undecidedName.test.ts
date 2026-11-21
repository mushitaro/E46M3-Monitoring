import { describe, expect, it } from 'vitest';
import { undecidedName } from './ScanView';

const either = (a: string, b: string) => `${a} か ${b}`;

/** A `?` row on ALL MODULES (UX-19): what its candidates share, behind a `?` that says it is not a choice. */
describe('the name of a row whose module its IDENT does not decide', () => {
    it('is the words every candidate starts with', () => {
        expect(undecidedName(['ボディ電装 GM5 (ZKE5)', 'ボディ電装 GM5 (ZKE5 S12)'], 'ボディ電装', either)).toBe('? ボディ電装 GM5');
        expect(undecidedName(['ナビゲーション MK3', 'ナビゲーション MK4', 'ナビゲーション MK4 (2)'], '通信・AV', either)).toBe('? ナビゲーション');
    });

    it('compares words, not characters, and may be a whole candidate’s name behind its `?`', () => {
        expect(undecidedName(['イモビライザ EWS 3.3', 'イモビライザ EWS 3.3D'], '安全・保安', either)).toBe('? イモビライザ EWS');
        expect(undecidedName(['サンルーフ SHD', 'サンルーフ SHD (2)'], '快適装備', either)).toBe('? サンルーフ SHD');
    });

    it('names both of two that share nothing, and the group of more', () => {
        expect(undecidedName(['ABS/ASC MK20', 'DSC (E46)'], 'シャシ', either)).toBe('? ABS/ASC MK20 か DSC (E46)');
        expect(undecidedName(['ボードモニター (Radio Nav)', 'ボードモニター MIR', 'ワイドスクリーンモニター'], '通信・AV', either)).toBe('? 通信・AV');
    });
});
