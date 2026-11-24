'use client';

import type { ReactNode } from 'react';
import { EmbeddedLanguage, STRINGS } from '../../src/lib/i18n';

export { AdaptationView, AdaptationViz } from '../../src/views/adaptation/AdaptationView';
export { ScanList, ScanViz } from '../../src/views/diagnosis/ScanView';
export { DatalogViz, type DatalogPlot } from '../../src/views/datalog/DatalogViz';
export { LogPopover } from '../../src/components/LogPopover';
export { exportCommsLog } from '../../src/lib/download';

const japanese = { lang: 'ja' as const, t: { ...STRINGS.ja, tab_log: '通信ログ' } };

export function JapaneseInstruments({ children }: { children: ReactNode }) {
    return <EmbeddedLanguage.Provider value={japanese}>{children}</EmbeddedLanguage.Provider>;
}
