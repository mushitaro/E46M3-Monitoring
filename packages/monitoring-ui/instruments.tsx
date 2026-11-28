'use client';

import type { ReactNode } from 'react';
import { EmbeddedLanguage, STRINGS } from '../../src/lib/i18n';

export { ActuatorViz } from '../../src/views/actuator/ActuatorViz';
export { ActuatorPanel, type ActuatorRequest } from '../../src/views/actuator/ActuatorView';
export { partTable } from '../../src/lib/partName';
export { AdaptationView, AdaptationViz } from '../../src/views/adaptation/AdaptationView';
export { ComparePanel, type ComparedValues } from '../../src/views/probe/ComparePanel';
export { ProbeGraph } from '../../src/views/probe/ProbeGraph';
export { BoardLayout, type BoardSection } from '../../src/views/probe/BoardLayout';
export { ValueCards } from '../../src/views/probe/ValueCards';
export { StartupSeries } from '../../src/views/probe/StartupSeries';
export { SyncCopies, type SyncCopiesState } from '../../src/views/sessions/SyncCopies';
export { MobileMenu } from '../../src/components/MobileMenu';
export { MarkIcon } from '../../src/components/MarkIcon';
export { CreditsDialog } from '../../src/components/CreditsDialog';
export { useInstallPrompt } from '../../src/hooks/useInstallPrompt';
export { DialogFrame } from '../../src/components/DialogFrame';
export { ConfirmDialog } from '../../src/components/ConfirmDialog';
export { SessionsView, SessionsViz, type MemoryViewState } from '../../src/views/sessions/SessionsView';
export { useJournal } from '../../src/views/sessions/useJournal';
export { sessionStore } from '../../src/lib/sync/sessionStore';
export { describeSave, describeSync, savePhase, syncPhase } from '../../src/lib/sync/status';
export { useLang as useInstrumentLanguage } from '../../src/lib/i18n';
export { SavedValues, VIEWER_ROWS } from '../../src/views/sessions/SavedValues';
export { StartupView } from '../../src/views/probe/StartupList';
export { ServiceView, ServiceViz } from '../../src/views/service/ServiceView';
export { loadSmg2Workflows, type Smg2Workflows } from '../../src/lib/smg2Workflows';
export { loadJobText, type JobTextTable } from '../../src/lib/jobText';
export { loadDscHydraulics, type DscHydraulics } from '../../src/lib/dscHydraulics';
export { SelectedDiagnosis } from '../../src/views/diagnosis/SelectedDiagnosis';
export { DiagnosisView, DiagnosisViz, type FaultRead } from '../../src/views/diagnosis/DiagnosisView';
export { ModuleRow } from '../../src/components/shell/Chrome';
export { ScanList, ScanViz } from '../../src/views/diagnosis/ScanView';
export { DatalogView, PlanSteps, type DatalogPlan, type DatalogInstrument } from '../../src/views/datalog/DatalogView';
export { PART_S, segmentStats, type DatalogSegment } from '../../src/lib/datalogRun';
export { DatalogViz, type DatalogPlot } from '../../src/views/datalog/DatalogViz';
export { LogPopover } from '../../src/components/LogPopover';
export { exportCommsLog } from '../../src/lib/download';

const shopChrome = {
    update_now: '更新',
    appRole: 'MONITORING',
    tab_diagnosis: '故障診断',
    tab_datalog: '測定記録',
    tab_log: '通信ログ',
    disconnect: '切断',
    module_all: '全モジュール',
    module_link: '回線',
    open_module: '開く',
    practice: '練習',
    practice_engine: 'エンジン',
    practice_engine_title: '練習車のエンジン。選択すると始動し、外すと停止します',
    probe: '調査',
    exportCsv: 'CSVを書き出す',
    retry: '再試行',
    tab_calibration: '校正',
    tab_testjobs: '作動テスト',
    tab_actuator: '作動テスト',
    hub_connect: '接続',
    hub_connecting: '接続中',
    hub_connected: '接続済み',
    hub_read: '読む',
    hub_reading: '読み取り中',
    hub_record: '録る',
    hub_stop: '止める',
    hub_recording: '記録中',
    pane_visualization: 'グラフと操作',
    pane_list: '一覧',
    pane_visu: 'グラフ',
    menu_open: 'メニュー',
    menu_close: '閉じる',
    menu_vehicle: '車両',
    menu_session: '診断の回',
    sync_panel: '記録の同期',
    menu_view: '表示',
    field_ident: '識別',
    field_len: '長さ',
    field_link: '接続',
    field_faults: '故障',
    field_log: 'ログ',
    reload: '再読み込み',
    install: 'インストール',
    details: '詳細',
    op_run: '実行',
    op_stop: '停止',
    op_abort: '中止',
    op_start: '開始',
    tab_adaptation: '学習値',
    adaptations_read: '学習値を読む',
    clearFaults: '故障記録を消す',
    tab_service: 'サービス',
    byte_addr: 'アドレス',
    byte_len: '長さ',
    byte_cmd: '命令',
    byte_ck: '検査値',
    credits_open: 'クレジット',
    wiz_next: '次へ',
    wiz_back: '戻る',
    wiz_close: '閉じる',
    tab_memory: 'メモリー',
    save: '保存',
    join: '結合',
    sync: '同期',
    save_nothing: '記録なし',
    save_busy: '保存中…',
    save_done: '保存済み',
    sync_busy: '同期中…',
    sync_done: '同期済み',
    sync_offline: 'オフライン',
    sync_signedOut: 'ログアウト済み',
    sync_unreachable: '接続できません',
    assistant: 'アシスタント',
    movingOk: '走行中の読み取り',
    movingOk_grant: '許可',
    restore: '復旧',
    view: '表示',
    back: '戻る',
    remove: '削除',
    privacy: 'プライバシー',
    github: 'GitHub',
    reauth: '再ログイン',
    pill_synced: '同期済み',
    pill_local: '端末内',
    mode_corner: 'モード',
    mode_manual: '手動',
    mode_probe: '調査',
    tab_startup: '開始',
    tab_probe: '調査',
    new_session: '新しく調べる',
    next_session: '次の調査へ',
    part_message: 'AI',
    part_faults: '故障',
    part_scan: '全モジュール',
    part_plan: '計画',
    part_judges: '判定',
    part_compare: '比較',
    part_values: '測定値',
    part_graph: 'グラフ',
    item_added: '追加',
    item_removed: '削除',
    series: '一連の調査',
    run_tag: '走行',
    pass: '良好',
    fail: '外れ',
} satisfies Record<keyof typeof import('../../src/lib/i18n/chrome').CHROME, string>;

const japanese = { lang: 'ja' as const, t: { ...STRINGS.ja, ...shopChrome, module: 'モジュール', mode_practice: '練習車を使う' } };

export function JapaneseInstruments({ children }: { children: ReactNode }) {
    return <EmbeddedLanguage.Provider value={japanese}>{children}</EmbeddedLanguage.Provider>;
}

export { emptyBoard, place as placeBoardParts, setShow as setBoardReadouts, boardLine, partProblem, type Board as InstrumentBoard, type Part as InstrumentPart } from '../../src/lib/probe/board';
export { DiagnosticFooter } from '../../src/components/DiagnosticFooter';
export { ControlPanel as InstrumentControlPanel } from '../../src/components/shell/ControlPanel';
export { TextButton as InstrumentTextButton } from '../../src/components/ui';
export { useLinkHub } from '../../src/hooks/useLinkHub';
