// ============================================================================
//  GENERATED FILE — do not edit by hand.
//  Regenerate with: python tools/gen_live_blocks.py
// ============================================================================
//
//  MSS54 live-measurement block layouts: offsets, formats, scaling.
//  8 blocks, 213 fields.
//
//  A block is read with DS2 control 0x0B (READ_IO_STATUS) plus the selection
//  byte, e.g. selection 35 (VANOS) is `12 05 0B 23 3F`. The whole block comes
//  back in one response and every field below is an offset into that payload.
//
//  PROVENANCE — **MSS54 DS2 Tool, by karter16**.
//  https://github.com/karter16/MSS54-DS2-Tool-Public  ·  (c) 2026 karter16
//
//  Derived from that tool's decompiled catalogue. The SGBD publishes job
//  and result NAMES; it does not publish where a value sits in a payload
//  or what to scale it by. Everything below rests on karter16's work.
//
//  Byte offsets and scaling for a hardware protocol are arguably facts
//  about the ECU rather than creative expression — but the route by which
//  they were obtained is a decompilation, and that is stated rather than
//  glossed. THIRD-PARTY-NOTICES.md §3.2 carries the whole position.
//
//  NOT VERIFIED ON A VEHICLE. `expectedLength` below is the reference's
//  declared block length and is advisory only: validate a response against
//  minPayloadLength(fields) instead, because a declared length can be stale
//  while the field table is not (the reference contains exactly that case).
// ============================================================================

import type { FieldDef } from '@tsunagi/ds2-core';

/** How a field's German name was obtained. See the generator's header. */
export type LiveJoinSource =
    | 'betriebswtab'    // BETRIEBSWTAB row matched on (selection, offset)
    | 'job-result'      // a STAT_<SYMBOL>_WERT result somewhere in the SGBD
    | 'status-bits'     // BITS -> STATUS_DIGITAL, only where the byte holds one bit
    | 'reader-job'      // the job whose telegram reads this block
    | 'sibling-block';  // the same symbol in another block, same reference name

export interface LiveValueField extends FieldDef {
    /**
     * Name from the reference catalog. English, and a THIRD PARTY's English —
     * not what the ECU calls this quantity. `de` is.
     */
    name: string;
    /**
     * Japanese name, hand-written in `tools/terms/live_channels.py`.
     *
     * Required, and the generator exits non-zero if any channel lacks one.
     * Machine translation is not an option here: 127 of the 213 have no
     * German to translate FROM, and decomposing the ones that do put
     * `Luftmasse` (air MASS) into Japanese as electrical ground.
     */
    ja: string;
    unit: string;
    group: string;
    /** The SGBD's own German, where a join was possible. Absent means none was. */
    de?: string;
    /** Present exactly when `de` is. */
    deSource?: LiveJoinSource;
    /** The SGBD row or result `de` came from, so it can be checked. */
    sgbdRow?: string;
}

/** A join that had evidence and was refused, with the reason. */
export interface LiveJoinRefusal {
    kind: string;
    selection?: number;
    symbol?: string;
    name?: string;
    candidates?: readonly string[];
    siblingSelection?: number;
    siblingName?: string;
    sgbdRow?: string;
    why: string;
}

export interface LiveValueBlock {
    /** Selection byte sent with DS2 control 0x0B. */
    selection: number;
    /** Block name, hand-written. A block is one round trip, so this is a cost label. */
    name: string;
    ja: string;
    group: string;
    /** The reference's declared length. Advisory — see the header note. */
    expectedLength: number;
    fields: readonly LiveValueField[];
}

export const MSS54_LIVE_BLOCKS: readonly LiveValueBlock[] = [
    {
        selection: 2,
        name: "A/D converters (raw sensor voltages)",
        ja: "A/Dコンバータ（センサ生電圧）",
        group: "Analog Inputs",
        expectedLength: 64,
        fields: [
            { symbol: "UINTOUT1", name: "Knock signal multiplex channel 1/2", ja: "ノックセンサ多重出力 1/2ch 電圧", offset: 0, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UINTOUT2", name: "Knock signal multiplex channel 3/4", ja: "ノックセンサ多重出力 3/4ch 電圧", offset: 2, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UISERVO", name: "Servotronic valve shunt voltage", ja: "サーボトロニック弁 シャント電圧", offset: 4, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UHFM1", name: "Air mass meter 1", ja: "エアフローセンサ1 電圧", offset: 6, format: 'uint10', scale: 0.00564, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UHFM2", name: "Air mass meter 2", ja: "エアフローセンサ2 電圧", offset: 8, format: 'uint10', scale: 0.00564, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UTDME", name: "ECU temperature sensor", ja: "ECU内部温度センサ 電圧", offset: 10, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UEDKPM", name: "Throttle sensor master", ja: "スロットルポジションセンサ(EDK) マスタ 電圧", offset: 12, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UTABG", name: "Exhaust temperature sensor", ja: "排気温度センサ 電圧", offset: 14, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UDKG1M", name: "Throttle position sensor 1 master", ja: "スロットル開度センサ1 マスタ 電圧", offset: 16, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UPWG1M", name: "Pedal sensor channel 1 master", ja: "アクセルペダルセンサ 1ch マスタ 電圧", offset: 18, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs", de: "Spannung PWG Kanal 1", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_upwg1m" },
            { symbol: "UPWG2M", name: "Pedal sensor channel 2 master", ja: "アクセルペダルセンサ 2ch マスタ 電圧", offset: 20, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UEXT1", name: "Sensor supply 1", ja: "センサ電源1 電圧", offset: 22, format: 'uint10', scale: 0.009766, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UEXT2", name: "Sensor supply 2", ja: "センサ電源2 電圧", offset: 24, format: 'uint10', scale: 0.009766, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UPUMG", name: "Ambient pressure sensor", ja: "大気圧センサ 電圧", offset: 26, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UTANS", name: "Intake air temperature sensor", ja: "吸気温度センサ 電圧", offset: 28, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UTMOT", name: "Coolant temperature sensor", ja: "冷却水温センサ 電圧", offset: 30, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UPWG1S", name: "Pedal sensor 1 slave", ja: "アクセルペダルセンサ1 スレーブ 電圧", offset: 32, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UEDKPS", name: "Throttle sensor slave", ja: "スロットルポジションセンサ(EDK) スレーブ 電圧", offset: 34, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UDKG1S", name: "Throttle position sensor 1 slave", ja: "スロットル開度センサ1 スレーブ 電圧", offset: 36, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UTKA", name: "Radiator outlet temperature sensor", ja: "ラジエータ出口水温センサ 電圧", offset: 38, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UIDMTL", name: "Leak diagnosis pump shunt voltage", ja: "蒸発ガス漏れ診断ポンプ(DMTL) シャント電圧", offset: 40, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UGEN", name: "Pulsed fuel pump diagnostic voltage", ja: "燃料ポンプ診断電圧（パルス）", offset: 42, format: 'uint10', scale: 0.009766, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UUBHR", name: "Main relay vehicle voltage", ja: "メインリレー 車載電源電圧", offset: 44, format: 'uint10', scale: 0.024923999999999998, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "ULSV1", name: "Oxygen sensor 1 before catalyst", ja: "O2センサ1（触媒前）電圧", offset: 46, format: 'uint10', scale: 0.001088, add: 0, unit: "V", group: "Analog Inputs", de: "Lambdasonde 1 vor Kat", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_lsv1" },
            { symbol: "ULSV2", name: "Oxygen sensor 2 before catalyst", ja: "O2センサ2（触媒前）電圧", offset: 48, format: 'uint10', scale: 0.001088, add: 0, unit: "V", group: "Analog Inputs", de: "Lambdasonde 2 vor Kat", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_lsv2" },
            { symbol: "ULSN1", name: "Oxygen sensor 1 after catalyst", ja: "O2センサ1（触媒後）電圧", offset: 50, format: 'uint10', scale: 0.001088, add: 0, unit: "V", group: "Analog Inputs", de: "Lambdasonde 1 nach Kat", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_lsh1" },
            { symbol: "ULSN2", name: "Oxygen sensor 2 after catalyst", ja: "O2センサ2（触媒後）電圧", offset: 52, format: 'uint10', scale: 0.001088, add: 0, unit: "V", group: "Analog Inputs", de: "Lambdasonde 2 nach Kat", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_lsh2" },
            { symbol: "ULSHV1", name: "Oxygen sensor heater 1 before catalyst", ja: "O2センサヒーター1（触媒前）電圧", offset: 54, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "ULSHV2", name: "Oxygen sensor heater 2 before catalyst", ja: "O2センサヒーター2（触媒前）電圧", offset: 56, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "ULSHN1", name: "Oxygen sensor heater 1 after catalyst", ja: "O2センサヒーター1（触媒後）電圧", offset: 58, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "ULSHN2", name: "Oxygen sensor heater 2 after catalyst", ja: "O2センサヒーター2（触媒後）電圧", offset: 60, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
            { symbol: "UKFKP", name: "Map-controlled cooling actuator sensor", ja: "マップ制御冷却アクチュエータ センサ電圧", offset: 62, format: 'uint10', scale: 0.004883, add: 0, unit: "V", group: "Analog Inputs" },
        ],
    },
    {
        selection: 3,
        name: "Standard measurements",
        ja: "標準計測値",
        group: "Engine",
        expectedLength: 35,
        fields: [
            { symbol: "n", name: "Engine speed", ja: "エンジン回転数", offset: 0, format: 'uint16', scale: 1, add: 0, unit: "rpm", group: "", de: "Drehzahl n", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_n" },
            { symbol: "llr_n_soll", name: "Idle controller target speed", ja: "アイドル制御 目標回転数", offset: 2, format: 'uint16', scale: 1, add: 0, unit: "rpm", group: "", de: "Leerlaufregler Solldrehzahl", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_n_ll_soll" },
            { symbol: "ml", name: "Total air mass", ja: "吸入空気量（総量）", offset: 4, format: 'uint16', scale: 0.25, add: 0, unit: "kg/h", group: "", de: "Luftmasse", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_ml" },
            { symbol: "tl", name: "Load signal", ja: "負荷信号", offset: 6, format: 'uint16', scale: 0.001, add: 0, unit: "ms", group: "", de: "Lastsignal", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_tl" },
            { symbol: "rf", name: "Relative filling", ja: "相対充填率", offset: 8, format: 'uint16', scale: 0.1, add: 0, unit: "%", group: "", de: "relative Fuellung", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_rf" },
            { symbol: "tan", name: "Intake air temperature", ja: "吸気温度", offset: 10, format: 'uint8', scale: 1, add: -48, unit: "°C", group: "", de: "Ansauglufttemperatursensor", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_tans" },
            { symbol: "tmot", name: "Engine temperature", ja: "冷却水温", offset: 11, format: 'uint8', scale: 1, add: -48, unit: "°C", group: "", de: "Motortemperatursensor", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_tmot" },
            { symbol: "toel", name: "Oil temperature", ja: "油温（TOG）", offset: 12, format: 'uint8', scale: 1, add: -48, unit: "°C", group: "", de: "Oeltemperatur (TOG)", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_toel" },
            { symbol: "tka", name: "Radiator outlet temperature", ja: "ラジエータ出口水温", offset: 13, format: 'uint8', scale: 1, add: -48, unit: "°C", group: "", de: "Kuehleraustrittstemperatur", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_tka" },
            { symbol: "tabg", name: "Exhaust temperature", ja: "排気温度", offset: 14, format: 'int7', scale: 16, add: 0, unit: "°C", group: "", de: "Abgastemperatur", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_tabg" },
            { symbol: "tumg", name: "Ambient temperature CAN", ja: "外気温（CAN）", offset: 15, format: 'uint8', scale: 1, add: -48, unit: "°C", group: "", de: "Umgebungstemperatur", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_tumg" },
            { symbol: "ub", name: "Main relay vehicle voltage", ja: "車載電源電圧（メインリレー）", offset: 16, format: 'uint8', scale: 0.1, add: 0, unit: "V", group: "", de: "Bordnetzspannung Hauptrelais", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_ubhr" },
            { symbol: "uext1m", name: "Sensor supply 1 master", ja: "センサ電源1（マスタ）", offset: 17, format: 'uint8', scale: 0.039100684261974585, add: 0, unit: "V", group: "", de: "Sensorversorgung 1 (Master)", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_uext1" },
            { symbol: "uext2m", name: "Sensor supply 2 slave", ja: "センサ電源2（スレーブ）", offset: 18, format: 'uint8', scale: 0.039100684261974585, add: 0, unit: "V", group: "", de: "Sensorversorgung 2 (Slave)", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_uext2" },
            { symbol: "pumg", name: "Ambient pressure internal", ja: "大気圧（ECU内部値）", offset: 19, format: 'uint8', scale: 3, add: 500, unit: "mbar", group: "", de: "Umgebungsdruck (intern)", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_pumg_intern" },
            { symbol: "aq_rel", name: "Relative opening cross-section", ja: "相対開口断面積", offset: 20, format: 'uint16', scale: 0.46511627906976744, add: 0, unit: "%", group: "", de: "relativer Oeffnungsquerschnitt", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_aqrel" },
            { symbol: "wdk_zustand", name: "Throttle status", ja: "スロットル状態", offset: 22, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "pwg1", name: "Pedal sensor 1 actual position", ja: "アクセルペダルセンサ1 実位置", offset: 23, format: 'int15', scale: 0.1, add: 0, unit: "%", group: "", de: "Fahrpedalwertgeber Kanal 1", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_fwg1" },
            { symbol: "pwg2", name: "Pedal sensor 2 actual position", ja: "アクセルペダルセンサ2 実位置", offset: 25, format: 'int15', scale: 0.1, add: 0, unit: "%", group: "", de: "Fahrpedalwertgeber Kanal 2", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_fwg2" },
            { symbol: "wdk1", name: "Throttle potentiometer 1 actual position", ja: "スロットルポテンショ1 実位置", offset: 27, format: 'int15', scale: 0.1, add: 0, unit: "%", group: "", de: "Drosselklappensteller Istwert", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_dkist" },
            { symbol: "wdk2", name: "Throttle potentiometer 2 actual position", ja: "スロットルポテンショ2 実位置", offset: 29, format: 'int15', scale: 0.1, add: 0, unit: "%", group: "" },
            { symbol: "edk_soll", name: "Throttle target value", ja: "スロットル目標開度", offset: 31, format: 'int15', scale: 0.1, add: 0, unit: "%", group: "", de: "Drosselklappensteller Sollwert", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_dksoll" },
            { symbol: "tog_level_k", name: "Corrected oil level", ja: "油量（補正後）", offset: 33, format: 'uint8', scale: 1, add: 0, unit: "mm", group: "" },
            { symbol: "tdme", name: "ECU temperature", ja: "ECU内部温度", offset: 34, format: 'uint8', scale: 1, add: -48, unit: "°C", group: "" },
        ],
    },
    {
        selection: 4,
        name: "Switch and status bits",
        ja: "スイッチ・状態ビット",
        group: "Status",
        expectedLength: 43,
        fields: [
            { symbol: "zustand_motor", name: "Engine operating state", ja: "エンジン運転状態", offset: 0, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "kkos_st_treiber", name: "A/C compressor control", ja: "A/Cコンプレッサ駆動", offset: 1, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "asc_st", name: "ASC intervention", ja: "ASC介入", offset: 2, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "kath_st", name: "Catalyst heating", ja: "触媒暖機", offset: 3, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "ftyp_st", name: "Driver type recognition", ja: "ドライバータイプ判定", offset: 4, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "vmax_st", name: "Vmax limiter", ja: "最高速リミッタ", offset: 5, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "slp_st", name: "Secondary air pump", ja: "2次エアポンプ 状態", offset: 6, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status", de: "Status Sekundaerluftpumpe", deSource: 'status-bits', sgbdRow: "STATUS_DIGITAL.STAT_SLP_EIN" },
            { symbol: "slv_st", name: "Secondary air valve", ja: "2次エアバルブ 状態", offset: 7, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status", de: "Status Sekundaerluftventil", deSource: 'status-bits', sgbdRow: "STATUS_DIGITAL.STAT_SLV_EIN" },
            { symbol: "ekp_st", name: "Fuel pump", ja: "燃料ポンプ 状態", offset: 8, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status", de: "Status Kraftstoffpumpe", deSource: 'status-bits', sgbdRow: "STATUS_DIGITAL.STAT_EKP_EIN" },
            { symbol: "elu_st", name: "Electric fan", ja: "電動ファン 状態", offset: 9, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status", de: "Status Eletroluefter", deSource: 'status-bits', sgbdRow: "STATUS_DIGITAL.STAT_ELU_EIN" },
            { symbol: "akl_stcfg_rollenbetrieb", name: "Exhaust flap / roller mode", ja: "排気フラップ／ローラー台モード", offset: 10, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status", de: "Status Abgasklappe", deSource: 'status-bits', sgbdRow: "STATUS_DIGITAL.STAT_AKL_EIN" },
            { symbol: "start_status", name: "Starter relay", ja: "スタータリレー", offset: 11, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "fgr_can_st", name: "Cruise control", ja: "クルーズコントロール", offset: 12, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "lfr_zustand", name: "Idle controller", ja: "アイドル制御 状態", offset: 13, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status", de: "Status Leerlaufregler", deSource: 'status-bits', sgbdRow: "STATUS_DIGITAL.STAT_LLR_EIN" },
            { symbol: "kr_st", name: "Knock controller", ja: "ノック制御", offset: 14, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "lshv1_st", name: "Oxygen sensor heater 1 before catalyst", ja: "O2センサヒーター1（触媒前）状態", offset: 15, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status", de: "Status Lambdasondenheizung vor Kat Bank 1", deSource: 'status-bits', sgbdRow: "STATUS_DIGITAL.STAT_LSHV1_EIN" },
            { symbol: "lshv2_st", name: "Oxygen sensor heater 2 before catalyst", ja: "O2センサヒーター2（触媒前）状態", offset: 16, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status", de: "Status Lambdasondenheizung vor Kat Bank 2", deSource: 'status-bits', sgbdRow: "STATUS_DIGITAL.STAT_LSHV2_EIN" },
            { symbol: "lshn1_st", name: "Oxygen sensor heater 1 after catalyst", ja: "O2センサヒーター1（触媒後）状態", offset: 17, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status", de: "Status Lambdasondenheizung nach Kat Bank 1", deSource: 'status-bits', sgbdRow: "STATUS_DIGITAL.STAT_LSHN1_EIN" },
            { symbol: "lshn2_st", name: "Oxygen sensor heater 2 after catalyst", ja: "O2センサヒーター2（触媒後）状態", offset: 18, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status", de: "Status Lambdasondenheizung nach Kat Bank 2", deSource: 'status-bits', sgbdRow: "STATUS_DIGITAL.STAT_LSHN2_EIN" },
            { symbol: "tz_ed_status", name: "Ignition channels", ja: "点火チャンネル 状態", offset: 19, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "ti_ausblend_ist", name: "Injection channels", ja: "噴射チャンネル 状態", offset: 20, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "sa_we_st", name: "Overrun fuel cutoff", ja: "減速時燃料カット", offset: 21, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status", de: "Status Schubabschaltung", deSource: 'status-bits', sgbdRow: "STATUS_DIGITAL.STAT_SA_EIN" },
            { symbol: "ba_st", name: "Acceleration enrichment", ja: "加速増量", offset: 22, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status", de: "Status Beschleunigungsanreicherung", deSource: 'status-bits', sgbdRow: "STATUS_DIGITAL.STAT_BA_EIN" },
            { symbol: "noise_st", name: "Noise reduction", ja: "騒音低減制御", offset: 23, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status", de: "Status Geraeuschminderung", deSource: 'status-bits', sgbdRow: "STATUS_DIGITAL.STAT_NOISE_EIN" },
            { symbol: "schalt_s_st", name: "Slave switch inputs", ja: "スイッチ入力（スレーブ）", offset: 24, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "schalter_can", name: "CAN switch inputs", ja: "スイッチ入力（CAN）", offset: 25, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "mil_st", name: "MIL lamp control", ja: "チェックエンジン警告灯", offset: 26, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status", de: "Status Check-Engine-Lampe", deSource: 'status-bits', sgbdRow: "STATUS_DIGITAL.STAT_MIL_EIN" },
            { symbol: "ews_status", name: "EWS-3 release status", ja: "EWS-3 始動許可状態", offset: 27, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "dsv_st", name: "VANOS pressure accumulator valve", ja: "VANOS蓄圧バルブ", offset: 28, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "servo_mode", name: "Servotronic status", ja: "サーボトロニック 状態", offset: 29, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "schalt_m_st", name: "Master switch inputs", ja: "スイッチ入力（マスタ）", offset: 30, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "can_n_elu", name: "CAN fan-stage request", ja: "電動ファン段 要求（CAN）", offset: 31, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "fgr_tast_reg", name: "MFL cruise button number", ja: "ステアリングスイッチ番号（クルーズ）", offset: 32, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "ds2_ti_unlock", name: "Safety unlock", ja: "安全ロック解除", offset: 33, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "oek_status", name: "Oil circuit switchover valves", ja: "オイル回路切替バルブ", offset: 34, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "la_st_ein1", name: "Lambda controller status bank 1", ja: "ラムダ制御 状態 バンク1", offset: 35, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status", de: "Status Lambdaregler Bank 1", deSource: 'status-bits', sgbdRow: "STATUS_DIGITAL.STAT_LDR1_EIN" },
            { symbol: "la_st_ein2", name: "Lambda controller status bank 2", ja: "ラムダ制御 状態 バンク2", offset: 36, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status", de: "Status Lambdaregler Bank 2", deSource: 'status-bits', sgbdRow: "STATUS_DIGITAL.STAT_LDR2_EIN" },
            { symbol: "vvdp_verbaut", name: "Pressure accumulator valve installed", ja: "蓄圧バルブ 装備", offset: 37, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status", de: "Druckspeicherventil verbaut", deSource: 'job-result', sgbdRow: "STATUS_ADAPTIONSBLOCK_06.STAT_VVDP_VERBAUT_WERT" },
            { symbol: "kath_zustand", name: "Catalyst heating state", ja: "触媒暖機 状態", offset: 38, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "ssp_st", name: "Suction jet pump status", ja: "サクションジェットポンプ 状態", offset: 39, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "ldph_verbaut", name: "DMTL heater installed", ja: "DMTLヒーター 装備", offset: 40, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status", de: "DMTL_Heizung verbaut", deSource: 'job-result', sgbdRow: "STATUS_ADAPTIONSBLOCK_06.STAT_LDPH_VERBAUT_WERT" },
            { symbol: "ldph_st", name: "DMTL heater status", ja: "DMTLヒーター 状態", offset: 41, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
            { symbol: "ssp_diag_st", name: "Suction jet pump diagnostic status", ja: "サクションジェットポンプ 診断状態", offset: 42, format: 'uint8', scale: 1, add: 0, unit: "", group: "Status" },
        ],
    },
    {
        selection: 19,
        name: "Operating measurements",
        ja: "運転計測値",
        group: "Engine",
        expectedLength: 90,
        fields: [
            { symbol: "v", name: "Vehicle speed direct", ja: "車速（直接入力）", offset: 0, format: 'uint16', scale: 1, add: 0, unit: "km/h", group: "", de: "Geschwindigkeit v", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_v" },
            { symbol: "v_asc", name: "Vehicle speed CAN", ja: "車速（CAN）", offset: 2, format: 'uint16', scale: 0.0625, add: 0, unit: "km/h", group: "", de: "Fahrzeuggeschwindigkeit v_asc (CAN)", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_v_can" },
            { symbol: "ti_ausblend_ist", name: "Injection blanking counter actual", ja: "噴射カット気筒数 実値", offset: 4, format: 'uint8', scale: 1, add: 0, unit: "", group: "", de: "Ausblendzaehler Einspritzung Ist", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_ti_aus_ist" },
            { symbol: "ti_ausblend_soll", name: "Injection blanking counter target", ja: "噴射カット気筒数 目標", offset: 5, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "ti1", name: "Injection time cylinder 1", ja: "噴射時間 気筒1", offset: 6, format: 'uint16', scale: 0.001, add: 0, unit: "ms", group: "", de: "Einspritzzeit Zylinder 1", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_ti1" },
            { symbol: "ti2", name: "Injection time cylinder 2", ja: "噴射時間 気筒2", offset: 8, format: 'uint16', scale: 0.001, add: 0, unit: "ms", group: "", de: "Einspritzzeit Zylinder 2", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_ti2" },
            { symbol: "ti3", name: "Injection time cylinder 3", ja: "噴射時間 気筒3", offset: 10, format: 'uint16', scale: 0.001, add: 0, unit: "ms", group: "", de: "Einspritzzeit Zylinder 3", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_ti3" },
            { symbol: "ti4", name: "Injection time cylinder 4", ja: "噴射時間 気筒4", offset: 12, format: 'uint16', scale: 0.001, add: 0, unit: "ms", group: "", de: "Einspritzzeit Zylinder 4", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_ti4" },
            { symbol: "ti5", name: "Injection time cylinder 5", ja: "噴射時間 気筒5", offset: 14, format: 'uint16', scale: 0.001, add: 0, unit: "ms", group: "", de: "Einspritzzeit Zylinder 5", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_ti5" },
            { symbol: "ti6", name: "Injection time cylinder 6", ja: "噴射時間 気筒6", offset: 16, format: 'uint16', scale: 0.001, add: 0, unit: "ms", group: "", de: "Einspritzzeit Zylinder 6", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_ti6" },
            { symbol: "tz1", name: "Ignition angle cylinder 1", ja: "点火時期 気筒1", offset: 22, format: 'int15', scale: 0.1, add: 0, unit: "°KW", group: "", de: "Zuendwinkel Zylinder 1", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_tz1" },
            { symbol: "tz2", name: "Ignition angle cylinder 2", ja: "点火時期 気筒2", offset: 24, format: 'int15', scale: 0.1, add: 0, unit: "°KW", group: "", de: "Zuendwinkel Zylinder 2", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_tz2" },
            { symbol: "tz3", name: "Ignition angle cylinder 3", ja: "点火時期 気筒3", offset: 26, format: 'int15', scale: 0.1, add: 0, unit: "°KW", group: "", de: "Zuendwinkel Zylinder 3", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_tz3" },
            { symbol: "tz4", name: "Ignition angle cylinder 4", ja: "点火時期 気筒4", offset: 28, format: 'int15', scale: 0.1, add: 0, unit: "°KW", group: "", de: "Zuendwinkel Zylinder 4", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_tz4" },
            { symbol: "tz5", name: "Ignition angle cylinder 5", ja: "点火時期 気筒5", offset: 30, format: 'int15', scale: 0.1, add: 0, unit: "°KW", group: "", de: "Zuendwinkel Zylinder 5", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_tz5" },
            { symbol: "tz6", name: "Ignition angle cylinder 6", ja: "点火時期 気筒6", offset: 32, format: 'int15', scale: 0.1, add: 0, unit: "°KW", group: "", de: "Zuendwinkel Zylinder 6", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_tz6" },
            { symbol: "tetv", name: "Tank ventilation valve pulse time", ja: "タンクベントバルブ デューティ", offset: 38, format: 'uint16', scale: 0.002, add: 0, unit: "ms", group: "", de: "Tastverhaeltnis Tankentlueftungsventil", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_tv_tev" },
            { symbol: "la_f_regler1", name: "Lambda controller factor 1", ja: "ラムダ制御 補正係数 バンク1", offset: 40, format: 'uint16', scale: 3.0517578125e-05, add: 0, unit: "", group: "", de: "Lambdaregler 1 Regelfaktor", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_lambda1" },
            { symbol: "la_f_regler2", name: "Lambda controller factor 2", ja: "ラムダ制御 補正係数 バンク2", offset: 42, format: 'uint16', scale: 3.0517578125e-05, add: 0, unit: "", group: "", de: "Lambdaregler 2 Regelfaktor", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_lambda2" },
            { symbol: "lank_tv1", name: "Post-cat controller 1 tv share", ja: "触媒後ラムダPI制御 バンク1", offset: 44, format: 'uint16', scale: 10, add: 0, unit: "ms", group: "", de: "PI-Regler NKAT Bank 1 in ms", deSource: 'job-result', sgbdRow: "STATUS_ADAPTIONSBLOCK_83.STAT_LANK_TV1_WERT" },
            { symbol: "lank_tv2", name: "Post-cat controller 2 tv share", ja: "触媒後ラムダPI制御 バンク2", offset: 46, format: 'uint16', scale: 10, add: 0, unit: "ms", group: "", de: "PI-Regler NKAT Bank 2 in ms", deSource: 'job-result', sgbdRow: "STATUS_ADAPTIONSBLOCK_83.STAT_LANK_TV2_WERT" },
            { symbol: "servo_i_ist", name: "Servotronic valve current actual", ja: "サーボトロニック弁 実電流", offset: 48, format: 'uint16', scale: 0.89, add: 0, unit: "mA", group: "", de: "Ist Strom Servotronikventil", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.servo_i_ist" },
            { symbol: "servo_tast", name: "Servotronic valve duty", ja: "サーボトロニック弁 デューティ", offset: 50, format: 'uint16', scale: 0.05, add: 0, unit: "%", group: "" },
            { symbol: "servo_i_soll", name: "Servotronic valve current target", ja: "サーボトロニック弁 目標電流", offset: 52, format: 'uint16', scale: 0.89, add: 0, unit: "mA", group: "", de: "Soll Strom Servotronikventil", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.servo_i_soll" },
            { symbol: "elu_dreh", name: "Electric fan speed stage", ja: "電動ファン 回転段", offset: 54, format: 'uint8', scale: 1, add: 0, unit: "%", group: "" },
            { symbol: "ldp_i_filt", name: "Leak diagnosis pump measured current", ja: "漏れ診断ポンプ 測定電流", offset: 55, format: 'uint16', scale: 0.009, add: 0, unit: "mA", group: "", de: "TEV Messstrom", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_tev_cur" },
            { symbol: "ldp_st", name: "Leak diagnosis result register", ja: "漏れ診断 結果レジスタ", offset: 57, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "ldp_i_ref", name: "Leak diagnosis reference-leak current", ja: "漏れ診断 基準リーク電流", offset: 58, format: 'uint16', scale: 0.009, add: 0, unit: "mA", group: "" },
            { symbol: "asc_ay", name: "CAN lateral acceleration", ja: "横加速度（CAN）", offset: 60, format: 'int7', scale: 0.1, add: 0, unit: "m/s²", group: "" },
            { symbol: "asc_ax", name: "CAN longitudinal acceleration", ja: "前後加速度（CAN）", offset: 61, format: 'int7', scale: 0.1, add: 0, unit: "m/s²", group: "" },
            { symbol: "tefc_ll_st", name: "Tank ventilation system test result", ja: "タンクベント系 試験結果", offset: 62, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "sls_st_bandende", name: "Secondary air system test result", ja: "2次エア系 試験結果", offset: 63, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "ldp_st_nv", name: "Nonvolatile leak diagnosis result", ja: "漏れ診断 結果（不揮発）", offset: 64, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "ldp_t_mess", name: "Last leak diagnosis measuring time", ja: "漏れ診断 測定時間（前回）", offset: 65, format: 'uint16', scale: 0.1, add: 0, unit: "s", group: "", de: "TEV Messzeit", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_tev_time" },
            { symbol: "ldp_i_ref_korr", name: "Corrected leak diagnosis reference current", ja: "漏れ診断 基準電流（補正後）", offset: 67, format: 'uint16', scale: 0.009, add: 0, unit: "mA", group: "" },
            { symbol: "ldp_i_min", name: "Minimum reference current", ja: "漏れ診断 基準電流 最小値", offset: 69, format: 'uint16', scale: 0.009, add: 0, unit: "mA", group: "" },
            { symbol: "ldp_i_stabil", name: "Stable fine-leak current", ja: "微少漏れ 安定電流", offset: 71, format: 'uint16', scale: 0.009, add: 0, unit: "mA", group: "" },
            { symbol: "ekp_tv", name: "Fuel pump duty", ja: "燃料ポンプ デューティ", offset: 73, format: 'uint16', scale: 0.00321, add: 0, unit: "ms", group: "" },
            { symbol: "lls_tv", name: "Idle actuator duty", ja: "アイドルアクチュエータ デューティ", offset: 75, format: 'uint16', scale: 0.02, add: 0, unit: "%", group: "" },
            { symbol: "md_llri", name: "Idle controller integrator", ja: "アイドル制御 積分項トルク", offset: 77, format: 'int15', scale: 0.1, add: 0, unit: "Nm", group: "" },
            { symbol: "fr_regler", name: "Filling controller", ja: "充填制御器", offset: 79, format: 'uint16', scale: 3.0517578125e-05, add: 0, unit: "", group: "" },
            { symbol: "edk_aus", name: "EGAS actuator duty", ja: "EGASアクチュエータ デューティ", offset: 81, format: 'int15', scale: 0.05, add: 0, unit: "%tv", group: "" },
            { symbol: "can_fst", name: "CAN fuel level", ja: "燃料残量（CAN）", offset: 83, format: 'uint8', scale: 1, add: 0, unit: "l", group: "" },
            { symbol: "ldp_abbr_feucht", name: "Leak diagnosis wetness abort count", ja: "湿気疑いによる診断中断回数", offset: 84, format: 'uint16', scale: 1, add: 0, unit: "", group: "", de: "Anzahl abgebr. Diags. wegen Feuchtigkeitsverdacht", deSource: 'job-result', sgbdRow: "STATUS_ADAPTIONSBLOCK_83.STAT_LDP_ABBR_FEUCHT_WERT" },
            { symbol: "ldp_flags", name: "Leak test status flags", ja: "漏れ試験 状態フラグ", offset: 86, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "ldp_flags_nv", name: "Stored leak test status flags", ja: "漏れ試験 状態フラグ（保存）", offset: 87, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "tefc_ed", name: "TEV check diagnostic status", ja: "タンクベント弁点検 診断状態", offset: 88, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "la_freeze_flag", name: "Lambda freeze-frame status", ja: "ラムダ フリーズフレーム 状態", offset: 89, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
        ],
    },
    {
        selection: 21,
        name: "Rough running system check",
        ja: "ラフラン系統チェック",
        group: "Misfire / Roughness",
        expectedLength: 42,
        fields: [
            { symbol: "ll_abw1", name: "Rough running cylinder 1", ja: "ラフラン偏差 気筒1", offset: 30, format: 'int15', scale: 0.001525878906, add: 0, unit: "%", group: "" },
            { symbol: "ll_abw2", name: "Rough running cylinder 2", ja: "ラフラン偏差 気筒2", offset: 32, format: 'int15', scale: 0.001525878906, add: 0, unit: "%", group: "" },
            { symbol: "ll_abw3", name: "Rough running cylinder 3", ja: "ラフラン偏差 気筒3", offset: 34, format: 'int15', scale: 0.001525878906, add: 0, unit: "%", group: "" },
            { symbol: "ll_abw4", name: "Rough running cylinder 4", ja: "ラフラン偏差 気筒4", offset: 36, format: 'int15', scale: 0.001525878906, add: 0, unit: "%", group: "" },
            { symbol: "ll_abw5", name: "Rough running cylinder 5", ja: "ラフラン偏差 気筒5", offset: 38, format: 'int15', scale: 0.001525878906, add: 0, unit: "%", group: "" },
            { symbol: "ll_abw6", name: "Rough running cylinder 6", ja: "ラフラン偏差 気筒6", offset: 40, format: 'int15', scale: 0.001525878906, add: 0, unit: "%", group: "" },
        ],
    },
    {
        selection: 35,
        name: "VANOS and CSL measurements",
        ja: "VANOS／CSL 計測値",
        group: "VANOS/CSL",
        expectedLength: 39,
        fields: [
            { symbol: "n", name: "Engine speed", ja: "エンジン回転数", offset: 0, format: 'uint16', scale: 1, add: 0, unit: "rpm", group: "VANOS", de: "Drehzahl n", deSource: 'sibling-block', sgbdRow: "BETRIEBSWTAB.mw_n" },
            { symbol: "evan1_ist", name: "Intake VANOS bank 1 actual", ja: "吸気VANOS バンク1 実角", offset: 2, format: 'int15', scale: 0.1, add: 0, unit: "°KW", group: "VANOS", de: "Einlass-VANOS Bank 1 ist", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_evanos1_ist" },
            { symbol: "evan1_soll", name: "Intake VANOS bank 1 target", ja: "吸気VANOS バンク1 目標角", offset: 4, format: 'int15', scale: 0.1, add: 0, unit: "°KW", group: "VANOS", de: "Einlass-VANOS Bank 1 soll", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_evanos1_soll" },
            { symbol: "avan1_ist", name: "Exhaust VANOS bank 1 actual", ja: "排気VANOS バンク1 実角", offset: 6, format: 'int15', scale: 0.1, add: 0, unit: "°KW", group: "VANOS", de: "Auslass-VANOS Bank 1 ist", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_avanos1_ist" },
            { symbol: "avan1_soll", name: "Exhaust VANOS bank 1 target", ja: "排気VANOS バンク1 目標角", offset: 8, format: 'int15', scale: 0.1, add: 0, unit: "°KW", group: "VANOS", de: "Auslass-VANOS Bank 1 soll", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_avanos1_soll" },
            { symbol: "evan2_ist", name: "Intake VANOS bank 2 actual", ja: "吸気VANOS バンク2 実角", offset: 10, format: 'int15', scale: 0.1, add: 0, unit: "°KW", group: "VANOS", de: "Einlass-VANOS Bank 2 ist", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_evanos2_ist" },
            { symbol: "evan2_soll", name: "Intake VANOS bank 2 target", ja: "吸気VANOS バンク2 目標角", offset: 12, format: 'int15', scale: 0.1, add: 0, unit: "°KW", group: "VANOS", de: "Einlass-VANOS Bank 2 soll", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_evanos2_soll" },
            { symbol: "avan2_ist", name: "Exhaust VANOS bank 2 actual", ja: "排気VANOS バンク2 実角", offset: 14, format: 'int15', scale: 0.1, add: 0, unit: "°KW", group: "VANOS", de: "Auslass-VANOS Bank 2 ist", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_avanos2_ist" },
            { symbol: "avan2_soll", name: "Exhaust VANOS bank 2 target", ja: "排気VANOS バンク2 目標角", offset: 16, format: 'int15', scale: 0.1, add: 0, unit: "°KW", group: "VANOS", de: "Auslass-VANOS Bank 2 soll", deSource: 'betriebswtab', sgbdRow: "BETRIEBSWTAB.mw_avanos2_soll" },
            { symbol: "gks", name: "CSL snorkel flap position", ja: "CSLエアボックス スノーケルフラップ位置", offset: 18, format: 'uint16', scale: 1, add: 0, unit: "", group: "CSL" },
            { symbol: "gks_roh", name: "CSL snorkel flap position (raw)", ja: "CSLスノーケルフラップ位置（生電圧）", offset: 20, format: 'uint10', scale: 0.00564, add: 0, unit: "V", group: "CSL" },
            { symbol: "psau_local", name: "Manifold Absolute Pressure (unfiltered)", ja: "吸気マニホールド絶対圧（未フィルタ）", offset: 22, format: 'uint16', scale: 0.03125, add: 0, unit: "mbar", group: "CSL" },
            { symbol: "psau_roh", name: "Manifold Absolute Pressure (raw)", ja: "吸気マニホールド絶対圧（生電圧）", offset: 24, format: 'uint10', scale: 0.00564, add: 0, unit: "V", group: "CSL" },
            { symbol: "dr_rel", name: "Relative Throttle", ja: "相対スロットル開度", offset: 26, format: 'uint16', scale: 0.0030517578125, add: 0, unit: "%", group: "CSL" },
            { symbol: "rf_psau", name: "Relative Filling from MAP sensor", ja: "相対充填率（MAPセンサ由来）", offset: 29, format: 'uint8', scale: 0.001, add: 0, unit: "-", group: "CSL" },
            { symbol: "rf_drrel", name: "Relative Filling from AlphaN", ja: "相対充填率（アルファN由来）", offset: 30, format: 'uint16', scale: 0.001, add: 0, unit: "-", group: "CSL" },
            { symbol: "rf_diag_f", name: "Relative Filling diagnosis filter", ja: "相対充填率 診断フィルタ", offset: 32, format: 'uint16', scale: 0.001, add: 0, unit: "-", group: "CSL" },
            { symbol: "rf_diag_f_max", name: "Relative Filling diagnosis filter max", ja: "相対充填率 診断フィルタ 上限", offset: 34, format: 'uint16', scale: 0.001, add: 0, unit: "-", group: "CSL" },
            { symbol: "rf_diag_f_min", name: "Relative Filling diagnosis filter min", ja: "相対充填率 診断フィルタ 下限", offset: 36, format: 'int15', scale: 0.001, add: 0, unit: "-", group: "CSL" },
            { symbol: "rf_diag_st", name: "Relative Filling diagnosis status", ja: "相対充填率 診断状態", offset: 38, format: 'uint8', scale: 1, add: 0, unit: "", group: "CSL" },
        ],
    },
    {
        selection: 83,
        name: "EGAS (drive-by-wire) measurements",
        ja: "EGAS（電子スロットル）計測値",
        group: "EGAS",
        expectedLength: 52,
        fields: [
            { symbol: "freeze_flag", name: "EGAS event counter", ja: "EGAS イベントカウンタ", offset: 0, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "sk_zustand_neu", name: "Fault severity / limp mode", ja: "故障重大度／リンプモード", offset: 1, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "pdr_zustand", name: "EGAS pre-drive check", ja: "EGAS 発進前チェック", offset: 2, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "zustand_motor", name: "Engine operating state", ja: "エンジン運転状態", offset: 3, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "wdk1", name: "Throttle 1 position", ja: "スロットル1 開度", offset: 4, format: 'uint16', scale: 0.1, add: 0, unit: "%", group: "" },
            { symbol: "wdk2", name: "Throttle 2 position", ja: "スロットル2 開度", offset: 6, format: 'uint16', scale: 0.1, add: 0, unit: "%", group: "" },
            { symbol: "wdk1_abs", name: "Throttle pot 1 absolute voltage", ja: "スロットルポテンショ1 絶対電圧", offset: 8, format: 'uint16', scale: 0.004887585532746823, add: 0, unit: "V", group: "" },
            { symbol: "wdk2_abs", name: "Throttle pot 2 absolute voltage", ja: "スロットルポテンショ2 絶対電圧", offset: 10, format: 'uint16', scale: 0.004887585532746823, add: 0, unit: "V", group: "" },
            { symbol: "egas_soll", name: "Throttle target position", ja: "スロットル目標位置", offset: 12, format: 'uint16', scale: 0.1, add: 0, unit: "%", group: "" },
            { symbol: "edk_aus", name: "EGAS actuator duty", ja: "EGASアクチュエータ デューティ", offset: 14, format: 'int15', scale: 0.05, add: 0, unit: "%", group: "" },
            { symbol: "wdk_mode", name: "Throttle sensing state", ja: "スロットル検出 状態", offset: 16, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "wdk_adapt", name: "Throttle adaptation status", ja: "スロットル適応 状態（0＝正常）", offset: 17, format: 'uint8', scale: 1, add: 0, unit: "", group: "", de: "Zustand Drosselklappenadaption mit 0 = ok", deSource: 'job-result', sgbdRow: "STATUS_ADAPTIONSBLOCK_06.STAT_WDK_ADAPT_WERT" },
            { symbol: "n40", name: "Engine speed", ja: "エンジン回転数（40ms系）", offset: 18, format: 'uint8', scale: 40, add: 0, unit: "rpm", group: "" },
            { symbol: "d_n40", name: "Engine speed gradient", ja: "エンジン回転数 変化率", offset: 19, format: 'int7', scale: 40, add: 0, unit: "rpm/s", group: "" },
            { symbol: "d_pwg", name: "Pedal value gradient", ja: "アクセルペダル値 変化率", offset: 20, format: 'int15', scale: 0.1, add: 0, unit: "%/20ms", group: "" },
            { symbol: "d_wdk", name: "Throttle gradient", ja: "スロットル 変化率", offset: 22, format: 'int15', scale: 5, add: 0, unit: "%/s", group: "" },
            { symbol: "t_ml", name: "Engine running time", ja: "エンジン運転時間", offset: 24, format: 'uint16', scale: 1, add: 0, unit: "s", group: "", de: "Motorbetriebszeit in s", deSource: 'job-result', sgbdRow: "STATUS_ADAPTIONSBLOCK_06.STAT_T_ML_WERT" },
            { symbol: "ml", name: "Air mass", ja: "吸入空気量", offset: 26, format: 'uint16', scale: 0.25, add: 0, unit: "kg/h", group: "" },
            { symbol: "ml_ersatz", name: "Air mass substitute/model", ja: "吸入空気量（代替値・モデル）", offset: 28, format: 'uint16', scale: 0.25, add: 0, unit: "kg/h", group: "" },
            { symbol: "rf", name: "Relative filling", ja: "相対充填率", offset: 30, format: 'uint16', scale: 0.1, add: 0, unit: "%", group: "", de: "relative Fuellung", deSource: 'sibling-block', sgbdRow: "BETRIEBSWTAB.mw_rf" },
            { symbol: "pwg_soll", name: "Pedal target", ja: "アクセルペダル 目標", offset: 32, format: 'uint16', scale: 0.1, add: 0, unit: "%", group: "" },
            { symbol: "md_ind_wunsch", name: "Driver requested torque", ja: "要求トルク（ドライバー）", offset: 34, format: 'uint16', scale: 0.1, add: 0, unit: "Nm", group: "" },
            { symbol: "md_ind_wunsch_red_korr", name: "Filling torque request", ja: "充填要求トルク", offset: 36, format: 'uint16', scale: 0.1, add: 0, unit: "Nm", group: "" },
            { symbol: "md_ind_ne", name: "Actual torque after intervention", ja: "介入後 実トルク", offset: 38, format: 'uint16', scale: 0.1, add: 0, unit: "Nm", group: "" },
            { symbol: "md_ind_opt_korr", name: "Actual torque", ja: "実トルク", offset: 40, format: 'uint16', scale: 0.1, add: 0, unit: "Nm", group: "" },
            { symbol: "v_antrieb", name: "Rear-axle average speed", ja: "駆動輪（後軸）平均速度", offset: 42, format: 'uint16', scale: 0.0625, add: 0, unit: "km/h", group: "" },
            { symbol: "asc_st", name: "Torque intervention request", ja: "トルク介入 要求", offset: 44, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "fgr_b_aktiv", name: "Cruise-control status", ja: "クルーズコントロール 状態", offset: 45, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "pwg_mode", name: "Pedal sensing state", ja: "アクセルペダル検出 状態", offset: 46, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "edksi_zustand", name: "EGAS target/actual comparison state", ja: "EGAS 目標／実値 比較状態", offset: 47, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "md_dyn_st", name: "Dynamic filter status", ja: "動特性フィルタ 状態", offset: 48, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "gang", name: "Calculated gear", ja: "推定ギア段", offset: 49, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "s_krafts", name: "Powertrain engaged status", ja: "駆動力伝達（クラッチ接）状態", offset: 50, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
            { symbol: "sa_we_st", name: "Overrun fuel cutoff calculation status", ja: "減速時燃料カット 演算状態", offset: 51, format: 'uint8', scale: 1, add: 0, unit: "", group: "" },
        ],
    },
    {
        selection: 179,
        name: "Rough running (segment time deviation)",
        ja: "ラフラン（セグメント時間偏差）",
        group: "Misfire / Roughness",
        expectedLength: 16,
        fields: [
            { symbol: "lu[0]", name: "Segment time deviation cylinder 1", ja: "セグメント時間偏差 気筒1（物理気筒順）", offset: 0, format: 'int15', scale: 0.1, add: 0, unit: "%", group: "", de: "Segmentzeitabweichung des Geberrades, Zylinder 1 (physikalische Zylinderanordnung, NICHT Zuendreihenfolge)", deSource: 'reader-job', sgbdRow: "LESEN_SYSTEMCHECK_LAUFUNRUHE.LESEN_SYSTEMCHECK_LAUFUNRUHE_ZYL1_WERT" },
            { symbol: "lu[1]", name: "Segment time deviation cylinder 2", ja: "セグメント時間偏差 気筒2（物理気筒順）", offset: 2, format: 'int15', scale: 0.1, add: 0, unit: "%", group: "", de: "Segmentzeitabweichung des Geberrades, Zylinder 2 (physikalische Zylinderanordnung, NICHT Zuendreihenfolge)", deSource: 'reader-job', sgbdRow: "LESEN_SYSTEMCHECK_LAUFUNRUHE.LESEN_SYSTEMCHECK_LAUFUNRUHE_ZYL2_WERT" },
            { symbol: "lu[2]", name: "Segment time deviation cylinder 3", ja: "セグメント時間偏差 気筒3（物理気筒順）", offset: 4, format: 'int15', scale: 0.1, add: 0, unit: "%", group: "", de: "Segmentzeitabweichung des Geberrades, Zylinder 3 (physikalische Zylinderanordnung, NICHT Zuendreihenfolge)", deSource: 'reader-job', sgbdRow: "LESEN_SYSTEMCHECK_LAUFUNRUHE.LESEN_SYSTEMCHECK_LAUFUNRUHE_ZYL3_WERT" },
            { symbol: "lu[3]", name: "Segment time deviation cylinder 4", ja: "セグメント時間偏差 気筒4（物理気筒順）", offset: 6, format: 'int15', scale: 0.1, add: 0, unit: "%", group: "", de: "Segmentzeitabweichung des Geberrades, Zylinder 4 (physikalische Zylinderanordnung, NICHT Zuendreihenfolge)", deSource: 'reader-job', sgbdRow: "LESEN_SYSTEMCHECK_LAUFUNRUHE.LESEN_SYSTEMCHECK_LAUFUNRUHE_ZYL4_WERT" },
            { symbol: "lu[4]", name: "Segment time deviation cylinder 5", ja: "セグメント時間偏差 気筒5（物理気筒順）", offset: 8, format: 'int15', scale: 0.1, add: 0, unit: "%", group: "", de: "Segmentzeitabweichung des Geberrades, Zylinder 5 (physikalische Zylinderanordnung, NICHT Zuendreihenfolge)", deSource: 'reader-job', sgbdRow: "LESEN_SYSTEMCHECK_LAUFUNRUHE.LESEN_SYSTEMCHECK_LAUFUNRUHE_ZYL5_WERT" },
            { symbol: "lu[5]", name: "Segment time deviation cylinder 6", ja: "セグメント時間偏差 気筒6（物理気筒順）", offset: 10, format: 'int15', scale: 0.1, add: 0, unit: "%", group: "", de: "Segmentzeitabweichung des Geberrades, Zylinder 6 (physikalische Zylinderanordnung, NICHT Zuendreihenfolge)", deSource: 'reader-job', sgbdRow: "LESEN_SYSTEMCHECK_LAUFUNRUHE.LESEN_SYSTEMCHECK_LAUFUNRUHE_ZYL6_WERT" },
        ],
    },
];

export const MSS54_LIVE_FIELD_COUNT = 213;

/**
 * How much of the table carries the ECU's own German, and by which route.
 *
 * Published rather than kept in a commit message: the number is the honest
 * answer to 'are these names real', and it has to be able to go down as well
 * as up when the joins change.
 */
export const MSS54_LIVE_COVERAGE = {
    fields: 213,
    withGerman: 86,
    bySource: {
        'betriebswtab': 55,
        'job-result': 7,
        'reader-job': 6,
        'sibling-block': 2,
        'status-bits': 16,
    },
} as const;

/**
 * Joins that had evidence and were refused.
 *
 * NOT the list of fields without German — most of those simply have no SGBD
 * row at all. These are the ones where something plausible was available and
 * taking it would have asserted more than the source supports. Each is a
 * place a human should look when writing the names by hand.
 */
export const MSS54_LIVE_JOIN_REFUSALS: readonly LiveJoinRefusal[] = [
    { kind: "corrupt-source-row", sgbdRow: "BETRIEBSWTAB.ll_abw", why: "LNAME is 'Soll Strom Servotronikventil', which belongs to a different quantity. The row is wrong at the source; excluded by name rather than silently." },
    { kind: "byte-carries-several-bits", selection: 4, symbol: "zustand_motor", name: "Engine operating state", candidates: ["M_SS", "M_STRT", "M_LL", "M_TL", "M_VL", "M_ZA", "M_NL"], why: "The SGBD names one bit per row; this byte carries several. Any one of their names would be a claim about the whole byte." },
    { kind: "byte-carries-several-bits", selection: 4, symbol: "kr_st", name: "Knock controller", candidates: ["KLOPF", "SCHUTZ", "REGEL"], why: "The SGBD names one bit per row; this byte carries several. Any one of their names would be a claim about the whole byte." },
    { kind: "byte-carries-several-bits", selection: 4, symbol: "tz_ed_status", name: "Ignition channels", candidates: ["TZ1", "TZ2", "TZ3", "TZ4", "TZ5", "TZ6", "TZ7", "TZ8"], why: "The SGBD names one bit per row; this byte carries several. Any one of their names would be a claim about the whole byte." },
    { kind: "byte-carries-several-bits", selection: 4, symbol: "schalt_s_st", name: "Slave switch inputs", candidates: ["S_GANG", "S_KL15", "S_BLS", "S_BLTS", "S_KUP"], why: "The SGBD names one bit per row; this byte carries several. Any one of their names would be a claim about the whole byte." },
    { kind: "byte-carries-several-bits", selection: 4, symbol: "schalter_can", name: "CAN switch inputs", candidates: ["S_KO", "S_AC"], why: "The SGBD names one bit per row; this byte carries several. Any one of their names would be a claim about the whole byte." },
    { kind: "byte-carries-several-bits", selection: 4, symbol: "schalt_m_st", name: "Master switch inputs", candidates: ["S_KL50", "S_FDYN"], why: "The SGBD names one bit per row; this byte carries several. Any one of their names would be a claim about the whole byte." },
    { kind: "byte-carries-several-bits", selection: 4, symbol: "fgr_tast_reg", name: "MFL cruise button number", candidates: ["SMFL1", "SMFL2", "SMFL3", "SMFL4"], why: "The SGBD names one bit per row; this byte carries several. Any one of their names would be a claim about the whole byte." },
    { kind: "sibling-name-differs", selection: 83, symbol: "ml", name: "Air mass", siblingSelection: 3, siblingName: "Total air mass", why: "Same symbol in two blocks under different reference names. They may or may not be the same quantity; this refuses to decide." },
    { kind: "sibling-name-differs", selection: 83, symbol: "wdk1", name: "Throttle 1 position", siblingSelection: 3, siblingName: "Throttle potentiometer 1 actual position", why: "Same symbol in two blocks under different reference names. They may or may not be the same quantity; this refuses to decide." },
    { kind: "sibling-name-differs", selection: 4, symbol: "ti_ausblend_ist", name: "Injection channels", siblingSelection: 19, siblingName: "Injection blanking counter actual", why: "Same symbol in two blocks under different reference names. They may or may not be the same quantity; this refuses to decide." },
    { kind: "sibling-name-differs", selection: 83, symbol: "sa_we_st", name: "Overrun fuel cutoff calculation status", siblingSelection: 4, siblingName: "Overrun fuel cutoff", why: "Same symbol in two blocks under different reference names. They may or may not be the same quantity; this refuses to decide." },
];
