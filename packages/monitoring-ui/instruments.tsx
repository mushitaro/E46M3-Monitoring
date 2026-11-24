'use client';

import type { ReactNode } from 'react';
import { EmbeddedLanguage, STRINGS } from '../../src/lib/i18n';

export { AdaptationView, AdaptationViz } from '../../src/views/adaptation/AdaptationView';
export { BoardLayout, type BoardSection } from '../../src/views/probe/BoardLayout';
export { StartupView } from '../../src/views/probe/StartupList';
export { ServiceView, ServiceViz } from '../../src/views/service/ServiceView';
export { loadSmg2Workflows, type Smg2Workflows } from '../../src/lib/smg2Workflows';
export { loadJobText, type JobTextTable } from '../../src/lib/jobText';
export { loadDscHydraulics, type DscHydraulics } from '../../src/lib/dscHydraulics';
export { SelectedDiagnosis } from '../../src/views/diagnosis/SelectedDiagnosis';
export { ScanList, ScanViz } from '../../src/views/diagnosis/ScanView';
export { DatalogView, type DatalogInstrument } from '../../src/views/datalog/DatalogView';
export { PART_S, segmentStats, type DatalogSegment } from '../../src/lib/datalogRun';
export { DatalogViz, type DatalogPlot } from '../../src/views/datalog/DatalogViz';
export { LogPopover } from '../../src/components/LogPopover';
export { exportCommsLog } from '../../src/lib/download';

const japanese = { lang: 'ja' as const, t: { ...STRINGS.ja, tab_log: '通信ログ' } };

export function JapaneseInstruments({ children }: { children: ReactNode }) {
    return <EmbeddedLanguage.Provider value={japanese}>{children}</EmbeddedLanguage.Provider>;
}
