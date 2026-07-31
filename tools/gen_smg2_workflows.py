#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  gen_smg2_workflows.py — SMG II サービス機能（ワークフロー）定義を生成
# ----------------------------------------------------------------------------
#  入力: tools/SgbdDump/out/SMG2.json の tables（EdiabasLib で SGBD から権威抽出）
#        - TESTPRG        : テストプログラム番号→名称・所要時間（＝サービス手順一覧）
#        - STELLGLIEDER   : 駆動可能アクチュエータ→PIN
#        - STATTESTTEXTE  : テスト状態(STB)→テキスト
#        - INFOTEXTE<N>A  : 手順<N>の進行状態(IB)→テキスト
#        - INFOTEXTE<N>F  : 手順<N>のエラー(IB)→テキスト   ※ N(10進) = TESTPRG 0x0N
#  出力: ecu-data/smg2-workflows.json（バイリンガル {de,ja,en}）
#
#  ★データ（番号・所要時間・状態コード・独語原文）は SGBD 由来＝権威。
#    ja/en は下の PHRASES で厳選訳、無い語は translate.py にフォールバック。
#    手順の実行コマンド列（TESTPRG_STOP→…）は js/workflow.js 側にエンジンとして実装。
#    ※実車では書込/駆動系のため既定で実行不可（verified:false・デモ専用ゲート）。
# ============================================================================
import re, json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from translate import translate

HERE = os.path.dirname(__file__)
DUMP = os.path.join(HERE, "SgbdDump", "out", "SMG2.json")
OUT = os.path.join(HERE, "..", "ecu-data", "smg2-workflows.json")

# --- カテゴリ（利用者のメンタルモデル） ------------------------------------
CATS = [
    ("bleed",  "エア抜き",            "Bleeding"),
    ("clutch", "クラッチ適応",        "Clutch adaptation"),
    ("shift",  "シフト/変速機学習",   "Shift / gearbox learning"),
    ("sensor", "センサ校正",          "Sensor calibration"),
    ("total",  "完全適応",            "Complete adaptation"),
    ("aux",    "補助機能",            "Auxiliary"),
]

# --- 各 TESTPRG のメタ（分類・エンジン状態・準備要否・選択バイト・厳選訳） ----
#  engine: "off" = IG ON/エンジン停止,  "run" = エンジン始動  （0xA0テキストから判読）
#  prep  : ANSTEUERUNG_VORBEREITEN を先に送る必要（ポンプ/弁で油圧を作る手順）
#  cat, ja名, en名
PROC = {
 "0x01": dict(cat="bleed",  engine="off", prep=True,  auswahl=False, read=None,
    ja="クラッチ／油圧系のエア抜き", en="Clutch slave cylinder / hydraulic line bleeding"),
 "0x02": dict(cat="clutch", engine="run", prep=False, auswahl=False, read="clutch",
    ja="クラッチ食いつき点の学習", en="Learn clutch bite (grinding) point"),
 "0x03": dict(cat="clutch", engine="off", prep=True,  auswahl=False, read="clutch",
    ja="クラッチ弁特性値の学習", en="Learn clutch valve characteristics"),
 "0x04": dict(cat="clutch", engine="off", prep=True,  auswahl=False, read=None,
    ja="アキュムレータ予圧の測定", en="Determine accumulator pre-charge pressure"),
 "0x05": dict(cat="bleed",  engine="off", prep=True,  auswahl=False, read=None,
    ja="変速機アクチュエータのエア抜き", en="Gearbox actuator bleeding"),
 "0x06": dict(cat="shift",  engine="off", prep=True,  auswahl=False, read="gearbox",
    ja="セレクト角（ゲート）電流オフセット学習", en="Learn select-angle (gate) current offset"),
 "0x07": dict(cat="total",  engine="off", prep=True,  auswahl=False, read="gearbox",
    ja="変速機の完全適応", en="Complete gearbox adaptation"),
 "0x08": dict(cat="sensor", engine="off", prep=False, auswahl=False, read=None,
    ja="前後加速度センサのオフセット学習", en="Learn longitudinal accel-sensor offset"),
 "0x09": dict(cat="shift",  engine="off", prep=True,  auswahl=False, read="gearbox",
    ja="シフト経路中央位置の位置決め", en="Position shift-travel center"),
 "0x0A": dict(cat="aux",    engine="off", prep=True,  auswahl=True,  read=None,
    ja="任意のギアを投入", en="Engage arbitrary gear"),
 "0x0B": dict(cat="shift",  engine="off", prep=True,  auswahl=False, read="gearbox",
    ja="変速機の学習（ギア測定）", en="Gearbox learning (measure gears)"),
 "0x0C": dict(cat="shift",  engine="off", prep=True,  auswahl=False, read=None,
    ja="シフト中央・セレクト角センサの点検", en="Test shift-center & select-angle sensor"),
 "0x0D": dict(cat="shift",  engine="off", prep=True,  auswahl=False, read="gearbox",
    ja="ギア検出セレクト角の学習", en="Learn gear-detection select angle"),
 "0x15": dict(cat="aux",    engine="off", prep=True,  auswahl=False, read="clutch",
    ja="エンジン始動条件の確立", en="Establish engine-start conditions"),
}

# 手順の補足説明（利用者向け・厳選）
DESC = {
 "0x01": ("レリーズシリンダと油圧配管の空気を抜きます。所要約2分。",
          "Bleeds air from the clutch slave cylinder and hydraulic lines. ~2 min."),
 "0x02": ("クラッチのつながり始め（食いつき点）を学習します。エンジン始動・ニュートラルで実施。",
          "Learns the clutch engagement (bite) point. Engine running, neutral."),
 "0x03": ("クラッチ弁の特性（断接位置・ゼロ電流・弁オーバーラップ）を学習します。",
          "Learns clutch valve characteristics (engage/disengage position, zero current, valve overlap)."),
 "0x04": ("圧力アキュムレータの予圧を測定します。",
          "Measures the pressure accumulator's pre-charge pressure."),
 "0x05": ("変速機アクチュエータ（セレクト角・シフト経路シリンダ）を含む油圧系を完全にエア抜きします。約16分と長時間。",
          "Full bleed of the gearbox actuator hydraulics (select-angle & shift-travel cylinders). Long: ~16 min."),
 "0x06": ("セレクト角（ゲート方向）の電流オフセットを学習します。",
          "Learns the select-angle (gate direction) current offset."),
 "0x07": ("セレクト角→全ギア測定→ギア検出センサまでを一括で行う完全適応。クラッチ/変速機作業後の要となる手順。約2分30秒。",
          "One-shot complete adaptation: select angle → measure all gears → gear-detection sensor. The key step after clutch/gearbox work. ~2:30."),
 "0x08": ("前後加速度センサのオフセットを学習します。平坦な場所・車両静止で実施。",
          "Learns the longitudinal acceleration sensor offset. Level ground, vehicle stationary."),
 "0x09": ("シフト経路（Schaltweg）の中央位置を位置決めします。",
          "Positions the shift-travel center."),
 "0x0A": ("任意のギア（0=N, 1–6, 7=R）を投入します。点検用。",
          "Engages an arbitrary gear (0=N, 1–6, 7=R). For inspection."),
 "0x0B": ("1〜6速・R の各ギア窓を測定し学習します（完全適応のギア測定部）。",
          "Measures and learns each gear window 1–6 & R (the gear-measurement part of full adaptation)."),
 "0x0C": ("シフト中央位置とセレクト角センサの健全性を点検します（書込なし）。",
          "Checks shift-center and select-angle sensor integrity (no write)."),
 "0x0D": ("ギア検出用セレクト角を学習します。",
          "Learns the select angle used for gear detection."),
 "0x15": ("クラッチ弁特性を確立してエンジン始動条件を作ります（緊急始動用）。",
          "Establishes clutch valve characteristics to enable engine start (emergency start aid)."),
}

# --- 厳選フレーズ辞書（進行状態・エラー・前提の独→ja/en） --------------------
# PHRASES was here: German->ja/en pairs whose KEYS are verbatim SGBD
# strings. Removed from the published history for the same reason
# tools/terms/ is not published. See docs/PRESERVED.md.
from terms.smg2_workflows import PHRASES  # noqa: E402

def tr(de, lang):
    """独→ja/en：厳選辞書を最優先、無ければ translate.py にフォールバック。"""
    de = (de or "").strip()
    if de in PHRASES:
        return PHRASES[de][0 if lang == "ja" else 1]
    return translate(de, lang, decompose=False)

def txt(de):
    return {"de": de, "ja": tr(de, "ja"), "en": tr(de, "en")}

# 前提条件（engine 状態から生成） ------------------------------------------
def prereqs(engine, cat):
    p = []
    if engine == "run":
        p.append(("エンジン始動・ニュートラル・IG ON", "Engine running, neutral, ignition ON"))
    else:
        p.append(("IG ON・エンジン停止・ニュートラル", "Ignition ON, engine OFF, neutral"))
    p.append(("バッテリ電圧が十分（充電器推奨）", "Sufficient battery voltage (charger recommended)"))
    if cat in ("bleed", "clutch", "shift", "total"):
        p.append(("油温が常温付近・車両は平坦な場所で静止", "Fluid near ambient temp; vehicle stationary on level ground"))
    if cat == "sensor":
        p.append(("平坦な場所で車両を完全静止（傾斜厳禁）", "Vehicle fully stationary on level ground (no incline)"))
    return [{"ja": a, "en": b} for a, b in p]

# --- 推奨シーケンス（順序は SGBD 非定義。手順依存とSMG II整備実務に基づく） --
SEQUENCES = [
 dict(id="full_service", steps=["0x01","0x05","0x04","0x03","0x02","0x07","0x08"],
      ja="フルサービス再適応（クラッチ/変速機作業後）",
      en="Full service re-adaptation (after clutch/gearbox work)",
      note_ja="推奨順序です。SGBDテーブルに順序定義は無く、各手順の依存関係とSMG II整備実務に基づきます。実施前に必ず整備マニュアル(TIS)で確認してください。",
      note_en="Recommended order. The SGBD tables do not define an order; this is based on inter-step dependencies and SMG II service practice. Always confirm against the repair manual (TIS)."),
 dict(id="shift_only", steps=["0x06","0x09","0x0D","0x07"],
      ja="シフト系のみ再適応（シフトの入り調整）",
      en="Shift-only re-adaptation (shift engagement tuning)",
      note_ja="セレクト角オフセット→中央位置→ギア検出→完全適応。シフトの入り（節度）を整えたいときの最小手順。",
      note_en="Select-angle offset → center → gear detection → complete adaptation. Minimal set to tune shift engagement feel."),
]

def build():
    d = json.load(open(DUMP, encoding="utf-8"))
    tables = d["tables"]

    def rows(name):
        r = tables.get(name)
        return r[1:] if r else []

    testprg = {r[0]: r for r in rows("TESTPRG")}
    stell = [{"id": r[0], "pin": r[1], "ja": tr(r[0].replace("_", " ").title(), "ja"),
              "en": r[0].replace("_", " ").title()} for r in rows("STELLGLIEDER")]
    teststatus = [{"code": r[0], **txt(r[1])} for r in rows("STATTESTTEXTE")]

    procs = []
    for nr, meta in PROC.items():
        row = testprg.get(nr)
        if not row:
            print(f"  !! TESTPRG {nr} がテーブルに無い"); continue
        n = int(nr, 16)
        act = [{"code": r[0], **txt(r[1])} for r in rows(f"INFOTEXTE{n}A")]
        flt = [{"code": r[0], **txt(r[1])} for r in rows(f"INFOTEXTE{n}F")]
        procs.append({
            "id": nr, "testprg": nr, "cat": meta["cat"],
            "name": {"de": row[1], "ja": meta["ja"], "en": meta["en"]},
            "desc": {"ja": DESC[nr][0], "en": DESC[nr][1]},
            "durTyp": row[2].strip(), "durMax": row[3].strip(),
            "durMaxSec": dur_sec(row[3] or row[2]),
            "engine": meta["engine"], "needsPrepare": meta["prep"],
            "auswahl": meta["auswahl"], "readResults": meta["read"],
            "risk": "high" if meta["cat"] in ("total", "shift", "bleed") else "med",
            "prereq": prereqs(meta["engine"], meta["cat"]),
            "activity": act, "faults": flt,
        })

    seqs = [{"id": s["id"], "name": {"ja": s["ja"], "en": s["en"]},
             "note": {"ja": s["note_ja"], "en": s["note_en"]},
             "steps": s["steps"]} for s in SEQUENCES]

    prof = {
        "module": "smg2", "sgbd": "SMG2.prg", "address": "0x32",
        "source": "EdiabasLib tables TESTPRG/STELLGLIEDER/INFOTEXTE*/STATTESTTEXTE (authoritative)",
        "safety": {
            "ja": "これらはすべて実車ECUへ書込・アクチュエータ駆動を行うサービス機能です。誤操作は変速機・クラッチ・油圧系を損傷し得ます。油圧ポンプは自動停止しません（最大60秒／SG-Timeout 10秒）。100barで圧力制限弁が開きポンプが劣化します。本アプリでは既定で実行不可（デモ専用）。実施は必ず整備マニュアル(TIS)と適合条件の確認後に。",
            "en": "These are all service functions that WRITE to the ECU and drive actuators. Misuse can damage the gearbox, clutch, or hydraulics. The hydraulic pump does not auto-stop (max 60 s / SG-Timeout 10 s). At 100 bar the relief valve opens and degrades the pump. Disabled by default in this app (demo only). Only perform after confirming the repair manual (TIS) and conditions.",
        },
        "categories": [{"key": k, "ja": ja, "en": en} for k, ja, en in CATS],
        "actuators": stell, "testStatus": teststatus,
        "procedures": procs, "sequences": seqs,
    }
    json.dump(prof, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"  procedures={len(procs)}  sequences={len(seqs)}  actuators={len(stell)}  -> {OUT}")

def dur_sec(s):
    """'16 min' / '2,30 min' / '10 sek' → 秒。"""
    s = (s or "").strip().lower().replace(",", ".")
    m = re.match(r"([\d.]+)\s*(min|sek|sec|s)", s)
    if not m:
        return 60
    v = float(m.group(1)); unit = m.group(2)
    if unit == "min":
        whole = int(v); frac = v - whole
        return whole * 60 + int(round(frac * 100)) if frac and frac * 100 < 60 else int(v * 60)
    return int(v)

if __name__ == "__main__":
    build()
