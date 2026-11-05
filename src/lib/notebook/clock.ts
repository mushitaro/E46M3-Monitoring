import { anchoredTime, clockSessionId } from '../clock';
import type { NotebookEntry } from './rules';
/** Only this page's pre-anchor entries move; historical mandates are not revived. */
export function anchorEntry(e: NotebookEntry): NotebookEntry {
    if (e.clockSessionId && e.clockSessionId !== clockSessionId) return e;
    const at = anchoredTime(e.at);
    const step = at - e.at;
    return step === 0 ? e : { ...e, sourceAt: e.sourceAt ?? e.at, at, body: e.body.kind === 'mandate' ? { ...e.body, until: e.body.until + step } : e.body };
}
