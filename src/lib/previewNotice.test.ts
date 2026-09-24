import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstRunDialogUp } from './previewNotice';

/** localStorage as a browser keeps it. */
function memoryStorage() {
    const m = new Map<string, string>();
    return {
        getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
        setItem: (k: string, v: string) => void m.set(k, String(v)),
        removeItem: (k: string) => void m.delete(k),
    };
}

/** localStorage as a browser with site data blocked keeps it: every touch throws. */
function blockedStorage() {
    const no = () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    return { getItem: no, setItem: no, removeItem: no };
}

/** The acknowledgement and the store's cache live in the module, so each case gets a fresh one. */
async function fresh() {
    vi.resetModules();
    return { notice: await import('./previewNotice'), disclaimer: await import('./disclaimer') };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('the preview notice acknowledgement', () => {
    it('is a key of its own, with its version in its name', async () => {
        const { notice, disclaimer } = await fresh();
        expect(notice.PREVIEW_NOTICE_KEY).toBe('preview-notice:v1');
        expect(notice.PREVIEW_NOTICE_KEY).not.toBe(disclaimer.STORAGE_KEY);
    });

    it('is missing until AGREE, however long ago the disclaimer was agreed to', async () => {
        const storage = memoryStorage();
        vi.stubGlobal('localStorage', storage);
        storage.setItem('e46m3.disclaimer', '1');
        const { notice, disclaimer } = await fresh();
        expect(disclaimer.disclaimerStore.snapshot()).toBe(true);
        expect(notice.previewNoticeAcknowledged()).toBe(false);
        expect(notice.previewNoticeStore.snapshot()).toBe(false);
    });

    it('AGREE in the preview records both, and says so to whoever is reading', async () => {
        const storage = memoryStorage();
        vi.stubGlobal('localStorage', storage);
        const { notice } = await fresh();
        const heard = vi.fn();
        notice.previewNoticeStore.subscribe(heard);

        notice.agreeToFirstRun(true);

        expect(storage.getItem('preview-notice:v1')).not.toBeNull();
        expect(storage.getItem('e46m3.disclaimer')).toBe('1');
        expect(notice.previewNoticeAcknowledged()).toBe(true);
        expect(notice.previewNoticeStore.snapshot()).toBe(true);
        expect(heard).toHaveBeenCalled();
    });

    it('AGREE outside the preview records the disclaimer as it always has, and never the notice', async () => {
        const storage = memoryStorage();
        vi.stubGlobal('localStorage', storage);
        const { notice } = await fresh();

        notice.agreeToFirstRun(false);

        expect(storage.getItem('e46m3.disclaimer')).toBe('1');
        expect(storage.getItem('preview-notice:v1')).toBeNull();
        expect(notice.previewNoticeAcknowledged()).toBe(false);
    });

    it('an acknowledgement given in another tab counts — a send asks storage, not this tab', async () => {
        const storage = memoryStorage();
        vi.stubGlobal('localStorage', storage);
        const { notice } = await fresh();
        expect(notice.previewNoticeAcknowledged()).toBe(false);
        storage.setItem('preview-notice:v1', '2026-09-24T00:00:00.000Z');
        expect(notice.previewNoticeAcknowledged()).toBe(true);
    });

    it('storage that throws has not acknowledged; AGREE then holds for the life of the page', async () => {
        vi.stubGlobal('localStorage', blockedStorage());
        const { notice } = await fresh();
        expect(notice.previewNoticeAcknowledged()).toBe(false);
        expect(notice.previewNoticeStore.snapshot()).toBe(false);

        expect(() => notice.agreeToFirstRun(true)).not.toThrow();
        expect(notice.previewNoticeAcknowledged()).toBe(true);
        expect(notice.previewNoticeStore.snapshot()).toBe(true);

        // The next page load starts again from storage, which still says nothing.
        const next = await fresh();
        expect(next.notice.previewNoticeAcknowledged()).toBe(false);
    });

    it('no storage at all is the same as storage that throws', async () => {
        const { notice } = await fresh();
        expect(typeof (globalThis as { localStorage?: unknown }).localStorage).toBe('undefined');
        expect(notice.previewNoticeAcknowledged()).toBe(false);
    });
});

describe('whether the first-run dialog is up', () => {
    it('outside the preview: the disclaimer alone decides, exactly as before', () => {
        for (const noticeAcknowledged of [false, true]) {
            expect(firstRunDialogUp({ agreed: true, preview: false, noticeAcknowledged })).toBe(false);
            expect(firstRunDialogUp({ agreed: false, preview: false, noticeAcknowledged })).toBe(true);
        }
    });

    it('in the preview: up while either is missing, down only when both are given', () => {
        expect(firstRunDialogUp({ agreed: true, preview: true, noticeAcknowledged: false })).toBe(true);
        expect(firstRunDialogUp({ agreed: false, preview: true, noticeAcknowledged: true })).toBe(true);
        expect(firstRunDialogUp({ agreed: false, preview: true, noticeAcknowledged: false })).toBe(true);
        expect(firstRunDialogUp({ agreed: true, preview: true, noticeAcknowledged: true })).toBe(false);
    });
});
