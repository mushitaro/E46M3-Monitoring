# -*- coding: utf-8 -*-
# ============================================================================
#  translate.py — 独語(SGBD由来) → (日本語, 英語) トークン翻訳
#  項目名 (STATUS_EVANOS1_IST 等) と故障テキスト (Einlass-VANOS Bank 1 soll 等)
#  を、独語自動車用語の複合語分解＋トークン辞書でバイリンガル化する。
#  ※ E=Einlass(吸気), A=Auslass(排気)（BMW SGBD の表記）。
# ============================================================================

# German token -> (ja, en)
DICT = {
    # --- engine / basics ---
    "MOTORDREHZAHL": ("エンジン回転数", "Engine RPM"), "DREHZAHL": ("回転数", "RPM"),
    "MOTOR": ("エンジン", "Engine"), "GESCHWINDIGKEIT": ("車速", "Speed"),
    "GESCHW": ("車速", "Speed"), "FAHRZEUG": ("車両", "Vehicle"),
    "LAST": ("負荷", "Load"), "LADUNG": ("充填", "Charge"), "FUELLUNG": ("充填", "Charge"),
    "LAUFRUHE": ("回転むら", "Smoothness"), "BETRIEB": ("運転", "Operation"),
    "STATUS": ("状態", "Status"), "WERT": ("値", "Value"), "ANZAHL": ("数", "Count"),
    # --- temperature ---
    "TEMPERATUR": ("温度", "Temp"), "TEMP": ("温度", "Temp"),
    "KUEHLWASSER": ("冷却水", "Coolant"), "KUEHLW": ("冷却水", "Coolant"),
    "OEL": ("オイル", "Oil"), "OELTEMPERATUR": ("油温", "Oil temp"),
    "LUFT": ("吸気", "Air"), "ANSAUG": ("吸気", "Intake"), "AUSSEN": ("外気", "Ambient"),
    "UMGEBUNG": ("外気", "Ambient"), "UMGEBUNGSDRUCK": ("大気圧", "Ambient press."),
    "INNEN": ("内部", "Internal"), "INNENTEMP": ("内部温度", "Internal temp"),
    # --- electrical ---
    "SPANNUNG": ("電圧", "Voltage"), "SPG": ("電圧", "Voltage"), "UBATT": ("バッテリー電圧", "Battery V"),
    "VERSORGUNG": ("供給", "Supply"), "VERSORGUNGSSPANNUNG": ("供給電圧", "Supply voltage"),

    "STROM": ("電流", "Current"), "DRUCK": ("圧力", "Pressure"),
    "WIDERSTAND": ("抵抗", "Resistance"), "FREQUENZ": ("周波数", "Frequency"),
    # --- fuel / injection / ignition ---
    "EINSPRITZ": ("噴射", "Injection"), "EINSPRITZZEIT": ("噴射時間", "Injection time"),
    "ZUENDUNG": ("点火", "Ignition"), "ZUEND": ("点火", "Ignition"),
    "ZUENDWINKEL": ("点火時期", "Ignition angle"), "WINKEL": ("角度", "Angle"),
    "KRAFTSTOFF": ("燃料", "Fuel"), "BENZIN": ("燃料", "Fuel"), "TANK": ("タンク", "Tank"),
    "KLOPF": ("ノック", "Knock"), "KLOPFSENSOR": ("ノックセンサ", "Knock sensor"),
    "EV": ("インジェクタ", "Injector"), "EKP": ("燃料ポンプ", "Fuel pump"),
    "ZUMESSUNG": ("計量", "Metering"), "GEMISCH": ("混合気", "Mixture"),
    # --- lambda / exhaust ---
    "LAMBDA": ("ラムダ", "Lambda"), "SONDE": ("センサ", "Sensor"),
    "LAMBDASONDE": ("O2センサ", "O2 sensor"), "LAMBDASONDENHZG": ("O2ヒーター", "O2 heater"),
    "LAMBDAREGLER": ("ラムダ制御", "Lambda ctrl"), "REGLER": ("制御器", "Controller"),
    "REGELFAKTOR": ("制御係数", "Control factor"), "REGELUNG": ("制御", "Control"),
    "KAT": ("触媒", "Cat"), "ABGAS": ("排ガス", "Exhaust gas"),
    "SEKUNDARLUFT": ("2次エア", "Secondary air"), "SLP": ("2次エアポンプ", "SAP"),
    "HEIZUNG": ("ヒーター", "Heater"), "HZG": ("ヒーター", "Heater"), "HEIZ": ("ヒーター", "Heater"),
    "DMTL": ("蒸発ガス漏れ検出", "Leak detect"),
    # --- adaptation ---
    "ADAPTION": ("適応", "Adaptation"), "ADAPT": ("適応", "Adapt"), "ADAPTIONSBLOCK": ("適応ブロック", "Adapt block"),
    "ADDITIV": ("加算", "Additive"), "ADD": ("加算", "Additive"),
    "MULTIPLIKATIV": ("乗算", "Multiplicative"), "MULT": ("乗算", "Mult."),
    "OFFSET": ("オフセット", "Offset"), "FAKTOR": ("係数", "Factor"),
    "ABWEICHUNG": ("偏差", "Deviation"), "KORREKTUR": ("補正", "Correction"),
    "INT": ("積分", "Integral"), "GEBERRAD": ("センサホイール", "Sensor wheel"),
    # --- VANOS / camshaft ---  (E=Einlass 吸気, A=Auslass 排気)
    "VANOS": ("VANOS", "VANOS"), "EVANOS": ("吸気VANOS", "Int.VANOS"), "AVANOS": ("排気VANOS", "Exh.VANOS"),
    "EINLASS": ("吸気", "Intake"), "AUSLASS": ("排気", "Exhaust"), "AUSL": ("出口", "Outlet"),
    "NOCKENWELLE": ("カムシャフト", "Camshaft"), "NW": ("カム", "Cam"),
    "KURBELWELLE": ("クランクシャフト", "Crankshaft"), "KW": ("クランク", "Crank"),
    "VERSTELLZEIT": ("調整時間", "Adjust time"), "VERSTELL": ("調整", "Adjust"),
    "DICHTHEIT": ("気密", "Tightness"), "DICHTHEITMESSUNG": ("気密測定", "Tightness meas."),
    "FRUEHANSCHLAG": ("進角端", "Advance stop"), "SPAETANSCHLAG": ("遅角端", "Retard stop"),
    "FRUEH": ("進角", "Advance"), "SPAET": ("遅角", "Retard"), "ANSCHLAG": ("端", "Stop"),
    "FRUEHVENTIL": ("進角弁", "Adv. valve"), "SPAETVENTIL": ("遅角弁", "Ret. valve"),
    # --- throttle / idle ---
    "DROSSELKLAPPE": ("スロットル", "Throttle"), "DROSSEL": ("スロットル", "Throttle"),
    "DKP": ("スロットル開度", "Throttle pos"), "DK": ("スロットル", "Throttle"),
    "PEDAL": ("ペダル", "Pedal"), "PWG": ("アクセルペダル", "Accel pedal"),
    "LEERLAUF": ("アイドル", "Idle"), "LL": ("アイドル", "Idle"), "AQREL": ("A/C要求", "A/C req"),
    # --- sensors / supply ---
    "SENSOR": ("センサ", "Sensor"), "SENSORVERSORGUNG": ("センサ電源", "Sensor supply"),
    "GEBER": ("センサ", "Sensor"), "MASTER": ("マスタ", "Master"), "SLAVE": ("スレーブ", "Slave"),
    "MASSE": ("アース", "Ground"), "VERSORGUNG": ("電源", "Supply"),
    # --- actuators ---
    "VENTIL": ("バルブ", "Valve"), "PUMPE": ("ポンプ", "Pump"), "RELAIS": ("リレー", "Relay"),
    "LUEFTER": ("ファン", "Fan"), "STELLGLIED": ("アクチュエータ", "Actuator"),
    "ANSTEUERN": ("駆動", "Actuate"), "STEUERN": ("制御", "Control"),
    "DRUCKSPEICHERVENTIL": ("蓄圧弁", "Accum. valve"), "ANHEBUNG": ("上昇", "Raise"),
    # --- transmission (SMG) ---
    "GANG": ("ギア段", "Gear"), "KUPPLUNG": ("クラッチ", "Clutch"), "GETRIEBE": ("変速機", "Transmission"),
    "MOMENT": ("トルク", "Torque"), "WAEHLHEBEL": ("セレクタ", "Selector"),
    "SCHALT": ("変速", "Shift"), "HYDRAULIK": ("油圧", "Hydraulic"),
    # --- chassis (DSC) ---
    "BREMSE": ("ブレーキ", "Brake"), "BREMS": ("ブレーキ", "Brake"), "BREMSDRUCK": ("ブレーキ圧", "Brake press"),
    "RAD": ("車輪", "Wheel"), "RADDREHZAHL": ("車輪速", "Wheel speed"),
    "VORDERRAD": ("前輪", "Front wheel"), "HINTERRAD": ("後輪", "Rear wheel"),
    "GIER": ("ヨー", "Yaw"), "GIERRATE": ("ヨーレート", "Yaw rate"),
    "QUERBESCHLEUNIGUNG": ("横加速度", "Lateral accel"), "QUER": ("横", "Lateral"),
    "LAENGS": ("前後", "Longitudinal"), "BESCHLEUNIGUNG": ("加速度", "Acceleration"),
    "LENKWINKEL": ("舵角", "Steering angle"), "LENK": ("ステアリング", "Steering"),
    "ABS": ("ABS", "ABS"), "ASC": ("ASC", "ASC"), "DSC": ("DSC", "DSC"), "MSR": ("MSR", "MSR"),
    "WARNLAMPE": ("警告灯", "Warning lamp"), "WARNLAMPEN": ("警告灯", "Warning lamps"),
    "BLS": ("ブレーキ灯SW", "Brake light sw"),
    # --- misc /状態 ---
    "IST": ("実", "actual"), "SOLL": ("目標", "target"),
    "VOR": ("前", "before"), "NACH": ("後", "after"),
    "LINKS": ("左", "Left"), "RECHTS": ("右", "Right"),
    "PROZ": ("%", "%"), "KMH": ("km/h", "km/h"),
    "SCHWELLE": ("しきい値", "Threshold"), "GROB": ("粗", "Coarse"), "FEIN": ("細", "Fine"),
    "KURVE": ("カーブ", "Curve"), "KOMPENSATION": ("補正", "Compensation"),
    "KURVENKOMPENSATION": ("カーブ補正", "Curve compensation"),
    "EINKOMPENSATION": ("補正込み", "Compensated"),
    "INTEGRATOR": ("積分器", "Integrator"), "SUMME": ("合計", "Sum"),
    "SERVO": ("サーボ", "Servo"), "LDP": ("燃料タンクリークポンプ", "Leak diagnostic pump"),
    "DDS": ("DDS", "DDS"),
    "BANK": ("バンク", "Bank"), "ZYLINDER": ("気筒", "Cylinder"), "ZYL": ("気筒", "Cyl"),
    "EIN": ("ON", "on"), "AUS": ("OFF", "off"), "AKTIV": ("作動", "active"),
    "VORHANDEN": ("存在", "present"), "SYNCHRONISATION": ("同期", "Sync"),
    "DIGITAL": ("デジタル", "Digital"), "ANALOG": ("アナログ", "Analog"),
    "ZUFALLSZAHL": ("乱数", "Random"), "AUTHENTISIERUNG": ("認証", "Authentication"),
    "FEHLER": ("故障", "Fault"), "KLEMME": ("端子", "Terminal"), "KL": ("端子", "Term"),
    "ZEIT": ("時間", "Time"), "MESSWERTE": ("計測値", "Measured"), "MESSWERT": ("計測値", "Measured"),
    "DATUM": ("日付", "Date"), "NR": ("番号", "No"), "KENNUNG": ("識別", "ID"),
    "INTERN": ("内部", "Internal"), "EXTERN": ("外部", "External"),
    "BEHOERDEN": ("公的", "Authority"), "CHECK": ("チェック", "Check"),
    "STARTWERT": ("始動値", "Start value"), "SIGNAL": ("信号", "Signal"),
    "EWS": ("EWS", "EWS"), "MOSTCTRL": ("MOST制御", "MOST ctrl"),
    # --- 故障句でよく出る語 ---
    "EINHEIT": ("ユニット", "unit"), "VORZEITIG": ("早期に", "prematurely"),
    "WEGGEDRIFTET": ("ドリフト", "drifted"), "GEDRIFTET": ("ドリフト", "drifted"),
    "UNTERBROCHEN": ("中断", "interrupted"), "UNTERBRECHUNG": ("断線", "open circuit"),
    "BEENDET": ("完了", "completed"), "NICHT": ("未", "not"),
    "INTERFACEFEHLER": ("インターフェース故障", "Interface error"), "FRAME": ("フレーム", "Frame"),
    "PARITY": ("パリティ", "Parity"), "TIMEOUT": ("タイムアウト", "Timeout"),
    "GESTOERT": ("異常", "disturbed"), "STOERUNG": ("異常", "fault"),
    "PLAUSIBEL": ("妥当", "plausible"), "PLAUSIBILITAET": ("妥当性", "Plausibility"),
    "KURZSCHLUSS": ("短絡", "Short circuit"), "LEITUNG": ("配線", "Wire"),
    "OBERE": ("上限", "Upper"), "UNTERE": ("下限", "Lower"), "GRENZE": ("限界", "Limit"),
    "REGELBEREICH": ("制御範囲", "Control range"), "BEREICH": ("範囲", "Range"),
    "DEFEKT": ("故障", "Defective"), "FEHLT": ("欠落", "Missing"),
    "ZU": ("過", "too"), "HOCH": ("高", "high"), "NIEDRIG": ("低", "low"),
    "GROSS": ("大", "large"), "KLEIN": ("小", "small"), "MASSEschluss": ("地絡", "Short to ground"),
    "SICHERUNG": ("ヒューズ", "Fuse"), "ANSTOSSEN": ("開始", "trigger"), "ANFAHREN": ("移行", "approach"),
    "MESSUNG": ("測定", "Measurement"), "STROMKREIS": ("回路", "Circuit"),
    "ODER": ("または", "or"), "UND": ("と", "and"), "MIT": ("付", "with"), "OHNE": ("なし", "without"),
    "FUER": ("用", "for"), "GEGEN": ("対", "against"), "IM": ("", "in"), "FESTE": ("固定", "fixed"),
    # --- アクション動詞/ジョブ語（適応/リセット/アクチュエータ） ---
    "LESEN": ("読取", "Read"), "LOESCHEN": ("リセット", "Reset"), "SCHREIBEN": ("書込", "Write"),
    "RESET": ("リセット", "Reset"),
    "INITIALISIERUNG": ("初期化", "Initialization"), "INITIALISIEREN": ("初期化", "Initialize"),
    "AKTIVIERUNG": ("有効化", "Activation"), "MAGNETVENTIL": ("電磁弁", "Solenoid valve"),
    "MAGNET": ("電磁", "Solenoid"), "ADAPTIONSWERTE": ("適応値", "Adapt. values"),
    "ADAPTIONSWERT": ("適応値", "Adapt. value"), "STELLGLIEDER": ("アクチュエータ", "Actuators"),
    "GASSE": ("シフトゲート", "Shift gate"), "SG": ("ECU", "ECU"), "FS": ("故障メモリ", "Fault mem"),
    "EDIC": ("EDIC", "EDIC"), "GRUNDEINSTELLUNG": ("基本設定", "Base setting"),
    "ENTLUEFTEN": ("エア抜き", "Bleeding"), "ENTLUEFTUNG": ("エア抜き", "Bleeding"),
    "ABGLEICH": ("較正", "Calibration"), "LERNEN": ("学習", "Learn"), "FREISCHALTEN": ("解除", "Unlock"),
    "SCHLEIF": ("スリップ", "Slip"), "PKT": ("点", "point"), "UEBERDECKUNG": ("オーバーラップ", "Overlap"),
    "UEBERLAST": ("過負荷", "Overload"), "NULLPUNKT": ("ゼロ点", "Zero point"), "TOUCH": ("接点", "Touch"),
    "SCHALTWEG": ("シフト経路", "Shift path"), "WAHLHEBEL": ("セレクタ", "Selector"),
    "EINGANGS": ("入力", "Input"), "AUSGANGS": ("出力", "Output"),
    # --- SGBD説明文に頻出する複合語（_JOBCOMMENTS/_RESULTS 由来） ---
    "LAMBDASONDENHEIZUNG": ("O2センサヒーター", "O2 sensor heater"),
    "BESCHLEUNIGUNGSANREICHERUNG": ("加速増量", "Accel enrichment"),
    "SCHUBABSCHALTUNG": ("減速燃料カット", "Overrun cutoff"),
    "SCHALTEINGAENGE": ("スイッチ入力", "Switch inputs"),
    "STELLGLIEDER": ("アクチュエータ", "Actuators"),
    "FEHLERSPEICHER": ("故障メモリ", "Fault memory"),
    "SCHUTZMECHANISMUS": ("保護機構", "Protection"),
    "ABGLEICHWERTE": ("調整値", "Adjust values"),
    "GETRIEBEDATEN": ("変速機データ", "Gearbox data"),
    "ADAPTIONSWERTEN": ("適応値", "Adapt. values"),
    "CODIERDATEN": ("コーディングデータ", "Coding data"),
    "KONTROLLBYTE": ("制御バイト", "Control byte"),
    "TESTPROGRAMM": ("テストプログラム", "Test program"),
    "DIAGNOSEMODE": ("診断モード", "Diag mode"),
    "PRUEFSTEMPEL": ("検査スタンプ", "Test stamp"),
    "ANWENDER": ("ユーザー", "User"), "ZELLEN": ("セル", "cells"),
    "BELIEBIGE": ("任意の", "arbitrary"), "AUSLESEN": ("読出", "Read out"),
    "BESCHREIBEN": ("書込", "Write"), "ZURUECKSETZEN": ("リセット", "Reset"),
    "VORBEREITEN": ("準備", "Prepare"), "ANSTEUERN": ("駆動", "Actuate"),
    "BEENDEN": ("終了", "End"), "STARTEN": ("開始", "Start"),
    "AUFRECHTERHALTEN": ("維持", "Maintain"), "VERAENDERN": ("変更", "Change"),
    "MAXIMALE": ("最大", "Max"), "BLOCKLAENGE": ("ブロック長", "Block length"),
    "HARDWARESTATI": ("HW状態", "HW status"), "EINGAENGE": ("入力", "Inputs"),
    "SHADOWSPEICHER": ("シャドウメモリ", "Shadow memory"),
    "INIT": ("初期化", "Init"), "EGS": ("EGS", "EGS"), "SMG": ("SMG", "SMG"),
    "TEILLAST": ("部分負荷", "Part load"), "VOLLAST": ("全負荷", "Full load"), "VOLLLAST": ("全負荷", "Full load"),
    "LAGE": ("位置", "Position"), "NEUPROGRAMMIERUNG": ("再プログラミング", "Reprogramming"),
    "ZAEHLER": ("カウンタ", "Counter"), "HINWEIS": ("注意", "Note"), "ZUVOR": ("事前に", "beforehand"),
    "LAUFENDEN": ("実行中の", "running"), "LAUFEND": ("実行中", "running"),
    "TESTPROGRAMMES": ("テストプログラム", "Test program"), "ARGUMENT": ("引数", "Argument"),
    "NUR": ("のみ", "only"), "NULL": ("ゼロ", "zero"), "SETZEN": ("設定", "set"),
    # 冠詞・前置詞は落とす（訳文を読みやすく）
    "DER": ("", ""), "DIE": ("", ""), "DAS": ("", ""), "DES": ("", ""), "DEM": ("", ""), "DEN": ("", ""),
    "EINE": ("", ""), "EINES": ("", ""), "EINER": ("", ""), "EINEM": ("", ""),
}

_MAXLEN = max(len(k) for k in DICT)

import re
from term_overrides import lookup as _phrase_lookup  # tools/terms/*.py の統合フレーズ表

_LEFTOVER_SEP = "・"  # 日本語: 未訳(独語のまま)断片と訳語断片の境界にのみ挿入する記号
                       # （訳語どうしの間には挿入しない＝自然な複合語のまま詰めて表示する）


def _join_frags(frags, idx):
    """(訳文断片, 未訳フラグ) のリストを結合する。
       英語(idx==1): 常に半角空白区切り（従来どおり、変更なし）。
       日本語(idx==0): 訳語どうしは詰めて自然な複合語に見せるが、未訳の独語断片が
       隣接する境界にだけ _LEFTOVER_SEP を挟み、視覚的に分離する
       （例: "状態・Fahrgeschwindigkeitsregler"）。"""
    if idx == 1:
        return " ".join(x for x, _ in frags if x)
    # 全断片が未訳なら、それは「日本語の中に独語が混ざった文」ではなく素の独語。
    # 区切り記号は訳語との境界を示すためのものなので、境界が存在しないこの場合に
    # 挿入すると "Wort・Wort・Wort" となり、独語として読めなくなる（実測: SMG II の
    # コード表 288 行のうち 26 行がこの状態だった）。半角空白で繋いで独語のまま出す。
    kept = [(x, bad) for x, bad in frags if x]
    if kept and all(bad for _, bad in kept):
        return " ".join(x for x, _ in kept)
    out, prev_bad = [], False
    for text, is_bad in frags:
        if not text:
            continue
        if out and (prev_bad or is_bad):
            out.append(_LEFTOVER_SEP)
        out.append(text)
        prev_bad = is_bad
    return "".join(out)


def _tok(t, idx, decompose=True):
    """1トークンを翻訳する。
       戻り値: (訳文, 未訳フラグ, 元トークンの文字数)
       未訳フラグ: DICTで解決できずそのまま残った(=独語のまま)場合 True。
       文字数: leftover_ratio() の重み付け（長い未訳語ほど重く数える）に使う。"""
    if not t:
        return "", False, 0
    if t.isdigit():
        return t, False, len(t)
    T = t.upper()                      # 大文字小文字を無視して照合
    if T in DICT:
        return DICT[T][idx], False, len(t)
    if not decompose:
        return t, True, len(t)         # 全語一致のみ（故障文の誤分解を防ぐ）→ 丸ごと未訳扱い
    # 複合語を貪欲に最長一致で分解（識別子用）
    res, i, n = [], 0, len(T)
    leftover = ""
    while i < n:
        m = None
        for L in range(min(n, i + _MAXLEN), i, -1):
            sub = T[i:L]
            if sub in DICT:
                m = (sub, L); break
        if m:
            if leftover:
                res.append((leftover.capitalize(), True)); leftover = ""
            res.append((DICT[m[0]][idx], False)); i = m[1]
        else:
            leftover += T[i]; i += 1
    if leftover:
        res.append((leftover.capitalize(), True))
    return _join_frags(res, idx), any(bad for _, bad in res), len(t)


def translate(text, lang, decompose=True, strip_prefixes=("STATUS_", "STAT_", "STEUERN_")):
    """識別子/独語句を ja/en に。区切り _ - / 空白で分割。
       フォールバック順:
         ① tools/terms/*.py の厳選フレーズ表（tools/term_overrides.py 経由・完全一致のみ）
         ② DICT / _tok() によるトークン単位の機械的翻訳
         ③ 元の独語のまま（最終手段。_LEFTOVER_SEP で訳語断片と視覚的に区切る）
       decompose=True: 複合語を分解（識別子向け）。False: 全語一致のみ（故障文向け）。"""
    idx = 0 if lang == "ja" else 1
    hit = _phrase_lookup((text or "").strip(), lang)      # ① フレーズ表を最優先で試す
    if hit is not None:
        return hit
    s = text
    for p in strip_prefixes:
        if s.startswith(p):
            s = s[len(p):]; break
    s = s.replace("JOBCOMMENT:", "")
    parts = [p for p in re.split(r"[ _\-/().]+", s) if p]
    frags = [_tok(p, idx, decompose)[:2] for p in parts]  # ② DICT/_tok フォールバック
    joined = _join_frags(frags, idx)
    return joined or text                                  # ③ 最終手段


def leftover_ratio(text, decompose=True, strip_prefixes=("STATUS_", "STAT_", "STEUERN_")):
    """0.0=完全に翻訳済み 〜 1.0=丸ごと未訳（独語のまま）。
       gen_from_dump.py の lbl_for() がラベル候補の品質を比較するのに使う
       （tools/verify_translation_quality.py はこれに依存しない独立検査）。
       言語非依存（フレーズ表/DICTで解決できるか否かで決まるため常に 'ja' 側で判定する）。"""
    if _phrase_lookup((text or "").strip(), "ja") is not None:
        return 0.0
    s = text
    for p in strip_prefixes:
        if s.startswith(p):
            s = s[len(p):]; break
    s = s.replace("JOBCOMMENT:", "")
    parts = [p for p in re.split(r"[ _\-/().]+", s) if p]
    if not parts:
        return 0.0
    total = bad = 0
    for p in parts:
        _, is_bad, ln = _tok(p, 0, decompose)
        total += ln
        if is_bad:
            bad += ln
    return (bad / total) if total else 0.0
