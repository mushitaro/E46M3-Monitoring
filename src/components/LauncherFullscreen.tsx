'use client';

import { useEffect } from 'react';
import { OPENED_BY_LAUNCHER } from '@/hooks/useAssistantBridge';
import { isPlainTap, shouldTakeScreen } from '@/lib/launcherFullscreen';

/**
 * Takes the head unit's screen back when Chrome opened the launcher's page as a tab with its address
 * bar showing — see lib/launcherFullscreen.ts for why that happens only sometimes. Renders nothing;
 * does nothing anywhere the launcher did not open the page, or where the page is already shown
 * without a toolbar.
 */
export function LauncherFullscreen() {
    useEffect(() => {
        if (!OPENED_BY_LAUNCHER) return;
        const browserMode = matchMedia('(display-mode: browser)');
        const onTap = (e: PointerEvent) => {
            const env = {
                openedByLauncher: OPENED_BY_LAUNCHER,
                displayModeBrowser: browserMode.matches,
                fullscreenEnabled: document.fullscreenEnabled === true,
                inFullscreen: document.fullscreenElement !== null,
            };
            if (!shouldTakeScreen(env) || !isPlainTap(e.target)) return;
            document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch((error: unknown) => {
                console.warn('[LauncherFullscreen] full screen refused', error);
            });
        };
        // Armed for the whole visit: a back gesture leaves full screen, and the next plain tap
        // takes it again.
        document.addEventListener('pointerup', onTap);
        return () => document.removeEventListener('pointerup', onTap);
    }, []);
    return null;
}
