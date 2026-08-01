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
    cancel: string;
    gate_plan: string;
    gate_preconditions: string;
    hub_connect: string;
    hub_connecting: string;
    hub_connected: string;
    hub_read: string;
    hub_reading: string;
    hub_record: string;
    hub_stop: string;
    hub_recording: string;
    viz_faults: string;
    viz_clean: string;
    riskMix: string;
    pane_visualization: string;
    /** Empty-state copy. Terse, uppercase-technical: what the instrument is
     *  waiting for, not an apology for having nothing. */
    awaiting_read: string;
    awaiting_samples: string;
    awaiting_catalog: string;
    ident_note: (bytes: number) => string;
    details: string;
    /** The physical checklist for an electrical fault. Safety copy lives here,
     *  in the reader's language — not as English literals at the call site. */
    error_electrical_steps: string[];

    // --- The job-operation vocabulary ------------------------------------
    // Every one of these is safety copy: it tells the operator whether the
    // thing they are about to press ends by itself, has to be stopped by hand,
    // or cannot be undone at all.
    plan_kind: string;
    plan_steps: string;
    plan_optional: string;
    plan_needsStop: string;
    plan_ecuTimeout: string;
    plan_maxHold: string;
    plan_args: string;
    plan_telegram: string;
    plan_noTelegram: string;
    plan_selectHint: string;
    opKind: Record<OpKindKey, string>;
    opKindNote: Record<OpKindKey, string>;
    confidence: Record<'single' | 'multiple' | 'shared', string>;
    confidenceNote: Record<'single' | 'multiple' | 'shared', string>;

    // --- SMG II procedures ------------------------------------------------
    proc_title: string;
    proc_duration: string;
    proc_engine: string;
    proc_engineRun: string;
    proc_engineOff: string;
    proc_results: string;
    proc_status: string;
    proc_activity: string;
    proc_faults: string;
    proc_none: string;
    seq_title: string;
    seq_pickHint: string;

    // --- Controls ----------------------------------------------------------
    op_run: string;
    op_stop: string;
    op_abort: string;
    op_start: string;
    op_blocked_telegram: string;
    op_blocked_args: string;
    op_blocked_practice: string;
    /** Why each plan step exists. Safety copy — see jobOps.ts WhyKey. */
    op_why: Record<WhyKey, string>;
    /** Why an operation cannot be taken back. */
    op_irreversible: Record<IrrKey, string>;
}

type WhyKey =
    | 'why_read'
    | 'why_pulse'
    | 'why_write'
    | 'why_measure'
    | 'why_latching'
    | 'why_multiOutput'
    | 'why_driveAndReset'
    | 'why_switchOn'
    | 'why_switchOff'
    | 'why_pinDrive'
    | 'why_pairStart'
    | 'why_pairStop'
    | 'why_prepare'
    | 'why_driveActuator'
    | 'why_keepAlive'
    | 'why_testprgStop'
    | 'why_testprgStart'
    | 'why_testprgPoll'
    | 'why_unknown';

type IrrKey = 'irr_latching' | 'irr_pin' | 'irr_write';

type OpKindKey =
    | 'read'
    | 'pulse'
    | 'hold'
    | 'paired'
    | 'measurement'
    | 'latching'
    | 'compound'
    | 'procedure'
    | 'write'
    | 'unknown';

const STORAGE_KEY = 'e46m3.lang';

const STRINGS: Record<Lang, Catalog> = {
    ja: {
        appRole: 'DIAGNOSIS',
        tab_diagnosis: 'DIAGNOSIS',
        tab_datalog: 'DATALOG',
        tab_log: 'COMMS LOG',

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
        tab_calibration: 'CALIBRATION',
        tab_testjobs: 'ACTUATOR TEST',
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
        cancel: 'キャンセル',
        gate_plan: '送信内容',
        gate_preconditions: '前提条件（すべて確認）',
        hub_connect: '接続',
        hub_connecting: '接続中',
        hub_connected: '接続済み',
        hub_read: '読取',
        hub_reading: '読取中',
        hub_record: '記録',
        hub_stop: '停止',
        hub_recording: '記録中',
        viz_faults: '故障',
        viz_clean: '故障なし',
        riskMix: 'リスク内訳',
        pane_visualization: 'VISUALIZATION & CONTROLS',
        awaiting_read: '読取待機中…',
        awaiting_samples: 'サンプル待機中…',
        awaiting_catalog: 'カタログ未読込…',
        ident_note: (b) =>
            `${b} バイト — この応答のフィールド配置はまだ判明していません。EdiabasLib が解釈していた部分で、推測せず生値のまま表示しています。`,
        details: '詳細',
        error_electrical_steps: [
            'エンジン停止時と稼働時で失敗率を比べてください。稼働時だけ不安定なら、非シールドケーブルへの点火系ノイズ（EMI）であってソフトウェアの問題ではありません。',
            'OBD コネクタを挿し直し、接続したまま軽く動かして接触を確認してください。',
            '別の USB ポートに、ハブを介さず直接挿してください。',
            'ポートのグラウンドと電源を確認してください。',
            'アダプタの VID/PID を控えてください。FTDI のクローンチップは非常に多く出回っています。',
        ],

        plan_kind: '操作の種類',
        plan_steps: '実行手順（送信順）',
        plan_optional: '任意',
        plan_needsStop: '停止操作が必要',
        plan_ecuTimeout: 'ECUタイムアウト',
        plan_maxHold: '最大保持',
        plan_args: '引数',
        plan_telegram: '送信テレグラム',
        plan_noTelegram: 'このジョブのテレグラムは静的解析で復元できていません。SGBD が引数から実行時に組み立てるためです。',
        plan_selectHint: 'ジョブを選択すると、その操作内容がここに表示されます',
        opKind: {
            read: '読取',
            pulse: '単発',
            hold: '保持',
            paired: '対ジョブ',
            measurement: '測定',
            latching: 'ラッチ',
            compound: '複合',
            procedure: '自動プログラム',
            write: '書込',
            unknown: '不明',
        },
        opKindNote: {
            read: '値を読み出すだけで、ECU の状態は変わりません。何度実行しても安全です。',
            pulse: '一度作動し、ECU 側で自動的に終了します。停止操作はありません。',
            hold: '停止するまで出力が入ったままになります。停止操作とデッドマン（通信途絶での自動解除）が必要です。',
            paired: '別名のジョブを送るまで作動し続けます。開始と停止が別ジョブになっています。',
            measurement: '測定を開始します。ECU が最後まで実行し、結果はライブ値ブロックに現れます。',
            latching: '作動後ラッチします。SGBD に解除ジョブが存在せず、このアプリからは戻せません。',
            compound: 'SGBD ジョブ自体が複数の出力を順に駆動します。単一の操作ではありません。',
            procedure: 'ECU が複数ステップの試験プログラムを自走させ、進行状況と結果コードを報告します。中断可能です。',
            write: '永続的な状態を書き換えます。元の値を読み戻す手段がないため、取り消せません。',
            unknown: 'SGBD のコメントに記述がなく、動作を確定できていません。',
        },
        confidence: { single: '一意', multiple: '複数候補', shared: '共有' },
        confidenceNote: {
            single: 'このジョブだけが出すテレグラムです。静的解析で一意に特定できています。',
            multiple: '複数の候補があります。引数や ECU 状態によって分岐するため、どれが出るかは確定できません。',
            shared: '他のジョブと同一のテレグラムです。SGBD が実行時に引数から組み立てる雛形であり、このジョブのテレグラムではありません。',
        },

        proc_title: 'ガイド手順（試験プログラム）',
        proc_duration: '所要時間',
        proc_engine: 'エンジン',
        proc_engineRun: '稼働',
        proc_engineOff: '停止',
        proc_results: '結果ブロック',
        proc_status: '実行ステータス',
        proc_activity: '進行状況コード',
        proc_faults: '結果コード',
        proc_none: 'このモジュールにガイド手順はありません（SMG II のみ）',
        seq_title: '推奨シーケンス',
        seq_pickHint: 'ステップを押すとその手順を表示します',

        op_run: '実行',
        op_stop: '停止',
        op_abort: '中断',
        op_start: '開始',
        op_blocked_telegram: 'テレグラム未確定のため実行できません',
        op_blocked_args: '引数が必要です',
        op_blocked_practice: 'PRACTICE の模擬 ECU はこのジョブを実装していません',
        op_why: {
            why_read: '値を読み出して返します。ECU の状態は変わりません。',
            why_pulse: '一度作動します。終了は ECU 側が行います。',
            why_write: '永続的な状態を書き込みます。',
            why_measure: '測定を開始します。ECU が最後まで実行し、結果はライブ値ブロックに現れます。',
            why_latching: 'デジタル制御で作動させ、そのまま保持します。',
            why_multiOutput: '複数のデジタル出力を順に駆動します。',
            why_driveAndReset: 'STEUERN_DIGITAL を駆動し、続けてリセットします。ECU が自ら行う2段階のジョブです。',
            why_switchOn: '出力を ON にします。',
            why_switchOff: '同じジョブを SCHALTEN の逆値で送り、OFF に戻します。',
            why_pinDrive: '指定ピンを、指定のデューティ比・周期で直接駆動します。',
            why_pairStart: '開始します。対になるジョブを送るまで作動し続けます。',
            why_pairStop: '対になるジョブが開始した動作を終了させます。',
            why_prepare: 'SGBD の要求：スタータ解除・油圧ポンプ・故障表示・シフトロックではこのジョブを先に送る必要があります。ECU の時間カウンタもここでゼロに戻ります。',
            why_driveActuator: '選択したアクチュエータを駆動します。',
            why_keepAlive: 'セッションを維持します。ECU のタイムアウトは 10 秒、実行は最長 960 秒に及びます。',
            why_testprgStop: 'SGBD の要求：「TESTPRG_STARTEN より前に送ること」。',
            why_testprgStart: '試験プログラムを開始します（TESTPRG_NR、選択を伴う場合は AUSWAHLBYTE）。',
            why_testprgPoll: '実行ステータス・進行状況コード・最終的な結果コードをポーリングします。',
            why_unknown: 'SGBD のコメントに動作の記述がありません。',
        },
        op_irreversible: {
            irr_latching: 'DSC_SIM_* には SGBD 上に解除ジョブが存在しません。一度作動させると作動したままになり、復帰はコマンドではなくイグニッションサイクルです。',
            irr_pin: '任意の出力ピンを強制駆動します。SGBD 側にピンの制約が無いため、無害なピンと破損させうるピンをこのアプリでは区別できません。',
            irr_write: 'イグニッションサイクルをまたいで残る状態を書き換えます。事前に元の値を読み戻す手段がこのアプリには無いため、取り消せません。',
        },
    },
    en: {
        appRole: 'DIAGNOSIS',
        tab_diagnosis: 'DIAGNOSIS',
        tab_datalog: 'DATALOG',
        tab_log: 'COMMS LOG',

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
        tab_calibration: 'CALIBRATION',
        tab_testjobs: 'ACTUATOR TEST',
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
        cancel: 'Cancel',
        gate_plan: 'What will be sent',
        gate_preconditions: 'Preconditions (confirm all)',
        hub_connect: 'Connect',
        hub_connecting: 'Linking',
        hub_connected: 'Linked',
        hub_read: 'Read',
        hub_reading: 'Reading',
        hub_record: 'Record',
        hub_stop: 'Stop',
        hub_recording: 'Recording',
        viz_faults: 'faults',
        viz_clean: 'No faults',
        riskMix: 'Risk mix',
        pane_visualization: 'VISUALIZATION & CONTROLS',
        awaiting_read: 'AWAITING READ…',
        awaiting_samples: 'AWAITING SAMPLES…',
        awaiting_catalog: 'AWAITING CATALOG…',
        ident_note: (b) =>
            `${b} bytes — the field layout of this response is not known yet. EdiabasLib used to decode it; shown raw rather than guessed at.`,
        details: 'Details',
        error_electrical_steps: [
            'Compare failure rates with the engine off vs running. If it only misbehaves while running, it is ignition/motor EMI on an unshielded cable — not the software.',
            'Reseat the OBD connector, and wiggle-test it while connected.',
            'Try a different USB port, with no hub in between.',
            "Check the port's ground and supply.",
            "Note the adapter's VID/PID — clone FTDI chips are common.",
        ],

        plan_kind: 'Operation',
        plan_steps: 'Plan (wire order)',
        plan_optional: 'optional',
        plan_needsStop: 'needs a stop',
        plan_ecuTimeout: 'ECU timeout',
        plan_maxHold: 'Max hold',
        plan_args: 'Arguments',
        plan_telegram: 'Request telegram',
        plan_noTelegram:
            'No telegram recovered for this job. The SGBD assembles the request from arguments at run time, which a static scrape cannot evaluate.',
        plan_selectHint: 'Select a job to see what it does',
        opKind: {
            read: 'Read',
            pulse: 'Pulse',
            hold: 'Hold',
            paired: 'Paired',
            measurement: 'Measurement',
            latching: 'Latching',
            compound: 'Compound',
            procedure: 'Program',
            write: 'Write',
            unknown: 'Unknown',
        },
        opKindNote: {
            read: 'Reads values and changes nothing. Safe to repeat.',
            pulse: 'Actuates once and ends by itself. There is nothing to stop.',
            hold: 'Stays energised until stopped. Needs a stop control and a deadman that releases it if the link dies.',
            paired: 'Runs until a DIFFERENTLY NAMED job ends it. Start and stop are separate jobs.',
            measurement: 'Triggers a measurement the ECU runs to completion; the result appears in the live blocks.',
            latching: 'Actuates and latches. The SGBD exposes no release job, so this cannot be undone from here.',
            compound: 'The SGBD job itself drives several outputs in sequence. This is not a single action.',
            procedure: 'A multi-step program the ECU runs by itself, reporting progress and a result code. Abortable.',
            write: 'Writes persistent state. Nothing here can read the previous value back, so there is no undo.',
            unknown: 'The SGBD comment does not state what this does, so neither will this panel.',
        },
        confidence: { single: 'Unambiguous', multiple: 'Several candidates', shared: 'Shared' },
        confidenceNote: {
            single: 'Emitted by this job and no other. The static scrape resolved it uniquely.',
            multiple:
                'Several candidates. The job branches on arguments or ECU state the scrape cannot evaluate, so which one goes out is not decidable here.',
            shared:
                'The same frame appears under several job names. It is the template the SGBD fills in at run time — NOT this job‘s telegram.',
        },

        proc_title: 'Guided procedures (test programs)',
        proc_duration: 'Duration',
        proc_engine: 'Engine',
        proc_engineRun: 'Running',
        proc_engineOff: 'Stopped',
        proc_results: 'Result block',
        proc_status: 'Run status',
        proc_activity: 'Activity codes',
        proc_faults: 'Result codes',
        proc_none: 'This module has no guided procedures (SMG II only)',
        seq_title: 'Suggested sequences',
        seq_pickHint: 'Press a step to show that procedure',

        op_run: 'Run',
        op_stop: 'Stop',
        op_abort: 'Abort',
        op_start: 'Start',
        op_blocked_telegram: 'Blocked — the telegram for this job is not established',
        op_blocked_args: 'Arguments required',
        op_blocked_practice: 'The PRACTICE ECU does not implement this job',
        op_why: {
            why_read: 'reads and returns values; the ECU state does not change',
            why_pulse: 'actuates once; the ECU ends it by itself',
            why_write: 'writes persistent state',
            why_measure: 'triggers a measurement the ECU runs to completion; the result appears in the live blocks',
            why_latching: 'actuates and HOLDS via digital control',
            why_multiOutput: 'drives several digital outputs in sequence',
            why_driveAndReset: 'drives, then resets, STEUERN_DIGITAL — a two-phase job the ECU runs itself',
            why_switchOn: 'switches the output ON',
            why_switchOff: 'switches it OFF again — same job, opposite SCHALTEN value',
            why_pinDrive: 'drives the chosen pin directly at the given duty cycle and period',
            why_pairStart: 'starts, and stays active until its counterpart is sent',
            why_pairStop: 'ends the operation its counterpart started',
            why_prepare:
                'the SGBD requires it for the starter release, hydraulic pump, fault indicator and shift lock, and it resets the ECU time counter',
            why_driveActuator: 'drives the selected actuator',
            why_keepAlive: 'keeps the session alive — the ECU timeout is 10 s and a run can last 960',
            why_testprgStop: 'the SGBD requires it: "Must be sent BEFORE TESTPRG_STARTEN!"',
            why_testprgStart: 'starts the program (TESTPRG_NR, and AUSWAHLBYTE where it takes a selection)',
            why_testprgPoll: 'polled for the run status, the activity code, and finally the result code',
            why_unknown: 'the SGBD comment does not state what this does',
        },
        op_irreversible: {
            irr_latching:
                'The SGBD exposes no release job for DSC_SIM_*. Once actuated it stays actuated; recovery is an ignition cycle, not a command.',
            irr_pin:
                'Forces an arbitrary output pin. Nothing in the SGBD constrains which pin, so nothing here can tell a harmless one from a damaging one.',
            irr_write:
                'Writes state that survives an ignition cycle. Nothing in this app can read the previous value back first, so there is no undo.',
        },
    },
};

export type Strings = Catalog;

let current: Lang = 'ja';
const listeners = new Set<() => void>();

/**
 * An explicit choice wins; otherwise the browser decides.
 *
 * Falling back to 'ja' unconditionally handed a first-time English-speaking user
 * a fully Japanese instrument — tabs, hub verbs, and the UNVERIFIED safety
 * banner — with only a 20px `ja | en` pair in the header corner to escape it.
 * A safety notice nobody can read is not a safety notice.
 */
function fromNavigator(): Lang {
    if (typeof navigator === 'undefined') return 'ja';
    return navigator.language?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

function read(): Lang {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === 'en' || v === 'ja') return v;
    } catch {
        // Private mode. Fall through — the language is not a safety property,
        // only the copy it selects is.
    }
    return fromNavigator();
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
