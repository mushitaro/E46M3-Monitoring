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
import type { Audience, JobClass, ResultDelivery, ResultRole, Actor, Termination, Risk } from './ecuCatalog';
import type { IrreversibleKey, OpKind, WhyKey } from './jobOps';

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
    channels_pick: string;
    datalog_run: string;
    channels_search: string;
    channels_block: string;
    channels_blockNote: (selection: number) => string;
    channels_alsoIn: (blocks: string) => string;
    channels_alsoInNote: string;
    datalog_exportsRun: (n: number) => string;
    faults_read: string;
    faultRef_search: string;
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
    opKind: Record<OpKind, string>;
    opKindNote: Record<OpKind, string>;
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
    proc_steps: string;
    det_blockInferred: (job: string, arg: string, value: string) => string;
    gear_windows: string;
    gear_noSpec: string;
    gear_name: Record<'1' | '2' | '3' | '4' | '5' | '6' | 'R', string>;
    gear_measure: Record<'SW' | 'WW_TOUCH_L' | 'WW_TOUCH_R', string>;
    gear_gate: string;
    gear_gateNote: string;

    // --- DSC hydraulics ----------------------------------------------------
    dsc_title: string;
    dsc_stop: string;
    dsc_allOutputsOff: string;
    dsc_appConstruct: string;
    dsc_drivesNote: string;
    dsc_absenceHint: string;
    dsc_runnerUp: (list: string) => string;
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
    op_irreversible: Record<IrreversibleKey, string>;

    // --- Steps -------------------------------------------------------------
    step_order: Record<'ecu-defined' | 'app-recommended' | 'unordered-set', string>;
    step_orderNote: Record<'ecu-defined' | 'app-recommended' | 'unordered-set', string>;
    step_state: Record<'running' | 'passed' | 'done' | 'failed' | 'unknown', string>;
    step_meta: Record<string, string>;

    // --- The merged JOBS pane ---------------------------------------------
    tab_service: string;
    /** The facet axes. Named, because a filter whose axis is unlabelled is a mystery toggle. */
    facet_purpose: string;
    facet_audience: string;
    facet_system: string;
    facet_all: string;
    facet_hidden: (n: number) => string;
    jobClass: Record<JobClass, string>;
    /** One line saying what the class IS — the answer to "what is different
     *  between the jobs under CALIBRATION and the ones under ACTUATOR TEST". */
    jobClassNote: Record<JobClass, string>;
    audience: Record<Audience, string>;
    audienceNote: Record<Audience, string>;
    system: Record<string, string>;

    // --- The operation shape, in four independent axes ---------------------
    op_actor: string;
    op_termination: string;
    op_delivery: string;
    op_prerequisites: string;
    actor: Record<Actor, string>;
    termination: Record<Termination, string>;
    delivery: Record<ResultDelivery, string>;
    /** Where the answer to a companion-job test is read. */
    op_resultJob: (job: string) => string;


    // --- The job's contents -------------------------------------------------
    det_results: string;
    det_resultCount: (n: number) => string;
    det_results_note: string;
    det_args: string;
    det_values: string;
    det_noValues: string;
    det_whenArg: (arg: string, values: string) => string;
    det_inferred: string;
    det_optionsDropped: (list: string) => string;
    det_optionsFromComment: string;
    det_argBindsNoResults: (arg: string, value: string) => string;
    resultRole: Record<ResultRole, string>;

    // --- Calibration values -------------------------------------------------
    spec_current: string;
    spec_min: string;
    spec_max: string;
    spec_default: string;
    spec_always: string;
    /** The correction that matters most: Default is the FACTORY value, not a target. */
    spec_defaultNote: string;
    spec_verdict: Record<'in-range' | 'out-of-range' | 'unknown', string>;
    spec_needsRun: string;
    spec_crossField: (a: string, b: string) => string;
    risk_label: Record<Risk, string>;
    provenance: Record<'sgbd-comment' | 'sgbd-args' | 'name-heuristic' | 'authored' | 'inferred', string>;
}

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
        channels_pick: '記録するチャンネルを選ぶ',
        datalog_run: '記録',
        channels_search: '検索（シンボル名・項目名）',
        channels_block: 'ブロック',
        channels_blockNote: (s) => `選択 ${s} — 同一ブロックの項目は1往復でまとめて読めます`,
        datalog_exportsRun: (n) =>
            `書き出すのは直前の記録（${n}チャンネル）です。いま選び直したチャンネルではありません。`,
        channels_alsoIn: (b) => `＋${b}`,
        channels_alsoInNote:
            'この量は他のブロックにもあります。すでに読んでいるブロックの方を選べば往復が増えません。ブロックが違えば別チャンネルとして記録されます。',
        faults_read: '読み取った故障',
        faultRef_search: '検索（コード・訳文・独語原文）',
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
            'SGBD の FORTTEXTE 表そのものです。故障コードと本文の対応が付いているので、読み取った故障には本文が直接付きます。ここはコード・訳文・独語原文のいずれでも引ける検索用の一覧です。',
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
            deferred: '別ジョブで結果',
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
            deferred: '試験を開始しますが、このジョブ自身は結果を返しません。判定は別名のジョブで読み出します。開始だけでは何も分かりません。',
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
        proc_steps: 'ECU が実行する手順',
        det_blockInferred: (j, a, v) =>
            `SGBD はこの対応を明示していません。結果名の接頭辞から ${j}（${a} = ${v}）と推定しています。`,
        gear_windows: 'ギアごとの測定窓',
        gear_noSpec:
            'この42個に規定値はありません。SGBD が上限・下限を公表していないため、合否は判定できません。前回の読取値との比較、およびギア間の比較にのみ使えます。',
        gear_name: { '1': '1速', '2': '2速', '3': '3速', '4': '4速', '5': '5速', '6': '6速', R: '後退（R）' },
        gear_measure: { SW: 'シフト経路', WW_TOUCH_L: 'セレクト角 左端', WW_TOUCH_R: 'セレクト角 右端' },
        gear_gate: 'ゲート',
        gear_gateNote:
            '左端の記号は、そのギアが入っているゲート（Gasse）です。2速ずつが同じゲートを共有するので、対になる2速が同じ方向にずれていれば、疑うのはギアではなくゲートの値の方です。ニュートラルはゲートを持たず、POS_SW_N_WERT を単独で見ます。この対応は SGBD には書かれておらず、INPA の getriebeschema／beliebigen_gang_einlegen 画面が読み取り方をそう組んでいることによります。',

        dsc_title: 'ブレーキ油圧の操作',
        dsc_stop: '停止',
        dsc_allOutputsOff: '全出力OFF',
        dsc_appConstruct: 'アプリの構成物',
        dsc_drivesNote:
            '各行の弁名は、抽出したバイトコード中でその操作が**どこかの時点で**駆動する電磁弁の一覧です。同時に駆動するという意味ではなく、静的抽出には順序がありません。片側エア抜きの一覧に反対側の排出弁が入るのはそのためで、こちらでは解釈しません。',
        dsc_absenceHint: 'この族には SGBD にジョブが存在しない場所があります。上の該当行に理由を書いています。',
        dsc_runnerUp: (l) =>
            `全出力OFF の候補は他にもあります: ${l}。違いは STEUERN 表が名前を持たないビットなので、どちらが正しいかはこちらでは決められません。`,
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
            why_switchOn: '出力を ON にします。',
            why_switchOff: '同じジョブを SCHALTEN の逆値で送り、OFF に戻します。',
            why_pinDrive: '指定ピンを、指定のデューティ比・周期で直接駆動します。',
            why_pairStart: '開始します。対になるジョブを送るまで作動し続けます。',
            why_pairStop: '対になるジョブが開始した動作を終了させます。',
            why_prerequisite: 'SGBD がこのジョブを先に送ることを要求しています。省くと ECU が拒否します。',
            why_deferredStart: '試験を開始します。このジョブ自身は判定を返しません。',
            why_readResult: '判定を読み出します。開始したジョブとは別名のジョブで、これを送らないと結果は分かりません。',
            why_prepare: 'SGBD の要求：スタータ解除・油圧ポンプ・故障表示・シフトロックではこのジョブを先に送る必要があります。ECU の時間カウンタもここでゼロに戻ります。',
            why_driveActuator: '選択したアクチュエータを駆動します。',
            why_keepAlive: 'セッションを維持します。ECU のタイムアウトは 10 秒、実行は最長 960 秒に及びます。',
            why_testprgStop: 'SGBD の要求：「TESTPRG_STARTEN より前に送ること」。',
            why_testprgStart: '試験プログラムを開始します（TESTPRG_NR、選択を伴う場合は AUSWAHLBYTE）。',
            why_testprgPoll: '**同じジョブを送り続けて**実行ステータス・進行状況コード・結果コードを読みます。SGBD の指示: 「この結果が 1 以外を返すまで送り続けること」。別のジョブで読むのではありません。',
            why_unknown: 'SGBD のコメントに動作の記述がありません。',
        },
        op_irreversible: {
            irr_latching: 'DSC_SIM_* には SGBD 上に解除ジョブが存在しません。一度作動させると作動したままになり、復帰はコマンドではなくイグニッションサイクルです。',
            irr_pin: '任意の出力ピンを強制駆動します。SGBD 側にピンの制約が無いため、無害なピンと破損させうるピンをこのアプリでは区別できません。',
            irr_write: 'イグニッションサイクルをまたいで残る状態を書き換えます。事前に元の値を読み戻す手段がこのアプリには無いため、取り消せません。',
            irr_eeprom: 'RAM 上の値を EEPROM へ確定書込します。ここまでは書き戻せましたが、この操作以降は戻せません。',
        },

        step_order: {
            'ecu-defined': 'ECU が定める順序',
            'app-recommended': '推奨順序（SGBD に順序定義なし）',
            'unordered-set': '順序なし・選んで実行',
        },
        step_orderNote: {
            'ecu-defined': 'この順序は ECU 自身が報告するものです。番号順ではなく実行順に並んでいます。',
            'app-recommended': 'SGBD のテーブルに順序の定義はありません。各手順の依存関係と整備実務から組んだ推奨です。',
            'unordered-set': '互いに代替となる操作の集合です。順番はありません。',
        },
        step_state: { running: '実行中', passed: '通過', done: '完了', failed: '失敗', unknown: '不明' },
        step_meta: { duration: '所要', engine: 'エンジン', valves: '駆動' },

        tab_service: 'SERVICE',
        facet_purpose: '用途',
        facet_audience: '対象',
        facet_system: '系統',
        facet_all: 'すべて',
        facet_hidden: (n) => `絞り込みにより ${n} 件を非表示`,
        jobClass: {
            read: '読取',
            test: '作動テスト',
            calibration: '較正・学習値',
            coding: 'コーディング',
            programming: '書換（非対応）',
            protocol: '手順の部品',
        },
        jobClassNote: {
            read: '値を読み出すだけです。車両の状態は変わらず、何度実行しても構いません。',
            test: '部品を一時的に動かして確かめます。終われば元の状態に戻ります（ラッチするものだけは戻りません。個別に明示しています）。',
            calibration: '学習値・調整値を書き換えます。イグニッションを切っても残り、元の値に戻す手段はありません。',
            coding: '車両の装備構成を書き換えます。他の ECU との整合が崩れると警告灯や機能停止につながります。',
            programming: 'ECU のプログラム領域そのものを扱います。**このアプリからは実行しません。** 失敗した ECU は起動しなくなり、復旧はベンチ作業か交換です（WinKFP の領域）。',
            protocol: '他のジョブの手順の一部です。単体で実行しても意味がありません。',
        },
        audience: { owner: 'オーナー', technician: '整備者', protocol: 'プロトコル内部' },
        audienceNote: {
            owner: '車両オーナーが意味を判断できる操作です。',
            technician: '整備の知識と、失敗したときの復旧手段を前提とする操作です。',
            protocol: '他ジョブの内部で使われるもので、単体では実行対象になりません。',
        },
        system: {
            faults: '故障メモリ',
            vanos: 'VANOS（可変バルブタイミング）',
            fuel: '燃料・噴射',
            emissions: '排ガス・触媒・O2センサ',
            air: '吸気・スロットル・ペダル',
            ignition: '点火・ノック',
            cooling: '冷却・オイル',
            clutch: 'クラッチ',
            gearbox: '変速機',
            brakes: 'ブレーキ油圧',
            tyres: 'タイヤ空気圧',
            stability: '走行安定制御',
            steering: 'ステアリング',
            sensors: 'センサ',
            electrical: '電源・リレー・入出力',
            ecu: 'ECU 本体・識別',
            engine: 'エンジン制御',
            unknown: '不明',
        },

        op_actor: '誰が進めるか',
        op_termination: '終わり方',
        op_delivery: '結果の出どころ',
        op_prerequisites: '先に送るジョブ',
        actor: {
            ecu: 'ECU が自動で進めます',
            app: 'アプリが送り続ける必要があります',
            operator: '人が手を動かす必要があります',
            driver: '走行が必要です',
        },
        termination: {
            self: '自動で終わります',
            'app-stop': 'アプリが止めます',
            'companion-job': '別名のジョブが止めます',
            none: '止まりません（ラッチ）',
        },
        delivery: {
            inline: 'このジョブの応答に入っています',
            'companion-job': '別のジョブで読み出します',
            'live-block': 'ライブ値ブロックに現れます',
            none: '結果はありません',
        },
        op_resultJob: (job) => `判定は ${job} で読み出します`,


        det_results: 'このジョブが返す内容',
        det_resultCount: (n) => `返り値 ${n}`,
        det_results_note:
            'SGBD が宣言している結果です。値・単位・平文の三つ組は1行にまとめています。実行しないと現在値は入りません。',
        det_args: '指定が必要な引数',
        det_values: '調整値・規定値',
        det_noValues: 'このジョブに規定値の公表はありません。SGBD にも復元元にも下限・上限が存在しないためで、「まだ調べていない」ではありません。',
        det_whenArg: (arg, values) => `${arg} が ${values} のときだけ返ります`,
        det_inferred: '推定',
        det_optionsDropped: (l) => `SGBD の記述により除外: ${l}`,
        det_optionsFromComment: 'コメント',
        det_argBindsNoResults: (a, v) =>
            `${a} = ${v} に紐づく名前付きの結果を SGBD は 1 つも宣言していません。返るのは常に返る結果（生データ DATEN を含む）だけです。値が無いのではなく、項目名が公表されていません。`,
        resultRole: {
            value: '値',
            unit: '単位',
            text: '平文',
            status: 'ジョブ状態',
            telegram: 'テレグラム',
            raw: '生データ',
        },

        spec_current: '現在値',
        spec_min: '下限',
        spec_max: '上限',
        spec_default: '出荷既定',
        spec_always: '固定値',
        spec_defaultNote:
            '「出荷既定」は工場出荷時の値であって、目標値ではありません。学習値がここから離れているのは正常です。判定するのは上限・下限の範囲内かどうかだけです。',
        spec_verdict: { 'in-range': '範囲内', 'out-of-range': '範囲外', unknown: '判定不能' },
        spec_needsRun: '現在値の取得には実行が必要です。実行面は未解禁のため、ここでは範囲と既定値のみ表示しています。',
        spec_crossField: (a, b) => `${a} と ${b} の差に対する制約`,
        risk_label: { low: '低', medium: '中', high: '高' },
        provenance: {
            'sgbd-comment': 'SGBD 記述',
            'sgbd-args': 'SGBD 引数',
            'name-heuristic': '名称からの推定',
            authored: '個別記述',
            inferred: '推定',
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
        channels_pick: 'Choose what to record',
        datalog_run: 'Recording',
        channels_search: 'Search (symbol, name)',
        channels_block: 'Block',
        channels_blockNote: (s) => `Selection ${s} — everything in one block costs a single round trip`,
        datalog_exportsRun: (n) =>
            `Export writes the run that was recorded (${n} channel(s)), not the selection as it stands now.`,
        channels_alsoIn: (b) => `+${b}`,
        channels_alsoInNote:
            'This quantity is also in another block. Taking the copy from a block you already read costs no extra round trip. Different blocks are recorded as different channels.',
        faults_read: 'Faults read',
        faultRef_search: 'Search (code, translation, German original)',
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
            "The SGBD's own FORTTEXTE table. It is keyed by fault code, so a fault that is read gets its text directly; this list is the searchable reference, by code, translation or German original.",
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
            deferred: 'Result elsewhere',
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
            deferred:
                'Starts a test but returns no verdict of its own. The answer is read by a differently-named job; starting it alone tells you nothing.',
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
        proc_steps: 'What the ECU does, step by step',
        det_blockInferred: (j, a, v) =>
            `The SGBD does not state this mapping. It is inferred from the result-name prefixes as ${j} (${a} = ${v}).`,
        gear_windows: 'Per-gear measurement windows',
        gear_noSpec:
            'None of these 42 has a stated range — the SGBD publishes no limits for them, so there is no pass or fail to give. They are comparable against a previous read and against each other.',
        gear_name: { '1': '1st', '2': '2nd', '3': '3rd', '4': '4th', '5': '5th', '6': '6th', R: 'Reverse' },
        gear_measure: { SW: 'Shift travel', WW_TOUCH_L: 'Gate stop, left', WW_TOUCH_R: 'Gate stop, right' },
        gear_gate: 'Gate',
        gear_gateNote:
            'The mark on the left is the gate (Gasse) the gear sits in. Two gears share one gate, so when both gears of a pair read off in the same direction, the thing to suspect is the gate value, not the gears. Neutral sits in no gate and is read on its own as POS_SW_N_WERT. The SGBD does not state this pairing; it is how INPA’s getriebeschema and beliebigen_gang_einlegen screens read the two together.',

        dsc_title: 'Brake hydraulic operations',
        dsc_stop: 'Stop',
        dsc_allOutputsOff: 'All outputs off',
        dsc_appConstruct: "the app's own construct",
        dsc_drivesNote:
            "The valve names on each row are every solenoid that operation actuates **at some point** in the extracted bytecode. It does not mean they are driven together — a static extraction has no order. That is why a one-side bleed lists the opposite side's outlet valves, and this app does not interpret it.",
        dsc_absenceHint: 'This family has a place the SGBD provides no job for. The row above says which, and why.',
        dsc_runnerUp: (l) =>
            `There are other all-outputs-off candidates: ${l}. They differ only in bits the STEUERN table does not name, so which is correct is not something this app can decide.`,
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
            why_switchOn: 'switches the output ON',
            why_switchOff: 'switches it OFF again — same job, opposite SCHALTEN value',
            why_pinDrive: 'drives the chosen pin directly at the given duty cycle and period',
            why_pairStart: 'starts, and stays active until its counterpart is sent',
            why_pairStop: 'ends the operation its counterpart started',
            why_prerequisite: 'the SGBD requires this to be sent first; skip it and the ECU refuses',
            why_deferredStart: 'starts the test; this job returns no verdict of its own',
            why_readResult:
                'reads the verdict — a differently-named job, and without it the test tells you nothing',
            why_prepare:
                'the SGBD requires it for the starter release, hydraulic pump, fault indicator and shift lock, and it resets the ECU time counter',
            why_driveActuator: 'drives the selected actuator',
            why_keepAlive: 'keeps the session alive — the ECU timeout is 10 s and a run can last 960',
            why_testprgStop: 'the SGBD requires it: "Must be sent BEFORE TESTPRG_STARTEN!"',
            why_testprgStart: 'starts the program (TESTPRG_NR, and AUSWAHLBYTE where it takes a selection)',
            why_testprgPoll: '**re-send this same job** and read the run status, activity code and result code from it. The SGBD: "keep sending until this result is not 1". There is no companion job for this.',
            why_unknown: 'the SGBD comment does not state what this does',
        },
        op_irreversible: {
            irr_latching:
                'The SGBD exposes no release job for DSC_SIM_*. Once actuated it stays actuated; recovery is an ignition cycle, not a command.',
            irr_pin:
                'Forces an arbitrary output pin. Nothing in the SGBD constrains which pin, so nothing here can tell a harmless one from a damaging one.',
            irr_write:
                'Writes state that survives an ignition cycle. Nothing in this app can read the previous value back first, so there is no undo.',
            irr_eeprom:
                'Commits the RAM value into EEPROM. Everything up to here could be written back; from here it cannot.',
        },

        step_order: {
            'ecu-defined': 'The ECU defines this order',
            'app-recommended': 'Recommended order (the SGBD defines none)',
            'unordered-set': 'No order - pick one',
        },
        step_orderNote: {
            'ecu-defined': "This order is what the ECU itself reports. It is execution order, not numeric order.",
            'app-recommended': 'The SGBD tables define no order. This is built from inter-step dependencies and service practice.',
            'unordered-set': 'A set of alternatives. There is no sequence.',
        },
        step_state: { running: 'Running', passed: 'Passed', done: 'Done', failed: 'Failed', unknown: 'Unknown' },
        step_meta: { duration: 'Takes', engine: 'Engine', valves: 'Drives' },

        tab_service: 'SERVICE',
        facet_purpose: 'Purpose',
        facet_audience: 'For',
        facet_system: 'System',
        facet_all: 'All',
        facet_hidden: (n) => `${n} hidden by the current filter`,
        jobClass: {
            read: 'Read',
            test: 'Actuator test',
            calibration: 'Calibration',
            coding: 'Coding',
            programming: 'Programming (not run here)',
            protocol: 'Procedure step',
        },
        jobClassNote: {
            read: 'Reads a value. Nothing about the car changes, and it is safe to repeat.',
            test: 'Moves a part temporarily to check it. When it ends the car is as it was — except for the few that latch, which say so individually.',
            calibration:
                'Rewrites a learned or adjusted value. It survives an ignition cycle and there is no way back to the old value.',
            coding: "Rewrites the car's equipment configuration. Getting it out of step with other modules means warning lights or lost functions.",
            programming:
                "Operates on the ECU's own program area. **This app does not run these.** An ECU whose write fails will not boot; recovery is bench work or replacement. WinKFP territory.",
            protocol: "A step inside another job's procedure. Running it on its own means nothing.",
        },
        audience: { owner: 'Owner', technician: 'Technician', protocol: 'Protocol' },
        audienceNote: {
            owner: 'A car owner can judge what this means.',
            technician: 'Assumes the knowledge — and the recovery route — that goes with doing this for a living.',
            protocol: 'Used inside other jobs. Not something you run.',
        },
        system: {
            faults: 'Fault memory',
            vanos: 'VANOS (variable valve timing)',
            fuel: 'Fuel and injection',
            emissions: 'Emissions, catalyst, O2 sensors',
            air: 'Intake, throttle, pedal',
            ignition: 'Ignition and knock',
            cooling: 'Cooling and oil',
            clutch: 'Clutch',
            gearbox: 'Gearbox',
            brakes: 'Brake hydraulics',
            tyres: 'Tyre pressure',
            stability: 'Stability control',
            steering: 'Steering',
            sensors: 'Sensors',
            electrical: 'Power, relays, I/O',
            ecu: 'ECU identity',
            engine: 'Engine control',
            unknown: 'Unknown',
        },

        op_actor: 'Who carries it',
        op_termination: 'How it ends',
        op_delivery: 'Where the answer is',
        op_prerequisites: 'Sent first',
        actor: {
            ecu: 'The ECU runs it by itself',
            app: 'This app must keep sending',
            operator: 'A person has to do something',
            driver: 'The car has to be driven',
        },
        termination: {
            self: 'Ends by itself',
            'app-stop': 'This app stops it',
            'companion-job': 'A differently-named job stops it',
            none: 'It does not stop (latching)',
        },
        delivery: {
            inline: "In this job's own response",
            'companion-job': 'Read by another job',
            'live-block': 'Appears in the live blocks',
            none: 'No result',
        },
        op_resultJob: (job) => `The verdict is read with ${job}`,


        det_results: 'What this job returns',
        det_resultCount: (n) => `${n} result${n === 1 ? '' : 's'}`,
        det_results_note:
            'The results the SGBD declares. Value, unit and plain text are folded into one row. Current values need a run.',
        det_args: 'Arguments you must supply',
        det_values: 'Adjustment values',
        det_noValues:
            'No published limits for this job. Neither the SGBD nor the decompiled source states a minimum or maximum — that is a fact, not a gap we have yet to fill.',
        det_whenArg: (arg, values) => `Returned only when ${arg} is ${values}`,
        det_inferred: 'inferred',
        det_optionsDropped: (l) => `Excluded per the SGBD: ${l}`,
        det_optionsFromComment: 'comment',
        det_argBindsNoResults: (a, v) =>
            `The SGBD declares no named result bound to ${a} = ${v}. What comes back is the always-returned set, raw DATEN included. The values are not missing — the field names were never published.`,
        resultRole: {
            value: 'value',
            unit: 'unit',
            text: 'text',
            status: 'job status',
            telegram: 'telegram',
            raw: 'raw',
        },

        spec_current: 'Current',
        spec_min: 'Min',
        spec_max: 'Max',
        spec_default: 'Factory default',
        spec_always: 'Fixed',
        spec_defaultNote:
            'The factory default is the value it left the factory with, NOT a target. A learned value sitting away from it is normal. The only verdict here is whether it is inside the stated range.',
        spec_verdict: { 'in-range': 'In range', 'out-of-range': 'Out of range', unknown: 'No verdict' },
        spec_needsRun:
            'Reading the current value needs a run, and running is not unlocked yet — so this shows the range and the factory default only.',
        spec_crossField: (a, b) => `A constraint on the difference between ${a} and ${b}`,
        risk_label: { low: 'Low', medium: 'Med', high: 'High' },
        provenance: {
            'sgbd-comment': 'stated by the SGBD',
            'sgbd-args': 'from the argument signature',
            'name-heuristic': 'guessed from the name',
            authored: 'written by hand',
            inferred: 'inferred',
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
