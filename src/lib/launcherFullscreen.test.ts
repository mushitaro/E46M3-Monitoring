import { describe, expect, it } from 'vitest';
import { isPlainTap, shouldTakeScreen, type FullscreenEnv } from './launcherFullscreen';

const fallback: FullscreenEnv = { openedByLauncher: true, displayModeBrowser: true, fullscreenEnabled: true, inFullscreen: false };

describe('taking the head unit’s screen back', () => {
    it('does when the launcher opened the page and Chrome shows it as a tab', () => {
        expect(shouldTakeScreen(fallback)).toBe(true);
    });
    it('does not in a verified TWA, which reports standalone', () => {
        expect(shouldTakeScreen({ ...fallback, displayModeBrowser: false })).toBe(false);
    });
    it('does not on a phone or a computer the launcher did not open', () => {
        expect(shouldTakeScreen({ ...fallback, openedByLauncher: false })).toBe(false);
    });
    it('does not when already full screen, or when the browser has no full screen', () => {
        expect(shouldTakeScreen({ ...fallback, inFullscreen: true })).toBe(false);
        expect(shouldTakeScreen({ ...fallback, fullscreenEnabled: false })).toBe(false);
    });
});

/** A stand-in element: `closest` answers whether any selector in the list matches its chain. */
function el(chain: string[]) {
    return {
        closest: (sel: string) => {
            const wanted = sel.split(',').map((s) => s.trim());
            return chain.some((tag) => wanted.includes(tag)) ? {} : null;
        },
    } as unknown as EventTarget;
}

describe('which taps may be spent on full screen', () => {
    it('a tap on the page’s background or a readout', () => {
        expect(isPlainTap(el(['div', 'main']))).toBe(true);
    });
    it('never a tap on a control, whose handler needs the activation (the cable chooser)', () => {
        expect(isPlainTap(el(['span', 'button']))).toBe(false);
        expect(isPlainTap(el(['a']))).toBe(false);
        expect(isPlainTap(el(['[role="switch"]']))).toBe(false);
    });
    it('not a tap with no element', () => {
        expect(isPlainTap(null)).toBe(false);
    });
});
