'use client';

/**
 * One language rule, resolved in one module.
 *
 * Safety-relevant copy is written in the reader's language — never JP and EN
 * concatenated into one string. The old PWA had a catalog but never called
 * setLang and shipped ~327 hardcoded Japanese literals outside it, so the
 * advertised toggle did not exist. Everything user-visible goes through `t`
 * here so that cannot recur.
 */

import { useSyncExternalStore } from 'react';

export type Lang = 'ja' | 'en';

/** Structural shape shared by every catalog, so a missing or renamed key in one
 *  language is a compile error rather than a runtime `undefined` in the UI. */
interface Catalog {
    appRole: string;
    tab_diagnosis: string;
    tab_datalog: string;
    tab_log: string;
    connect: string;
    connecting: string;
    disconnect: string;
    connected: string;
    disconnected: string;
    practice: string;
    mode: string;
    mode_vehicle: string;
    mode_practice: string;
    ecu: string;
    readIdent: string;
    readFaults: string;
    startLog: string;
    stopLog: string;
    clearLog: string;
    exportCsv: string;
    exportLog: string;
    faults_none: string;
    faults_count: (n: number) => string;
    faults_code: string;
    faults_type: string;
    faults_frequency: string;
    faults_logistics: string;
    faults_freezeFrames: string;
    channels: string;
    channels_selected: (n: number, blocks: number) => string;
    rate: string;
    samples: string;
    notSupported_title: string;
    notSupported_body: string;
    error_electrical_title: string;
    error_electrical_body: string;
    error_desync_body: string;
    retry: string;
    unverified: string;
    provenance_title: string;
    tab_calibration: string;
    tab_testjobs: string;
    search: string;
    run: string;
    risk_all: string;
    risk_high: string;
    risk_medium: string;
    risk_low: string;
    gate_verified: string;
    gate_unverified: string;
    gate_practiceOnly: string;
    args_required: (names: string) => string;
    precond_voltage_ok: string;
    precond_stationary: string;
    precond_engine_off: string;
    module: string;
    faultRef: string;
    faultRef_note: string;
    catalog_jobs: (n: number) => string;
}

const STORAGE_KEY = 'e46m3.lang';

const STRINGS: Record<Lang, Catalog> = {
    ja: {
        appRole: 'DIAGNOSIS',
        tab_diagnosis: '診断',
        tab_datalog: 'データログ',
        tab_log: '通信ログ',

        connect: '接続',
        connecting: '接続中…',
        disconnect: '切断',
        connected: '接続済み',
        disconnected: '未接続',
        practice: 'PRACTICE',

        mode: 'モード',
        mode_vehicle: '実車 (Web Serial)',
        mode_practice: 'PRACTICE (車両不要)',

        ecu: 'モジュール',
        readIdent: '識別情報を読取',
        readFaults: '故障コードを読取',
        startLog: '記録開始',
        stopLog: '停止',
        clearLog: 'クリア',
        exportCsv: 'CSV出力',
        exportLog: '通信ログを保存',

        faults_none: '故障コードはありません',
        faults_count: (n: number) => `${n} 件の故障コード`,
        faults_code: 'コード',
        faults_type: '種別',
        faults_frequency: '発生回数',
        faults_logistics: 'ロジスティクス',
        faults_freezeFrames: 'フリーズフレーム',

        channels: 'チャンネル',
        channels_selected: (n: number, blocks: number) =>
            `${n} 項目 / ${blocks} ブロック = 1サンプルあたり ${blocks} 往復`,
        rate: '実効レート',
        samples: 'サンプル',

        notSupported_title: 'このブラウザでは実車接続できません',
        notSupported_body:
            'Web Serial API はデスクトップ版の Chrome / Edge でのみ利用できます。iOS・Android・Safari・Firefox は非対応です。PRACTICE モードは全てのブラウザで動作します。',

        error_electrical_title: '配線・電気的な問題の可能性があります',
        error_electrical_body:
            'K-line が送信中に引き下げられました。再試行では直りません。以下を上から順に確認してください。',
        error_desync_body: '通信のずれです。再試行で回復する可能性があります。',
        retry: '再試行',

        unverified:
            '未検証: このデータは実車で確認されていません。表示値は参考であり、診断の根拠にはできません。',
        provenance_title: 'データの出所',
        tab_calibration: 'キャリブレーション',
        tab_testjobs: 'アクチュエータテスト',
        search: '検索（ジョブ名・ラベル・独語原文）',
        run: '実行',
        risk_all: 'すべて',
        risk_high: '高',
        risk_medium: '中',
        risk_low: '低',
        gate_verified: '検証済み',
        gate_unverified: '未検証',
        gate_practiceOnly: '未検証のため実行できません。実車で1件ずつ検証し台帳に記録してから解禁します。',
        args_required: (names: string) => `引数: ${names}`,
        precond_voltage_ok: '電圧',
        precond_stationary: '停車',
        precond_engine_off: 'エンジン停止',
        module: 'モジュール',
        faultRef: '故障本文リファレンス',
        faultRef_note:
            'SGBD 由来の故障本文です。コードとの対応表は EdiabasLib が供給していたもので、まだ再構築できていません。検索用の参照として表示しています。',
        catalog_jobs: (n: number) => `${n} 件`,
    },
    en: {
        appRole: 'DIAGNOSIS',
        tab_diagnosis: 'Diagnosis',
        tab_datalog: 'Datalog',
        tab_log: 'Comms log',

        connect: 'Connect',
        connecting: 'Connecting…',
        disconnect: 'Disconnect',
        connected: 'Connected',
        disconnected: 'Not connected',
        practice: 'PRACTICE',

        mode: 'Mode',
        mode_vehicle: 'Vehicle (Web Serial)',
        mode_practice: 'PRACTICE (no vehicle)',

        ecu: 'Module',
        readIdent: 'Read identity',
        readFaults: 'Read fault memory',
        startLog: 'Start recording',
        stopLog: 'Stop',
        clearLog: 'Clear',
        exportCsv: 'Export CSV',
        exportLog: 'Save comms log',

        faults_none: 'No stored faults',
        faults_count: (n: number) => `${n} stored fault${n === 1 ? '' : 's'}`,
        faults_code: 'Code',
        faults_type: 'Type',
        faults_frequency: 'Frequency',
        faults_logistics: 'Logistics',
        faults_freezeFrames: 'Freeze frames',

        channels: 'Channels',
        channels_selected: (n: number, blocks: number) =>
            `${n} channel${n === 1 ? '' : 's'} across ${blocks} block${blocks === 1 ? '' : 's'} = ${blocks} round trip${blocks === 1 ? '' : 's'} per sample`,
        rate: 'Measured rate',
        samples: 'Samples',

        notSupported_title: 'This browser cannot connect to a vehicle',
        notSupported_body:
            'The Web Serial API is available only in desktop Chrome and Edge. iOS, Android, Safari and Firefox are not supported. PRACTICE mode works everywhere.',

        error_electrical_title: 'This looks like a wiring or electrical fault',
        error_electrical_body:
            'The K-line was pulled low during our own transmission. Retrying will not fix it. Work through these in order.',
        error_desync_body: 'The stream lost framing. A retry will usually recover it.',
        retry: 'Retry',

        unverified:
            'UNVERIFIED: this data has not been confirmed on a vehicle. Treat displayed values as indicative, not as a basis for diagnosis.',
        provenance_title: 'Data provenance',
        tab_calibration: 'Calibration',
        tab_testjobs: 'Actuator test',
        search: 'Search (job id, label, German original)',
        run: 'Run',
        risk_all: 'All',
        risk_high: 'High',
        risk_medium: 'Med',
        risk_low: 'Low',
        gate_verified: 'Verified',
        gate_unverified: 'Unverified',
        gate_practiceOnly:
            'Blocked: not verified on a vehicle. Each job is unlocked individually once a car has confirmed it and the ledger records the evidence.',
        args_required: (names: string) => `Args: ${names}`,
        precond_voltage_ok: 'Voltage',
        precond_stationary: 'Stationary',
        precond_engine_off: 'Engine off',
        module: 'Module',
        faultRef: 'Fault text reference',
        faultRef_note:
            'Fault texts from the SGBD. The code-to-text mapping was supplied by EdiabasLib and has not been rebuilt yet, so this is shown as a searchable reference rather than as decoded faults.',
        catalog_jobs: (n: number) => `${n} job${n === 1 ? '' : 's'}`,
    },
};

export type Strings = Catalog;

let current: Lang = 'ja';
const listeners = new Set<() => void>();

function read(): Lang {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        return v === 'en' || v === 'ja' ? v : 'ja';
    } catch {
        // Private mode. Default rather than fail — the language is not a
        // safety property, only the copy it selects is.
        return 'ja';
    }
}

if (typeof window !== 'undefined') current = read();

export function getLang(): Lang {
    return current;
}

export function setLang(lang: Lang): void {
    if (lang === current) return;
    current = lang;
    try {
        localStorage.setItem(STORAGE_KEY, lang);
    } catch {
        /* the switch still applies for this session */
    }
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
    listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
}

/** Re-renders on a language change. Server snapshot is the default language. */
export function useLang(): { lang: Lang; t: Strings; setLang: (l: Lang) => void } {
    const lang = useSyncExternalStore(
        subscribe,
        () => current,
        () => 'ja' as Lang,
    );
    return { lang, t: STRINGS[lang], setLang };
}
