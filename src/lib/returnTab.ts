/**
 * The tab a page was on when an update reloaded it, so the new build opens there (SC11 step 4: the
 * owner was on DATALOG and came back to DIAGNOSIS). Kept for the one reload in this tab's session
 * storage, and taken once: an ordinary open still starts where the app starts.
 */
import { TAB_ORDER, type Tab } from '@/lib/tabs';

const KEY = 'monitoring.returnTab';

export function rememberTab(tab: Tab): void {
    try {
        sessionStorage.setItem(KEY, tab);
    } catch {
        // No storage (private mode, a head unit's browser): the new build opens where it always does.
    }
}

export function takeRememberedTab(): Tab | null {
    try {
        const v = sessionStorage.getItem(KEY);
        sessionStorage.removeItem(KEY);
        return v && (TAB_ORDER as readonly string[]).includes(v) ? (v as Tab) : null;
    } catch {
        return null;
    }
}
