#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ジョブ id → 分類。**唯一の導出器**。

## なぜ1箇所に集めるのか

同じジョブ id から事実を再導出する正規表現が、これまで6箇所にあった:

    gen_from_dump.py   EXCLUDE / TESTJOB / ADAPTJOB
    src/lib/ecuCatalog.ts  jobRisk / jobPreconditions / execStyle（呼出0件）

そして食い違っていた。`ABGLEICHWERTE_LESEN` は生成器が「永続書込」に分類し、
`jobRisk` が `low`、`jobOps` が `read` と判定していた。3つが同時に正しいことは
ありえない。分類はここで一度だけ行い、生成物に焼き込む。TypeScript 側は読むだけ。

## 4つの軸は独立している

1つの enum に畳むと必ず破綻する。SMG II の 0x02（クラッチ食いつき点学習）は
**ECU が自走する**が**エンジン稼働を人間が用意する**必要がある。`actor` 一つでは
両方を言えない。

    class            この操作は何をする種類のものか（読取/試験/較正/コーディング/書換/プロトコル）
    audience         誰が実行するものか（オーナー/整備者/プロトコル内部）
    system           車のどの系統か
    actor            開始後に誰が進めるか
    termination      どう終わるか
    result_delivery  答えがどこに出るか

## 個別上書きが要る理由

既知の誤分類はパターンではなく**個体**である。`ID_SCHREIBEN` は `_SCHREIBEN` で
較正に見えるが実体は検査スタンプ書込（Prüfstempel）で、同じものが
`PRUEFSTEMPEL_SCHREIBEN` という名でも存在し、そちらは除外されていた。
名前の規則をいくら磨いてもこれは直らない。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# 語彙
# ---------------------------------------------------------------------------

CLASS_READ = "read"                # 読むだけ。車両状態は変わらない
CLASS_TEST = "test"                # 一時的に動かす。終われば元に戻る
CLASS_CALIBRATION = "calibration"  # 学習値・調整値を書き換える
CLASS_CODING = "coding"            # 車両コーディング（装備構成）
# 車両の**同一性**を決める値。車台番号・受注/製造データ・イモビライザの鍵材料・
# 積算距離。学習値ではないので calibration ではなく、装備構成でもないので coding
# でもなく、プログラム領域でもないので programming でもない。
#
# この class が要る理由は、無いときに何が起きていたかで説明できる。`_SCHREIBEN$`
# という総称規則が拾って `calibration / audience=owner` にしていたので、
# EWS3 の `ISN_SCHREIBEN`（イモビライザの秘密鍵）と `FGNR_SCHREIBEN`（車台番号）が
# 「学習値・調整値を書き換えます」という説明付きで、**オーナー向け**として並んでいた。
# 説明文が事実と違う。43 ジョブ。
CLASS_IDENTITY = "identity"        # 車台番号・受注データ・鍵材料・積算距離

# 同一性を書き換えるジョブと、そう判断した根拠（SGBD 原文）。**名前ではなく本文で
# 決めている**ことを、表そのものが示している必要がある——値は provenance で、
# `sgbd-comment` は「コメントがそう言っている」、`sgbd-args` は「コメントは言って
# いないが引数が言っている」。
IDENTITY_JOBS: dict[str, str] = {
    # 車台番号
    "C_FG_AUFTRAG": "sgbd-comment",                  # Schreiben der 17-stelligen Fahrgestellnummer (incl. Pruefziffer)
    "C_FG_SCHREIBEN": "sgbd-comment",                # Fahrgestellnummer schreiben / Standard Codierjob
    "FGNR_SCHREIBEN": "sgbd-comment",                # Schreiben der 17-stelligen Fahrgestellnummer inkl. PZ
    "FGNR_K_SCHREIBEN": "sgbd-comment",              # Schreiben der 7-stelligen Fahrgestellnummer
    "FAHRGESTELL_NR_SMC_SCHREIBEN": "sgbd-comment",  # Schreiben der VIN in die linke SMC

    # ALC の車台番号。**コメントは "Status von ALC schreiben" と言っていて、自分の
    # 名前と食い違う。** 決めたのは引数のほう: FGNR_ALC は "7stellige
    # Fahrgestellnummer" で、対になる FGNR_ALC_LESEN が同じものを読み返す。
    # SGBD 側のコメントの取り違えで、名前と引数が一致している側が正しい。
    "FGNR_ALC_SCHREIBEN": "sgbd-args",

    # 受注データ・ZCS（中央コーディングキー）
    "C_FA_AUFTRAG": "sgbd-comment",                  # Fahrzeugauftrag schreiben
    "C_FA_LOESCHEN": "sgbd-comment",                 # Fahrzeugauftrag Löschen
    "C_ZCS_AUFTRAG": "sgbd-comment",                 # Schreiben des Zentralen Codierschluessels in die KD-Daten
    "C_AZCS_AUFTRAG": "sgbd-comment",                # Write the Rover Additional ZCS into customer-data block

    # 製造・ディーラーデータ
    "HERSTELLDATEN_SCHREIBEN": "sgbd-comment",       # Beschreiben der Herstellerdaten
    "KFZ_DATEN_SCHREIBEN": "sgbd-comment",           # KFZ-Herstellerdaten schreiben
    "SCHEINWERFERHERSTELLERDATEN_SCHREIBEN": "sgbd-comment",  # Beschreiben der Scheinwerfer-Herstellerdaten
    "KD_DATEN_SCHREIBEN": "sgbd-comment",            # Schreiben der Kundendienst in die EWS
    "KD_POLSTER_LACK_SCHREIBEN": "sgbd-comment",     # Schreiben der Kundendienstdaten POLSTER und LACK in die EWS3
    # "Block (Codierdaten, Herstellerdanten) schreiben"。生ブロック書込で、コーディング
    # データと製造データの**両方**を名指ししている。製造データを名指ししている以上、
    # 出す先はこちら側で正しい。
    "BLOCK_SMC_ALC_SCHREIBEN": "sgbd-comment",

    # イモビライザの鍵材料
    "ISN_SCHREIBEN": "sgbd-comment",                 # Schreiben der ISN-Nummer in die EWS
    "PASSWORT_SCHREIBEN": "sgbd-comment",            # Schreiben des Passworts in die EWS
    "SCHL_DATEN_SCHREIBEN": "sgbd-comment",          # Schreiben der Schluesseldaten in die EWS
    "SCHL_SPERREN_FREIGEBEN": "sgbd-comment",        # Schluessel freischalten und sperren
    "VERRIEGELUNG_SCHREIBEN": "sgbd-comment",        # Verriegelungsbytes setzen

    # 積算距離
    "GWSZ_OFFSET_SCHREIBEN": "sgbd-comment",         # OFFSET-Wert des GWSZ in EEPROM schreiben

    # 車種。**コメントは "Umschreiben eines Bytes"（1 バイトを書き換える）としか
    # 言っていない。** 決めたのは引数で、FZG_TYP の説明が "E38 oder E39"——取れる値が
    # 他車種の名前なので、モジュールに「自分は別の車にいる」と名乗らせる書込である。
    # この車 (E46) はどちらでもない。
    "MABIKI_MODE_SCHREIBEN": "sgbd-args",
}
CLASS_PROGRAMMING = "programming"  # フラッシュ／EEPROM／検査スタンプ。WinKFP 領域
CLASS_PROTOCOL = "protocol"        # 他ジョブの手順の一部。単体では意味を持たない
# どの規則にも当たらなかった。**既定値がこれである必要がある。**
# 以前の既定は CLASS_READ で、当たらなかったジョブは「読むだけ」を名乗って出てきた。
# 3 モジュールでは当たらないジョブが 0 件だったので誰も気付かなかったが、51 では 181 件
# あり、その中には EWS の車台番号書込・コーディング書込・ASC の電磁弁ラッチ駆動が入る。
# 実車ゲート mayRun は class=='read' を最初の関門にしているので、既定が read だという
# ことは「分類できなかった」が「安全」を意味していたということ。逆でなければならない。
CLASS_UNCLASSIFIED = "unclassified"

AUD_OWNER = "owner"
AUD_TECH = "technician"
AUD_PROTOCOL = "protocol"

ACTOR_ECU = "ecu"            # ECU が自走する
ACTOR_APP = "app"            # アプリが送り続ける必要がある
ACTOR_OPERATOR = "operator"  # 人間が物理的に何かする
ACTOR_DRIVER = "driver"      # 走行が必要

TERM_SELF = "self"                    # 自分で終わる
TERM_APP_STOP = "app-stop"            # アプリが止める
TERM_COMPANION = "companion-job"      # 別名のジョブが止める
TERM_NONE = "none"                    # 止まらない（ラッチ）

DELIVER_INLINE = "inline"          # そのジョブの応答に入っている
DELIVER_COMPANION = "companion-job"  # 別ジョブで読む
DELIVER_LIVE = "live-block"        # ライブ値ブロックに現れる
DELIVER_NONE = "none"

RISK_LOW, RISK_MED, RISK_HIGH = "low", "medium", "high"


@dataclass
class JobClassification:
    cls: str
    audience: str
    system: str
    risk: str
    actor: str
    termination: str
    result_delivery: str
    kind: str                       # UI 側 OpKind
    prerequisite_jobs: list[str] = field(default_factory=list)
    stop_job: str | None = None
    # 停止が「同じジョブ＋別の引数」である場合の引数。別ジョブではない。
    stop_args: dict | None = None
    result_job: str | None = None
    ecu_timeout_sec: int | None = None
    max_hold_sec: int | None = None
    irreversible: str | None = None
    preconditions: list[str] = field(default_factory=list)
    provenance: str = "name-heuristic"
    note: str | None = None


# ---------------------------------------------------------------------------
# 系統。車のどこの話かを言えないと、323件は検索するしかない一覧になる
# ---------------------------------------------------------------------------

SYSTEMS: list[tuple[str, str]] = [
    # 故障メモリ。オーナーが最初に触るもので、`FS_LOESCHEN` は旧アプリが実車で
    # 到達できた唯一の書込でもある。系統として独立していないと 13 件が
    # 「不明」に落ちる。
    (r"^FS_|FEHLERSPEICH", "faults"),
    (r"VANOS|NOCKENWELLE|VDSV", "vanos"),
    # 気筒別噴射時間 TI1..8、噴射弁、燃料ポンプ、タンク系
    (r"^STEUERN_(EV|ZS)\d|EINSPRITZ|ZUEND|^STATUS_TI\d|TI_AUS|KRAFTSTOFF|EKP|"
     r"TANK|TEV|DMTL|LDP|SAUGSTRAHL", "fuel"),
    (r"LAMBDA|LSH[VN]|SONDE|KAT|ABGAS|SEK[_]?LUFT|SLS|SLP|SLV|AKL|KURBELGEHAEUSE", "emissions"),
    (r"DROSSEL|DKP|PEDAL|MDK|LEERLAUF|^STEUERN_LL|EGAS|WDK|PWG|LMM|LUFTTEMP", "air"),
    # 気筒別点火角 TZ1..8 はノック監視の実体（ノック遅角は点火角の後退で出る）
    (r"KLOPF|LAUFUNRUHE|^STATUS_TZ\d", "ignition"),
    (r"KUEHL|LUEFTER|THERMOSTAT|OEKV|OEL|TABG|TUMG", "cooling"),
    (r"KUPPL|SCHLEIF", "clutch"),
    # SCHALT(?!ER): SCHALTER is a SWITCH, not a gear change. The two words share five letters
    # and nothing else, and the substring match sent LSZ's STEUERN_SCHALTERSPANNUNG_BLINKER —
    # the indicator switch supply voltage — to the gearbox.
    (r"GETRIEBE|GANG|SCHALT(?!ER)|WAEHL|SMG|TESTPRG|STELLGLIED|ANSTEUERUNG", "gearbox"),
    # DSC の STEUERN_DIGITAL は 8 個の電磁弁とポンプを駆動する。SGBD テーブル
    # `STEUERN` が EVVL/AVVL/EVVR/... のビット割当を持っており、ブレーキ油圧系。
    # 機械翻訳が「デジタル」と訳して中身を隠していたのがこのジョブ。
    (r"DRUCK|BREMS|ABS|PUMPEN|ENTLUEFT|DSC_SIM|NA_", "brakes"),
    # DDS = Deflation Detection System（タイヤ空気圧警報）
    (r"^DDS|REIFEN", "tyres"),
    (r"^DSC|ASC|MSR|GIER|QUER|REGEL", "stability"),
    (r"LENKWINKEL|LWS|SERVO", "steering"),
    (r"SENSOR|GEBERRAD|TRIG|RAD|OFFSET|AQREL", "sensors"),
    (r"RELAIS|SPANNUNG|BATT|KLEMME|START|SERVOV|E_LUEFTER|KO$|IO_STATUS|UEXT|HARDWARE_STATI|"
     r"^STATUS_(DIGITAL|ANALOG|LESEN|IO_)", "electrical"),
    (r"CODIER|^COD_|IDENT|AIF|ZIF|ISN|EWS|HERSTELL|ID_|HW_|SW_|DATEN_REFERENZ|BLOCKLAENGE", "ecu"),
    (r"FLASH|SPEICHER|RAM|ROM|EEPROM|PRUEFSTEMPEL|SEED|LOGIN|DIAGNOSE|BAUDRATEN|EDIC|MCS|"
     r"^INFO|ECU_CONFIG|SYS_ADR|SG_PRUEFLAUF|SYNC|UEBERGABE", "ecu"),
    # INITIALISIER / SG_RESET / ADAPT / ABGLEICH say WHAT is being done, never to what. They
    # were in this bucket, so every module's INITIALISIERUNG came out as "engine" — true of one
    # ECU in 51, and wrong for SMG II and DSC even at three. They now fall through to the
    # module's own domain (HOME_SYSTEM). CO_EINZEL stays: CO adjustment names its subject.
    (r"CO_EINZEL", "engine"),
    # 燃料補正(ADD/INT/MUL/LFR)、充填率(RF)、負荷、車速・回転数の上限記録
    (r"MOTOR|DREHZAHL|FAHRZEUG|GESCHWIND|^STATUS_(ADD|INT|MUL|LFR|RF|LAST|VMAX|NMAX|"
     r"TNMAX|V_CAN|PUMG|DME|N_LL)", "engine"),
]


# ---------------------------------------------------------------------------
# モジュール自身の持ち場。ジョブ名が主題を言わないときの帰属先
# ---------------------------------------------------------------------------
#
# 上の SYSTEMS は「ジョブ名が何について語っているか」を読む表で、名前が何も
# 語らないジョブ——INITIALISIERUNG, STEUERN_DIGITAL, ADAPTIONSWERTE_LESEN——には
# 何も言えない。3 モジュールの間はそれが 0 件だったのではなく、engine に落ちて
# それらしく見えていた。51 モジュールでは 492 件が unknown になる。
#
# 帰属先は ECU 自身が決まれば決まる。ラジオの初期化はラジオの話で、それ以上の
# 詮索は要らない。だから表は SGBD 名で引く——アプリ側の id ではなく ECU の
# ソフトウェア自身の名前で、ダンプ一覧と 1 対 1 に突き合わせられる。
HOME_SYSTEM: dict[str, str] = {
    "MSS54DS0": "engine",
    "SMG2": "gearbox",
    "ASCMK20": "stability",
    "DSC_E46": "stability",
    "LWS5": "steering",
    "RDC": "tyres",
    # 乗員保護。ZUENDKREIS（スクイブ回路）が engine の ZUEND に当たる誤りも
    # ここで受ける——点火とスクイブは同じ語で別の物。
    "MRS3": "restraint",
    "MRS4": "restraint",
    "UEB2": "restraint",
    "EWS3": "security",
    "EWS3D": "security",
    "ZKE5": "body",
    "ZKE5_S12": "body",
    "KOMBI46": "cluster",
    "KOMBI46R": "cluster",
    "LSZ": "lighting",
    "LSZ_2": "lighting",
    "MFL": "controls",
    "MFL2": "controls",
    "SZM46": "controls",
    "AIC": "sensors",
    "RLS_DS2": "sensors",
    "ALC_DS2": "lighting",
    "XENON_L": "lighting",
    "XENON_R": "lighting",
    "CVM_II": "body",
    "IHKA46": "climate",
    "IHKA46_2": "climate",
    "IHKA46_3": "climate",
    "PDCE38": "parking",
    "PDCACT": "parking",
    "SHD46": "body",
    "SHD46_2": "body",
    "SM46_4": "seats",
    "SM46C_5": "seats",
    "B_SM46_4": "seats",
    "SPM46FT": "seats",
    "SPM46BT": "seats",
    "RADIO": "av",
    "BMBT46RN": "av",
    "BMBT46TN": "av",
    "BMBT_MIR": "av",
    "BM46WIDE": "av",
    "CDC_46": "av",
    "NAVMK3": "av",
    "NAVMK4": "av",
    "NAVMK4_2": "av",
    "NAV_JAP": "av",
    "SES": "av",
    "TELEFON": "av",
    "VIDEOMOD": "av",
}

# ブレーキ油圧のモジュレータを駆動するのはこの2つの ECU だけ。他の12モジュールの
# STEUERN_DIGITAL は名前が同じだけの汎用デジタル出力で、ブレーキとは関係が無い。
# 規則ではなく所属で決まる事実なので、パターン表から出してここに置く。
BRAKE_MODULATORS = {"DSC_E46", "ASCMK20"}


def system_of(job: str, sgbd: str | None = None) -> str:
    if sgbd in BRAKE_MODULATORS and job.upper().startswith("STEUERN_DIGITAL"):
        return "brakes"
    for pat, sys_ in SYSTEMS:
        if re.search(pat, job, re.I):
            return sys_
    # 名前が主題を言わないジョブは、そのモジュールの持ち場のもの。表に無い SGBD だけが
    # unknown になる——つまり unknown は「分類できなかった」ではなく「表に足し忘れた」
    # を意味するようになり、検査が直せる指摘を出せる。
    return HOME_SYSTEM.get(sgbd or "", "unknown")


# ---------------------------------------------------------------------------
# 個別上書き。パターンで直らないもの
# ---------------------------------------------------------------------------

OVERRIDES: dict[str, dict] = {
    # ------------------------------------------------------------------
    #  前身の表が cat="adapt"（永続書込）と言い、この分類器が class="test",
    #  kind="pulse"（一時的、終われば戻る）と言っていた 9 件。SGBD に聞いた。
    #
    #  どれも「永続」「一時的」とは書いていない。書いていないことを認めた上で、
    #  6 件は書かれている内容が保存された状態についてしか意味を成さない。
    #  RADIO が自分で物差しを出しているのが決め手だった: STEUERN_RADIO_SCHALTEN の
    #  コメントだけが "$07 inputOutputControlParameter - ShortTermAdjustment" と
    #  書いており、RADIO.json 全体で "ShortTerm" はその 1 箇所しかない。この SGBD は
    #  短時間のときは短時間と書く。下の 5 件には書いていない。
    #
    #  名前はどれも 1 つの SGBD にしか無い（実測）ので、名前キーで安全に効く。
    #
    #  provenance は書いていない。_apply_override が override を当てたものを一律
    #  "authored" にするからで、それがこの 9 件については正しい——SGBD は永続性を
    #  明言していない。述べられていることから人が判断した、と名乗るのが正確である。
    # ------------------------------------------------------------------

    # UEB2。"Transportsicherung setzen" / "entfernen" で、状態は
    # STATUS_TRANSPORTSICHERUNG_LESEN の STAT_TRANSPORTSICHERUNG_EIN
    # （"1, wenn Transportsicherung gesetzt, sonst 0"）で読み戻せる。あとから読める値は、
    # ジョブが終わった時点で戻ってはいない。
    #
    # risk=high なのは、掛かっている間ロールオーバー保護が働かないため。これを
    # 「一時的な作動テスト」として出していたのが元の状態だった。
    "STEUERN_TRANSPORTSICHERUNG_AN": dict(
        cls=CLASS_CALIBRATION, kind="write", audience=AUD_TECH, risk=RISK_HIGH,
        actor=ACTOR_APP, termination=TERM_COMPANION, stop_job="STEUERN_TRANSPORTSICHERUNG_AUS",
        preconditions=["voltage_ok", "stationary"]),
    "STEUERN_TRANSPORTSICHERUNG_AUS": dict(
        cls=CLASS_CALIBRATION, kind="write", audience=AUD_TECH, risk=RISK_HIGH,
        actor=ACTOR_APP, termination=TERM_COMPANION, stop_job="STEUERN_TRANSPORTSICHERUNG_AN",
        preconditions=["voltage_ok", "stationary"]),

    # EWS3 のみ（実測: 1 SGBD）。"SK in das EWS4.3 Steuergeraet schreiben" で、
    # 引数は MODE = WRITE_SERVER_SK / LOCK_SERVER_SK、DATA = 16 バイトの SecretKey。
    # イモビライザの秘密鍵を書き込む、あるいは**恒久的にロックする**。
    # `STEUERN_` という接頭辞のせいで `test / owner / pulse`（一時的に動かす）として
    # 出ていた。名前が嘘をついている 2 件目。
    "STEUERN_EWS4_SK": dict(
        cls=CLASS_IDENTITY, kind="write", audience=AUD_TECH, risk=RISK_HIGH,
        irreversible="irr_write", preconditions=["voltage_ok", "engine_off"],
        provenance="sgbd-comment"),

    # NAVMK4_2 のみ（実測: 1 SGBD）。"Flottenmodus Status"、引数 BYTE1 は 0x00-0x02。
    # 3 値のモード設定で、`STATUS_FLOTTENMODUS` が読み返せる——あとから読める値は、
    # ジョブが終わった時点で戻ってはいない。UEB2 の輸送ロックと同じ形。
    "STEUERN_FLOTTENMODUS": dict(
        cls=CLASS_CALIBRATION, kind="write", audience=AUD_TECH, risk=RISK_HIGH,
        irreversible="irr_write", preconditions=["voltage_ok"],
        # SGBD は 3 値のモードだと述べているが、**残るとは述べていない**。
        # 残ると読んだのは STATUS_FLOTTENMODUS が読み返せるからで、そこは我々の推論。
        provenance="authored"),

    # UEB2 のロールオーバーバー。"Ausfahren des Buegels"——出す方向だけ。32 ジョブを
    # 全部読んで、戻すジョブは無い（zurueck / RESET / einfahr / retract のいずれも 0 件）。
    # SGBD は戻し方について何も述べていない。その沈黙が事実なので、irr_latching
    # （イグニッションサイクルで戻る、と主張する）は使えない。
    "STEUERN_BUEGEL": dict(
        risk=RISK_HIGH, irreversible="irr_no_counterpart", audience=AUD_TECH,
        preconditions=["voltage_ok", "stationary"]),

    # RADIO。値を「増やす/減らす」と書いてあり、その値は STATUS_LESEN が
    # STAT_GAL_KURVE / STAT_VF_LAUT_WERT として設定値の形で報告する。
    "STEUERN_GAL_INK": dict(cls=CLASS_CALIBRATION, kind="write", audience=AUD_TECH,
                            termination=TERM_COMPANION, stop_job="STEUERN_GAL_DEK"),
    "STEUERN_GAL_DEK": dict(cls=CLASS_CALIBRATION, kind="write", audience=AUD_TECH,
                            termination=TERM_COMPANION, stop_job="STEUERN_GAL_INK"),
    "STEUERN_VF_INK": dict(cls=CLASS_CALIBRATION, kind="write", audience=AUD_TECH,
                           termination=TERM_COMPANION, stop_job="STEUERN_VF_DEK"),
    "STEUERN_VF_DEK": dict(cls=CLASS_CALIBRATION, kind="write", audience=AUD_TECH,
                           termination=TERM_COMPANION, stop_job="STEUERN_VF_INK"),

    # "Balance, Fader und Volume Defaulteinstellung"。既定値に戻す＝それまでの値は
    # 失われる。戻す相手のジョブは無い。
    "STEUERN_DEFAULT_SOUND": dict(cls=CLASS_CALIBRATION, kind="write", audience=AUD_TECH,
                                  risk=RISK_HIGH, irreversible="irr_write"),

    # SHD46_2。EIN と AUS の**コメントが一字一句同じ**（"SG Autoinit durchführen"）。
    # SGBD は 2 つの違いを述べていないので、どちらが何をするか言えない。言えないことを
    # 言わないのが unclassified の意味で、EIN/AUS という名前から意味を作らない。
    "STEUERN_AUTO_INIT_EIN": dict(cls=CLASS_UNCLASSIFIED, kind="unknown", audience=AUD_TECH,
                                  risk=RISK_HIGH),
    "STEUERN_AUTO_INIT_AUS": dict(cls=CLASS_UNCLASSIFIED, kind="unknown", audience=AUD_TECH,
                                  risk=RISK_HIGH),

    # 検査スタンプ書込。名前が `_SCHREIBEN` なので較正に見えるが、同じ操作が
    # `PRUEFSTEMPEL_SCHREIBEN` という名でも存在し、そちらは除外されていた。
    # 片方だけ露出しているのは分類ではなく事故。
    "ID_SCHREIBEN": dict(cls=CLASS_PROGRAMMING, audience=AUD_TECH,
                         note="Beschreiben des Pruefstempels"),
    # 較正のためのセッション解錠。それ自体は何も較正しない。
    "ABGLEICH_LOGIN_REQUEST": dict(cls=CLASS_PROTOCOL, audience=AUD_PROTOCOL,
                                   kind="read", risk=RISK_MED),
    # 「駆動して保持」。SGBD に解除ジョブが無い。
    "ENTLUEFTUNG_SERVICE": dict(cls=CLASS_TEST, audience=AUD_TECH),
    # RAM に書いてから EEPROM へ移す2段構え。3件目だけが不可逆。
    "CO_EINZELABGLEICH_LESEN": dict(cls=CLASS_READ, audience=AUD_TECH, kind="read", risk=RISK_LOW),
    "CO_EINZELABGLEICH_VERSTELLEN": dict(cls=CLASS_CALIBRATION, audience=AUD_TECH, kind="write",
                                         risk=RISK_MED,
                                         note="RAM only; not persisted until PROGRAMMIEREN"),
    "CO_EINZELABGLEICH_PROGRAMMIEREN": dict(cls=CLASS_PROGRAMMING, audience=AUD_TECH, kind="write",
                                            risk=RISK_HIGH, irreversible="irr_eeprom",
                                            note="von RAM ins EEPROM schreiben"),
    # リンク自身のボーレートを変える。セッションが壊れる。
    "BAUDRATEN_UMSTELLUNG": dict(cls=CLASS_PROGRAMMING, audience=AUD_PROTOCOL, kind="write",
                                 risk=RISK_HIGH,
                                 note="changes the link's own baud rate mid-session"),
    "SET_EDIC_BAUDRATE": dict(cls=CLASS_PROGRAMMING, audience=AUD_PROTOCOL, kind="write",
                              risk=RISK_HIGH,
                              note="changes the link's own baud rate mid-session"),
    # 識別データ読取。3モジュールとも同名で、名前からは読取と分からない。
    "IDENT": dict(cls=CLASS_READ, audience=AUD_OWNER, kind="read", risk=RISK_LOW),
    "ZIF": dict(cls=CLASS_READ, audience=AUD_TECH, kind="read", risk=RISK_LOW),
    # EWS3 = イモビライザ。同期は車両の始動可否に直結する。
    "EWS3_GET_STATUS": dict(cls=CLASS_READ, audience=AUD_TECH, kind="read", risk=RISK_LOW),
    "EWS3_INITIALISIEREN": dict(cls=CLASS_CALIBRATION, audience=AUD_TECH, kind="write",
                                risk=RISK_HIGH, irreversible="irr_write",
                                note="immobiliser sync; a failure can leave the car unable to start"),
    "EWS3_SYNC": dict(cls=CLASS_CALIBRATION, audience=AUD_TECH, kind="write",
                      risk=RISK_HIGH, irreversible="irr_write"),
    # メーカー自己診断ルーチンの呼び出し。何が動くか SGBD は言っていない。
    "HERSTELLER_SELBSTTEST": dict(cls=CLASS_TEST, audience=AUD_TECH, kind="pulse", risk=RISK_HIGH,
                                  note="manufacturer-specific routine; the SGBD does not say what it runs"),
    # 故障メモリの NVRAM 消去。FS_LOESCHEN より強い。
    "FS_INIT": dict(cls=CLASS_CALIBRATION, audience=AUD_TECH, kind="write", risk=RISK_HIGH,
                    irreversible="irr_write", note="Fehlerspeicher initialisieren NVRAM-Loeschen"),
    "DDS_EOL_PASSIV": dict(cls=CLASS_CALIBRATION, audience=AUD_TECH, kind="write", risk=RISK_HIGH,
                           irreversible="irr_write",
                           note="tyre-pressure end-of-line state; the SGBD comment is empty"),
}

# 手順の一部でしかないジョブ。オーナーの一覧に出すと、実行できないものが並ぶ。
PROTOCOL_JOBS = re.compile(
    r"^(SEED_KEY|LOGIN_REQUEST|LOGIN_DSC|MCS_AKTIVIEREN|DIAGNOSE_|BLOCKLAENGE|"
    r"DATEN_REFERENZ|HW_REFERENZ|INFO$|INFO_|TELEGRAMM)", re.I
)

# SYSTEMCHECK: 開始 → 別ジョブで結果読取。OpKind の 'deferred'。
# 対応は一様ではない — START_SYSTEMCHECK_DMTL_ECOS に読み手は無く、
# LESEN_SYSTEMCHECK_LAUFUNRUHE に開始役は無い。表で持つしかない。
SYSTEMCHECK_PAIRS: dict[str, str] = {
    "START_SYSTEMCHECK_SEK_LUFT": "LESEN_SYSTEMCHECK_SEK_LUFT",
    "START_SYSTEMCHECK_TANK_LECK": "LESEN_SYSTEMCHECK_TANK_LECK",
    "START_SYSTEMCHECK_DMTL": "LESEN_SYSTEMCHECK_DMTL",
    "START_SYSTEMCHECK_TEV_FUNC": "LESEN_SYSTEMCHECK_TEV_FUNC",
}

# 開始と停止が別名のジョブ
PAIRS: dict[str, str] = {
    "STEUERN_EKP": "STEUERN_EKP_AUS",
    "STEUERN_EKP_AUS": "STEUERN_EKP",
    "STEUERN_TI_ABGLEICH_STARTEN": "STEUERN_TI_ABGLEICH_STOPPEN",
    "STEUERN_TI_ABGLEICH_STOPPEN": "STEUERN_TI_ABGLEICH_STARTEN",
    "TESTPRG_STARTEN": "TESTPRG_STOP",
    "TESTPRG_STOP": "TESTPRG_STARTEN",
    "START_SYSTEMCHECK_SEK_LUFT": "STOP_SYSTEMCHECK_SEK_LUFT",
    "STOP_SYSTEMCHECK_SEK_LUFT": "START_SYSTEMCHECK_SEK_LUFT",
}

SMG2_ECU_TIMEOUT_SEC = 10
SMG2_MAX_HOLD_SEC = 60


# ジョブが「何かを起こす」と SGBD 自身が述べている語。
#
# 名前より強い。名前は BMW の命名規約で、規約はときどき守られていない——MSS54 の
# STATUS_TANK_DICHTHEIT はコメントが "Tankleckpruefung mit DMTL anstossen"（DMTL で
# タンク漏れ検査を起動）で、生成される英文も "Start fuel tank leak test with DMTL" な
# のに、名前が STATUS_ で始まるという理由だけで読取に分類されていた。
#
# 下の「測定の起動」「単発作動」の分岐が同じ語を見ているが、そこへ到達する前に読取
# 分岐が return してしまう。ECU 自身の説明を、我々の名前の読み方より下に置かない。
_ACTUATION_VERB = re.compile(
    "anstossen|" + chr(97) + "nstoßen|durchfuehren|durchführen|ansteuern|starten|"
    "ausloesen|auslösen|einleiten|aktivieren", re.I)


def describes_actuation(comment: str) -> bool:
    """SGBD のコメントが、このジョブは何かを起こすと述べているか。

    51 モジュール実測で該当は 3 件——MSS54 の STATUS_TANK_DICHTHEIT と、ミラー記憶
    2 モジュールの SPEICHER_LESEN（"Ansteuern von Funktionen des Steuergeraetes"）。
    少数だが 1 件目は実車ゲート mayRun の第 1 層を通り、引数を取らないので制御バイト
    検査まで到達する形をしている。"""
    return bool(_ACTUATION_VERB.search(comment or ""))


# 「書込アクセス」と自分で述べているジョブ。**名前が何と言っていても書込である。**
#
# 実測: 全 63 SGBD・1,524 ジョブのうち該当は 2 件で、どちらも EWS の
# `STEUERN_SELBSTTEST`——名前は「自己診断」、コメントは
# `Schreibzugriff auf den Transponder via EWS-SG`（EWS を通した**トランスポンダへの
# 書込アクセス**）、引数は BLOCK(0-7) / POSITION(0-15) / DATENBYTE。鍵の中の
# トランスポンダの任意のバイトを書き換える。
#
# `STEUERN_` で始まるので、名前だけを見る規則はこれを
# `test / owner / pulse`——「一時的に動かして確かめる。終われば元に戻る」——として
# 出していた。**終わりも戻りも無い。**
#
# 名前キーの上書きでは直せない: `STEUERN_SELBSTTEST` は 8 つの SGBD にあり、
# KOMBI46 / NAVMK3 / NAVMK4 / NAVMK4_2 / VIDEOMOD の 5 つでは本当に自己診断である
# （"SG - Selbsttest ausloesen" / "Selbsttest Navigationsrechner"）。同じ名前で違う
# ものを名前で直すと、直っていない側が黙って壊れる。だからコメントで判定する。
#
# これは describes_actuation の鏡である: あちらは「読取と名乗っているが起こすと
# 書いてある」、こちらは「試験と名乗っているが書き込むと書いてある」。どちらも
# **SGBD の本文が名前に勝つ**という同じ規則。
_WRITE_ACCESS = re.compile(r"schreibzugriff", re.I)


def describes_write(comment: str) -> bool:
    """SGBD のコメントが、このジョブは書き込むと述べているか。"""
    return bool(_WRITE_ACCESS.search(comment or ""))


def classify(sgbd: str, job: str, comment: str, args: list[str]) -> JobClassification:
    """1ジョブを分類する。`args` は引数名の大文字リスト。"""
    n = job.upper()
    de = (comment or "").lower()
    argset = {a.upper() for a in args}

    c = JobClassification(
        # 既定は「分類できていない」。当たった規則だけが read を名乗れる——CLASS_UNCLASSIFIED
        # の注記を参照。audience も technician 側に置く: 何をするか言えないものを
        # オーナー向けの一覧に出さない。
        cls=CLASS_UNCLASSIFIED, audience=AUD_TECH, system=system_of(n, sgbd), risk=RISK_MED,
        actor=ACTOR_ECU, termination=TERM_SELF, result_delivery=DELIVER_INLINE,
        kind="unknown",
    )

    # --- EDIABAS が自分で呼ぶ初期化 ---------------------------------------
    #
    # 全 51 SGBD にあり、全部が calibration / owner / write / high / irr_write で
    # 出ていた——`^INITIALISIER` の名前規則から。つまり 51 のモジュールすべてで
    # 「学習値を永久に書き換え、元に戻せない」とオーナーに表示していた。
    #
    # SGBD 自身の記述はその逆で、ZKE5_S12 が逐語でこう述べている:
    #
    #   "Dieser Job wird vom EDIABAS automatisch beim erstem Zugriff auf eine SGBD
    #    aufgerufen. Bei weiteren Zugriffen auf die selbe SGBD wird dieser Job nicht
    #    mehr aufgerufen. ... Hier: 1. Verbindung zum Interface aufbauen
    #    2. Setzen des Wiederholungszaehlers fuer Fehler (gleich 2)
    #    3. Setzen der SG-Kommunikationsparameter"
    #
    # ——EDIABAS が SGBD への最初のアクセス時に自分で呼ぶ。やることはインタフェース
    # 接続・リトライ回数・通信パラメータの設定。実測: 51 の SGBD にある 26 通りの
    # 文面のうち、schreiben / speichern / Adaption / loeschen / EEPROM のいずれかを
    # 含むものは 0。引数もどれ 1 つ取らない。
    #
    # 名前が INITIALISIER で始まる別のジョブ（EWS3_INITIALISIEREN 等）は当たらない。
    # ここは完全一致で、それらは自分の分岐と override を持っている。
    if n == "INITIALISIERUNG":
        c.cls, c.audience, c.kind, c.risk = CLASS_PROTOCOL, AUD_PROTOCOL, "read", RISK_LOW
        c.provenance = "sgbd-comment"
        return _apply_override(n, c, argset, de)

    # --- 自分で「書込アクセス」と述べているもの ---------------------------
    # 名前より本文。EWS の鍵トランスポンダへの書込が `STEUERN_SELBSTTEST` という名前で
    # 出ていた件（describes_write の注記）。書く先が鍵の中身なので identity。
    if describes_write(de):
        c.cls, c.kind, c.audience, c.risk = CLASS_IDENTITY, "write", AUD_TECH, RISK_HIGH
        c.irreversible = "irr_write"
        c.preconditions = ["voltage_ok", "engine_off"]
        c.provenance = "sgbd-comment"
        return _apply_override(n, c, argset, de)

    # --- プロトコル部品 ---------------------------------------------------
    if PROTOCOL_JOBS.match(n):
        c.cls, c.audience, c.kind, c.risk = CLASS_PROTOCOL, AUD_PROTOCOL, "read", RISK_LOW
        c.provenance = "name-heuristic"
        return _apply_override(n, c, argset, de)

    # --- 書換系（WinKFP 領域）---------------------------------------------
    # `_LESEN` を除く。`PRUEFSTEMPEL_LESEN` は SGBD 自身が
    # `Auslesen des Pruefstempels`（＝読み出し）と述べているのに、接頭辞だけで
    # 判定していたため3モジュールすべてで「不可逆な書込」になっていた。
    # 読取に不可逆マークが付くのは、それ自体が分類の誤りである。
    if re.match(r"^(FLASH|SPEICHER_SCHREIBEN|AIF_SCHREIBEN|PRUEFSTEMPEL|ZIF_BACKUP)", n) \
            and not re.search(r"_LESEN(_|$)", n):
        c.cls, c.audience, c.kind, c.risk = CLASS_PROGRAMMING, AUD_TECH, "write", RISK_HIGH
        c.irreversible = "irr_write"
        return _apply_override(n, c, argset, de)

    # --- 故障メモリ。オーナーの入口なので専用に扱う ------------------------
    if n.startswith("FS_"):
        if "LOESCHEN" in n:
            # 消去は書込。旧アプリが実車で到達できた唯一の書込がこれで、
            # 確認モーダルだけで verified ゲートも try/catch も無かった。
            c.cls, c.kind, c.audience, c.risk = CLASS_CALIBRATION, "write", AUD_OWNER, RISK_HIGH
            c.irreversible = "irr_write"
            c.preconditions = ["voltage_ok"]
        else:
            c.cls, c.kind, c.audience, c.risk = CLASS_READ, "read", AUD_OWNER, RISK_LOW
        return _apply_override(n, c, argset, de)

    # --- 読取 --------------------------------------------------------------
    # `_LESEN$` だけでは `FS_LESEN_TEXT` / `FS_LESEN_KB90` を取り逃がす。
    # 語尾ではなく語として見る。
    # SGBD 自身が「起こす」と述べているものは読取ではない。名前ではなく説明を採り、
    # 下の分岐に落とす（describes_actuation 参照）。
    if (re.search(r"_LESEN(_|$)|^STATUS|^LESEN_|^SYS_ADR|^ECU_CONFIG$|^ABGAS_VARIANTE", n)
            and not describes_actuation(de)):
        c.cls, c.kind, c.risk = CLASS_READ, "read", RISK_LOW
        c.audience = AUD_TECH if n.startswith("STATUS") else AUD_OWNER
        # SYSTEMCHECK の読み手は「別ジョブが始めた試験の結果」を返す
        if "SYSTEMCHECK" in n:
            c.audience = AUD_OWNER
            c.result_delivery = DELIVER_INLINE
        return _apply_override(n, c, argset, de)

    # --- SYSTEMCHECK 開始: 開始 → 別ジョブで結果 ---------------------------
    if n.startswith("START_SYSTEMCHECK"):
        c.cls, c.kind, c.audience, c.risk = CLASS_TEST, "deferred", AUD_OWNER, RISK_MED
        c.actor, c.termination, c.result_delivery = ACTOR_ECU, TERM_SELF, DELIVER_COMPANION
        c.result_job = SYSTEMCHECK_PAIRS.get(n)
        c.stop_job = PAIRS.get(n)
        if c.stop_job:
            c.termination = TERM_COMPANION
        c.preconditions = ["voltage_ok"]
        return _apply_override(n, c, argset, de)
    if n.startswith("STOP_SYSTEMCHECK"):
        c.cls, c.kind, c.audience, c.risk = CLASS_TEST, "pulse", AUD_OWNER, RISK_LOW
        c.stop_job = PAIRS.get(n)
        return _apply_override(n, c, argset, de)

    # --- SMG II 試験プログラム --------------------------------------------
    if n == "TESTPRG_STARTEN":
        c.cls, c.kind, c.audience, c.risk = CLASS_CALIBRATION, "procedure", AUD_OWNER, RISK_HIGH
        c.actor, c.termination, c.result_delivery = ACTOR_ECU, TERM_COMPANION, DELIVER_INLINE
        c.stop_job = "TESTPRG_STOP"
        # **進行状況はこのジョブ自身を再送して読む。** 以前ここには
        # `STATUS_TESTPRG` と書いてあったが、そんなジョブは SMG II の46件に
        # 存在しない。SGBD が `TEST_STATUS_BYTE` のコメントで明言している:
        #   「Job muss kontinuierlich angestossen werden ...
        #     Job solange anstossen, bis dieses Result ungleich 1 liefert!」
        # INPA の SMG2.IPO も同じで、TESTPRG_STOP → TESTPRG_STARTEN と送った後、
        # TESTPRG_STARTEN を再送して TEST_STATUS_BYTE / TEST_STATUS /
        # INFO_STATUS / STAT_INFO_STATUS2_WERT を読み続けている。
        c.result_job = "TESTPRG_STARTEN"
        c.prerequisite_jobs = ["TESTPRG_STOP"]
        c.ecu_timeout_sec = SMG2_ECU_TIMEOUT_SEC
        c.preconditions = ["voltage_ok", "stationary"]
        c.provenance = "sgbd-comment"
        return _apply_override(n, c, argset, de)
    if n == "TESTPRG_STOP":
        c.cls, c.kind, c.audience, c.risk = CLASS_TEST, "pulse", AUD_OWNER, RISK_LOW
        c.stop_job = "TESTPRG_STARTEN"
        return _apply_override(n, c, argset, de)

    # --- SMG II アクチュエータ（前段ジョブが必須と SGBD が明言）------------
    if sgbd.upper() == "SMG2" and n == "STEUERN_STELLGLIED":
        c.cls, c.kind, c.audience, c.risk = CLASS_TEST, "hold", AUD_TECH, RISK_HIGH
        c.actor, c.termination = ACTOR_APP, TERM_APP_STOP
        c.prerequisite_jobs = ["ANSTEUERUNG_VORBEREITEN"]
        # 停止は**同じジョブに別の引数を渡す**ことであって、別ジョブではない。
        # `INAKTIV` は `STEUERART1` の値の一つ（SGBD 逐語:
        # `Argument Steuerungsart: POSITIONSVORGABE / STROMVORGABE / INAKTIV /
        # AKTIV`）。INPA も `STEUERN_STELLGLIED(HYDROPUMPE, INAKTIV)` で
        # 油圧ポンプを止めている。ジョブ名として出すと、存在しないジョブを
        # 名指しすることになる。
        c.stop_job = job
        c.stop_args = {"STEUERART1": "INAKTIV"}
        c.ecu_timeout_sec, c.max_hold_sec = SMG2_ECU_TIMEOUT_SEC, SMG2_MAX_HOLD_SEC
        c.preconditions = ["voltage_ok", "stationary"]
        c.provenance = "sgbd-comment"
        return _apply_override(n, c, argset, de)
    if n == "ANSTEUERUNG_VORBEREITEN":
        c.cls, c.kind, c.audience, c.risk = CLASS_PROTOCOL, "pulse", AUD_PROTOCOL, RISK_LOW
        c.provenance = "sgbd-comment"
        return _apply_override(n, c, argset, de)

    # --- ラッチ: 作動して保持、解除ジョブ無し ------------------------------
    # ASCMK20 は同じ物を ASC_SIM_ と呼ぶ。ECU 自身のコメントが
    # "Steuern_Digital ansteueren u. halten"（駆動して保持）で、DSC_SIM_ と同じ
    # ラッチ動作。名前だけが違うものを別扱いにすると、前期車でだけ電磁弁が
    # 「読取」として出てくる。
    if n.startswith(("DSC_SIM_", "ASC_SIM_")):
        c.cls, c.kind, c.audience, c.risk = CLASS_TEST, "latching", AUD_TECH, RISK_HIGH
        c.actor, c.termination, c.result_delivery = ACTOR_ECU, TERM_NONE, DELIVER_NONE
        c.irreversible = "irr_latching"
        c.preconditions = ["voltage_ok", "stationary"]
        c.provenance = "sgbd-comment"
        return _apply_override(n, c, argset, de)

    # --- DSC 油圧: ブレーキモジュレータを駆動する --------------------------
    if re.match(r"^(DRUCKABBAU|DRUCKAUFBAU|DRUCKHALTEN|PUMPENFOERDERLEISTUNG|"
                r"ABS_REGELSIMULATION|NA_ENTLUEFTUNG|ENTLUEFTUNG_SERVICE)", n):
        c.cls, c.kind, c.audience, c.risk = CLASS_TEST, "compound", AUD_TECH, RISK_HIGH
        c.actor, c.termination = ACTOR_ECU, TERM_SELF
        c.preconditions = ["voltage_ok", "stationary"]
        c.provenance = "sgbd-comment"
        return _apply_override(n, c, argset, de)

    # --- コーディング ------------------------------------------------------
    if re.match(r"^(CODIERDATEN|CODIER|COD_)", n):
        write = "_SCHREIBEN" in n
        c.cls = CLASS_CODING if write else CLASS_READ
        c.kind = "write" if write else "read"
        c.audience, c.risk = AUD_TECH, RISK_HIGH if write else RISK_LOW
        if write:
            c.irreversible = "irr_write"
            c.preconditions = ["voltage_ok", "engine_off"]
        return _apply_override(n, c, argset, de)

    # --- 生メモリの読み書き。WinKFP 領域 ------------------------------------
    # `SPEICHER_SCHREIBEN` は上の書換系分岐で既に programming になっているのに、
    # `SPEICHER_LOESCHEN` は下の総称規則で calibration になっていた。同じ領域を
    # 触る対の片方だけが「学習値の書換」を名乗るのは、単に食い違いである。
    if re.match(r"^(EEPROM|RAM)_SCHREIBEN$|^SPEICHER_LOESCHEN$|^QUICK_ERASE$|"
                r"^(SET|REMOVE)_NO_SAVE_NVR$", n):
        c.cls, c.kind, c.audience, c.risk = CLASS_PROGRAMMING, "write", AUD_TECH, RISK_HIGH
        c.irreversible = "irr_eeprom"
        c.preconditions = ["voltage_ok", "engine_off"]
        return _apply_override(n, c, argset, de)

    # --- 車両の同一性 -------------------------------------------------------
    # 名前ではなく **SGBD のコメントで裏を取った 24 件**。表に原文を併記してあるのは、
    # 次にこれを触る人が「なぜこの名前がここにあるか」を repo の中だけで確かめられる
    # ようにするため。総称の正規表現で書くと、名前が似ているだけの別物を巻き込む——
    # 実際、最初に正規表現で書いたときは C_C_* / C_S_*（コーディングデータ）と
    # C_FS_LOESCHEN（エアバッグのクラッシュ記録）を巻き込んでいた。
    if n in IDENTITY_JOBS:
        c.cls, c.kind, c.audience, c.risk = CLASS_IDENTITY, "write", AUD_TECH, RISK_HIGH
        c.irreversible = "irr_write"
        c.preconditions = ["voltage_ok", "engine_off"]
        c.provenance = IDENTITY_JOBS[n]
        return _apply_override(n, c, argset, de)

    # --- コーディングデータ（`C_C_*` / `C_S_*`）-----------------------------
    # 名前は上の同一性の族とそっくりだが、SGBD の言うことが違う:
    #   C_C_AUFTRAG    "Codierdaten schreiben und verifizieren"
    #   C_C_SCHREIBEN  "Codierdaten schreiben ohne Verifikation"
    #   C_S_AUFTRAG    "Codierdaten schreiben und verifizieren"
    # 装備構成の書換なので coding。`^(CODIERDATEN|CODIER|COD_)` の分岐はこの綴りを
    # 拾わないので、ここで受ける（拾わなかった結果、以前は unclassified だった）。
    if re.match(r"^C_[CS]_(AUFTRAG|SCHREIBEN)$", n):
        c.cls, c.kind, c.audience, c.risk = CLASS_CODING, "write", AUD_TECH, RISK_HIGH
        c.irreversible = "irr_write"
        c.preconditions = ["voltage_ok", "engine_off"]
        c.provenance = "sgbd-comment"
        return _apply_override(n, c, argset, de)

    # --- エアバッグのクラッシュ記録の消去 -----------------------------------
    # MRS の `C_FS_LOESCHEN` は "Crashtelegram loeschen"。名前が `C_F*_LOESCHEN` の
    # 形をしているので同一性の族に見えるが、消えるのは車台番号ではなく**衝突の記録**
    # である。学習値でも装備構成でもないので、総称の書換（calibration）に置いたうえで
    # 整備者向けにする。文面は cautions.py が持つ。
    if n == "C_FS_LOESCHEN":
        c.cls, c.kind, c.audience, c.risk = CLASS_CALIBRATION, "write", AUD_TECH, RISK_HIGH
        c.irreversible = "irr_write"
        c.preconditions = ["voltage_ok", "engine_off"]
        c.provenance = "sgbd-comment"
        return _apply_override(n, c, argset, de)

    # --- 較正・適応の書換 ---------------------------------------------------
    if re.search(r"_SCHREIBEN$|_LOESCHEN$|^SG_RESET$|^EDIC_RESET$|^DDS_RESET$|"
                 r"^INITIALISIER|^ADAPT|^ABGLEICH|ABGLEICHEN$|^TRIG_SCHREIBEN$", n):
        c.cls, c.kind, c.audience, c.risk = CLASS_CALIBRATION, "write", AUD_OWNER, RISK_HIGH
        c.irreversible = "irr_write"
        c.preconditions = ["voltage_ok", "stationary"]
        if re.search(r"_SCHREIBEN$|^SG_RESET$", n):
            c.preconditions.append("engine_off")
        return _apply_override(n, c, argset, de)

    # --- I/O ピン直接駆動 ---------------------------------------------------
    #
    # 実測: 全 63 SGBD で `PIN_NUMMER` を取るジョブは 1 つだけ——MSS54 の
    # `IO_STATUS_VORGEBEN`（`direkte Stellgliedansteuerung ueber Pin/Tastv./Periode`）。
    if "PIN_NUMMER" in argset:
        c.cls, c.kind, c.audience, c.risk = CLASS_TEST, "hold", AUD_TECH, RISK_HIGH
        c.actor, c.termination = ACTOR_APP, TERM_APP_STOP
        c.stop_job, c.irreversible = job, "irr_pin"
        # **止め方は SGBD が引数の説明に書いている。**
        #
        #   TASTVERHAELTNIS: "00 Stellglied nicht angesteuert, ff staendig angesteuert"
        #
        # デューティ 0 が「駆動しない」。停止は別ジョブではなく、同じジョブを
        # デューティ 0 で送り直すこと——SMG2 の `STEUERN_STELLGLIED` に
        # `{STEUERART1: INAKTIV}` を渡すのと同じ形である。
        #
        # 部分上書きであることが重要: `PERIODENDAUER` は "00 ungueltig"（0 は不正）
        # なので、停止フレームは操作者が選んだ周期をそのまま持っていく必要がある。
        # ここで全引数を指定すると、不正な周期を送ることになる。
        if "TASTVERHAELTNIS" in argset:
            c.stop_args = {"TASTVERHAELTNIS": "0"}
        c.preconditions = ["voltage_ok", "stationary"]
        c.provenance = "sgbd-comment"
        return _apply_override(n, c, argset, de)

    # --- ON/OFF 引数を持つ保持型 -------------------------------------------
    if "SCHALTEN" in argset:
        c.cls, c.kind, c.audience = CLASS_TEST, "hold", AUD_OWNER
        c.actor, c.termination, c.stop_job = ACTOR_APP, TERM_APP_STOP, job
        c.preconditions = ["voltage_ok"]
        c.provenance = "sgbd-comment"
        return _apply_override(n, c, argset, de)

    # --- 対ジョブ ----------------------------------------------------------
    if n in PAIRS:
        c.cls, c.kind, c.audience = CLASS_TEST, "paired", AUD_OWNER
        c.actor, c.termination, c.stop_job = ACTOR_APP, TERM_COMPANION, PAIRS[n]
        c.preconditions = ["voltage_ok"]
        c.provenance = "sgbd-comment"
        return _apply_override(n, c, argset, de)

    # --- 測定の起動: 「anstossen」= 起動して ECU が最後までやる -------------
    if "anstossen" in de or "durchfuehren" in de or "prueflauf" in de:
        c.cls, c.kind, c.audience = CLASS_TEST, "measurement", AUD_OWNER
        c.actor, c.termination, c.result_delivery = ACTOR_ECU, TERM_SELF, DELIVER_LIVE
        c.preconditions = ["voltage_ok"]
        c.provenance = "sgbd-comment"
        return _apply_override(n, c, argset, de)

    # --- 単発作動 ----------------------------------------------------------
    if n.startswith("STEUERN") or "ansteuern" in de or "anfahren" in de:
        c.cls, c.kind, c.audience = CLASS_TEST, "pulse", AUD_OWNER
        c.actor, c.termination = ACTOR_ECU, TERM_SELF
        c.preconditions = ["voltage_ok"]
        c.provenance = "sgbd-comment" if de else "name-heuristic"
        return _apply_override(n, c, argset, de)

    # --- ここに来たものは SGBD が何も言っていない --------------------------
    #
    # ここは CLASS_READ を返していた。「何も言っていない」と書いた次の行で、
    # 一番安全に見える答えを名乗らせていた。3 モジュールでは 0 件だったので
    # 誰も気付かず、51 モジュールでは 177 件が落ちる——EWS3 の車台番号書込
    # (C_FG_AUFTRAG)、コーディング書込 (C_C_AUFTRAG)、MRS の CONTROLLER_RESET、
    # 引数を取らない ueb2.LOGIN。実車ゲート mayRun の最初の関門は
    # class == "read" なので、これは「分類できなかった」が「送ってよい」を
    # 意味していたということ。
    #
    # risk も medium ではなく high。何をするか言えないものの危険度を
    # 「中くらい」と申告する根拠がどこにも無い。
    c.cls, c.kind, c.audience, c.risk = CLASS_UNCLASSIFIED, "unknown", AUD_TECH, RISK_HIGH
    c.provenance = "name-heuristic"
    return _apply_override(n, c, argset, de)


# インジェクタ・点火コイル・スタータ・燃料ポンプ。エンジン稼働中に叩くのと
# 停止中に叩くのとでは意味がまったく違う。
#
# これは**どの分岐を通ったかに依らない**ジョブ自身の性質なので、分岐の中ではなく
# 出口で適用する。単発作動の分岐にだけ書いていたとき、`STEUERN_EKP`（燃料ポンプ
# リレー）は対ジョブ分岐で先に返ってしまい、medium / 電圧のみ、という判定に
# なっていた。開始と停止が別ジョブであることは、動かす対象の危険度とは無関係。
_HAZARDOUS_ACTUATOR = re.compile(r"^STEUERN_(EV|ZS)\d|^STEUERN_START$|^STEUERN_EKP", re.I)

_RAW_BIT_SLOT = re.compile(r"^ORT\d+$", re.I)


def _is_direct_actuation(comment: str, argset: set[str]) -> bool:
    """このジョブは生のアクチュエータビットを直接叩くか。

    **引数名では判定できない。** `STEUERN_DIGITAL`（電磁弁 15 枠）も
    `TRIG_SCHREIBEN`（車輪アドレスと閾値コード）も同じ `ORTn` という名前を
    使っており、後者は油圧を何一つ駆動しない。名前で判定すると、車輪速センサの
    閾値を書くジョブに「生ビットを直接駆動する」という嘘の注記が付く。

    判定できるのは SGBD 自身の記述である。`STEUERN_DIGITAL` のコメントは
    `Parameterliste: E oder W,EVVL,AVVL,...` と**弁を列挙している**。
    `TRIG_SCHREIBEN` のコメントは `TRIGGERSCHWELLEN SCHREIBEN DSC_E46` で、
    何も列挙していない。

    **`E_OR_W` を ON/OFF と読まないこと。** その `Parameterliste` の先頭にある
    `E oder W` は、DSC/ASCMK20 の `STEUERN_DIGITAL` の第 1 引数 `E_OR_W` のことで、
    引数コメントは `Einmal = E oder Wiederholung = W`——**一回か繰り返しか**である。
    ON/OFF ではないので、`stop_args={"E_OR_W": ...}` で止めることはできない。
    （`W` を渡すと繰り返し駆動になり、SGBD はその止め方を述べていない。）
    """
    if not any(_RAW_BIT_SLOT.match(a) for a in argset):
        return False
    return "parameterliste" in comment.lower()


# 駆動先が**表**で、その表を SGBD が列挙していないジョブ。
#
# `STEUERN_DIGITAL` / `STEUERN_IO` / `STEUERN_IO_STATUS` / `STEUERN_LIN_*` は、
# `ORT` / `ORT1..15` / `AUSGANG` という引数に「部品の名前」を取り、その名前の一覧は
# ECU の中の表にある。SGBD は一覧を持っていない——ZKE5 は逐語でこう言っている:
#
#   ! erlaubte Namen des Arguments 'ORT' ueber Tool XTRACT.exe
#   ! Aufruf 'XTRACT [-F] ZKE5.prg'
#
# **別のツールで調べろ、と書いてある。** つまりアプリは、このジョブが何を動かすかを
# 知ることができない。ZKE5 の表にはウィンドウとサンルーフとロックとミラーが入って
# いて、CVM_II の引数コメントは駆動先を "Ventil, Pumpe oder Heckscheibe" と述べている。
# 上限が分からない以上、上限の低い側に格付けはできない。
#
# `_is_direct_actuation`（DSC 油圧）と同じ論法を、ボディ系に広げたもの。あちらは
# コメントが弁を**列挙している**ことを根拠にしたが、こちらは列挙が**無い**ことが根拠
# である。実測 21 件。`TRIG_SCHREIBEN` は `ORTn` を持つが `Ansteuern` と述べないので
# 当たらない（当たると、車輪速センサの閾値書込が「アクチュエータ駆動」になる）。
#
# **引数名の表だけでは 2 件取り逃がしていた。** 後から実測して分かったもの:
#
#   lws5.STEUERN_DIGITAL   駆動先の引数が `ORT` ではなく `FUNKTION`。コメントは
#                          ZKE5 と一字一句同じ形で XTRACT を指している
#   szm46.STEUERN_IO       `IO_ID`（table IOStatus）と `IO_BYTE`（'EIN','AUS'）。
#                          動詞が `Ansteuern` ではなく `vorgeben`（値を押し込む）
#
# どちらも `medium / owner` で出ていた。名前の表は必ずこうなるので、**SGBD が自分で
# 引数を名指ししている場合はそちらを採る**——`erlaubte Namen des Arguments 'X' ueber
# Tool XTRACT.exe` は「その引数の取りうる値をここには書かない」という宣言そのもので、
# 我々が探している事実を SGBD が自分の言葉で述べている。実測 5 件、すべて該当。
#
# なお `radio.STEUERN_RADIO_SCHALTEN` も引数 `SCHALTMODUS` を table から取るが、
# **当たらないのが正しい**。動詞が `Ein-/Ausschalten des Radios` で、駆動先は
# 「ラジオ」と決まっており、引数が選ぶのは駆動先ではなくモードである。しかも同じ
# コメントが `$07 ShortTermAdjustment` と述べている（RADIO.json 全体で 1 箇所）。
_ACTUATOR_SLOT = re.compile(r"^(ORT\d*|AUSGANG|FUNKTION|IO_ID)$", re.I)
_ACTUATION_VERB_JOB = re.compile(r"ansteuer|vorgeb", re.I)
# SGBD が「この引数に何を渡せるかは別のツールで調べろ」と言っている箇所。
_XTRACT_ARG = re.compile(r"erlaubte\s+Namen\s+des\s+Arguments\s+'?([A-Z_0-9]+)'?", re.I)


def _drives_unbounded_set(comment: str, argset: set[str]) -> bool:
    c = comment or ""
    named = _XTRACT_ARG.search(c)
    if named and named.group(1).upper() in argset:
        return True
    if not any(_ACTUATOR_SLOT.match(a) for a in argset):
        return False
    return bool(_ACTUATION_VERB_JOB.search(c))


# IHKA の駆動は 2 ジョブの手続きであって、単発ではない。
#
# 38 ジョブ（IHKA46 / _2 / _3）のコメントが同じ 2 行を持つ:
#
#   Vor dem Ansteuern den Job DIAGNOSE_AUFRECHT aufrufen
#   Nach dem Ansteuern den Job DIAGNOSE_ENDE aufrufen
#
# そして相手側の 2 ジョブが自分で役割を名乗っている:
#
#   DIAGNOSE_AUFRECHT  "Diagnosemode aufrechterhalten / Vorbereitungsbefehl fuer Ansteuerbefehle"
#   DIAGNOSE_ENDE      "Diagnose beenden / **Beenden von Ansteuerbefehlen**"
#
# ——DIAGNOSE_ENDE が駆動指令を**終わらせる**。38 件すべてが
# `kind=pulse / termination=self`（「押せば終わる。終われば元に戻る」）として出て
# いたが、ECU の言い分はその逆で、別のジョブを送るまで出力は駆動されたままである。
# ブロワや補助ウォーターポンプが、リンクが切れても回り続ける形をしている。
#
# 推論ではない。3 つの SGBD が同じ文で述べていることを、そのまま持ってきている。
_IHKA_PAIRED = re.compile(r"DIAGNOSE_AUFRECHT", re.I)


def _apply_override(name: str, c: JobClassification, argset: set[str] | None = None,
                    comment: str = "") -> JobClassification:
    # 生ビットを直接叩けるジョブは、その部分集合しか駆動しないジョブより
    # 低く格付けされてはならない。
    #
    # `STEUERN_DIGITAL` は 8 個の電磁弁とポンプと予圧ポンプを任意の組合せで
    # 駆動でき、`medium / owner / pulse` だった。一方その**真部分集合**しか
    # 叩かない `DRUCKABBAU_VL`（AVVL 1 本）は `high / technician`。
    # 油圧系で最も強力なジョブが、最も緩い扱いを受けていたことになる。
    # 名前の規則ではなく引数の形から出しているので provenance は sgbd-args。
    if argset and _is_direct_actuation(comment, argset):
        c.risk = RISK_HIGH
        c.audience = AUD_TECH
        c.provenance = "sgbd-comment"
        for p in ("voltage_ok", "stationary"):
            if p not in c.preconditions:
                c.preconditions.append(p)
        if not c.note:
            c.note = ("drives raw actuator bits directly; a strict superset of what the "
                      "named hydraulic jobs drive")

    # 駆動先の表を SGBD が列挙していない（_drives_unbounded_set の注記）。
    if argset and _drives_unbounded_set(comment, argset):
        c.risk = RISK_HIGH
        c.audience = AUD_TECH
        c.provenance = "sgbd-comment"
        for p in ("voltage_ok", "stationary"):
            if p not in c.preconditions:
                c.preconditions.append(p)
        if not c.note:
            c.note = ("the component list for this job's target argument lives in the ECU, "
                      "not in the SGBD — what it drives cannot be bounded from here")

    # IHKA の 2 ジョブ手続き（_IHKA_PAIRED の注記）。
    if _IHKA_PAIRED.search(comment or ""):
        c.audience, c.risk = AUD_TECH, RISK_HIGH
        c.actor, c.termination = ACTOR_APP, TERM_COMPANION
        c.stop_job = "DIAGNOSE_ENDE"
        c.prerequisite_jobs = ["DIAGNOSE_AUFRECHT"]
        # 校正走行（STEUERN_EICHLAUF）は自分で終わる測定なので kind は動かさない。
        # 終わらせる必要があるのは駆動ではなく診断モードのほうで、それは stop_job が言う。
        if c.kind == "pulse":
            c.kind = "hold"
        c.provenance = "sgbd-comment"
        for p in ("voltage_ok",):
            if p not in c.preconditions:
                c.preconditions.append(p)

    if _HAZARDOUS_ACTUATOR.match(name):
        c.risk = RISK_HIGH
        for p in ("voltage_ok", "stationary", "engine_off"):
            if p not in c.preconditions:
                c.preconditions.append(p)

    ov = OVERRIDES.get(name)
    if not ov:
        return c
    for k, v in ov.items():
        setattr(c, k, v)
    # 既定は `authored`——上書きの大半は、SGBD が述べていないことを人が決めたものだから。
    # ただし**上書きが自分で来歴を名乗っているなら、それが勝つ**。SGBD の本文や引数を
    # 引いて書いた上書きまで「人が決めた」と記録するのは、根拠を一段弱く言うことになる。
    # 例: STEUERN_EWS4_SK は SGBD が "SK in das EWS4.3 Steuergeraet schreiben" と述べ、
    # 引数に 16 バイトの SecretKey と LOCK_SERVER_SK を並べている。
    c.provenance = ov.get("provenance", "authored")
    return c
