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
CLASS_PROGRAMMING = "programming"  # フラッシュ／EEPROM／検査スタンプ。WinKFP 領域
CLASS_PROTOCOL = "protocol"        # 他ジョブの手順の一部。単体では意味を持たない

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
    (r"GETRIEBE|GANG|SCHALT|WAEHL|SMG|TESTPRG|STELLGLIED|ANSTEUERUNG", "gearbox"),
    # DSC の STEUERN_DIGITAL は 8 個の電磁弁とポンプを駆動する。SGBD テーブル
    # `STEUERN` が EVVL/AVVL/EVVR/... のビット割当を持っており、ブレーキ油圧系。
    # 機械翻訳が「デジタル」と訳して中身を隠していたのがこのジョブ。
    (r"DRUCK|BREMS|ABS|PUMPEN|ENTLUEFT|DSC_SIM|NA_|^STEUERN_DIGITAL", "brakes"),
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
    (r"ADAPT|ABGLEICH|INITIALISIER|SG_RESET|CO_EINZEL", "engine"),
    # 燃料補正(ADD/INT/MUL/LFR)、充填率(RF)、負荷、車速・回転数の上限記録
    (r"MOTOR|DREHZAHL|FAHRZEUG|GESCHWIND|^STATUS_(ADD|INT|MUL|LFR|RF|LAST|VMAX|NMAX|"
     r"TNMAX|V_CAN|PUMG|DME|N_LL)", "engine"),
]


def system_of(job: str) -> str:
    for pat, sys_ in SYSTEMS:
        if re.search(pat, job, re.I):
            return sys_
    return "unknown"


# ---------------------------------------------------------------------------
# 個別上書き。パターンで直らないもの
# ---------------------------------------------------------------------------

OVERRIDES: dict[str, dict] = {
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


def classify(sgbd: str, job: str, comment: str, args: list[str]) -> JobClassification:
    """1ジョブを分類する。`args` は引数名の大文字リスト。"""
    n = job.upper()
    de = (comment or "").lower()
    argset = {a.upper() for a in args}

    c = JobClassification(
        cls=CLASS_READ, audience=AUD_OWNER, system=system_of(n), risk=RISK_MED,
        actor=ACTOR_ECU, termination=TERM_SELF, result_delivery=DELIVER_INLINE,
        kind="unknown",
    )

    # --- プロトコル部品 ---------------------------------------------------
    if PROTOCOL_JOBS.match(n):
        c.cls, c.audience, c.kind, c.risk = CLASS_PROTOCOL, AUD_PROTOCOL, "read", RISK_LOW
        c.provenance = "name-heuristic"
        return _apply_override(n, c, argset, de)

    # --- 書換系（WinKFP 領域）---------------------------------------------
    if re.match(r"^(FLASH|SPEICHER_SCHREIBEN|AIF_SCHREIBEN|PRUEFSTEMPEL|ZIF_BACKUP)", n):
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
    if re.search(r"_LESEN(_|$)|^STATUS|^LESEN_|^SYS_ADR|^ECU_CONFIG$|^ABGAS_VARIANTE", n):
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
        c.actor, c.termination, c.result_delivery = ACTOR_ECU, TERM_COMPANION, DELIVER_COMPANION
        c.stop_job, c.result_job = "TESTPRG_STOP", "STATUS_TESTPRG"
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
        c.stop_job = "INAKTIV"
        c.ecu_timeout_sec, c.max_hold_sec = SMG2_ECU_TIMEOUT_SEC, SMG2_MAX_HOLD_SEC
        c.preconditions = ["voltage_ok", "stationary"]
        c.provenance = "sgbd-comment"
        return _apply_override(n, c, argset, de)
    if n == "ANSTEUERUNG_VORBEREITEN":
        c.cls, c.kind, c.audience, c.risk = CLASS_PROTOCOL, "pulse", AUD_PROTOCOL, RISK_LOW
        c.provenance = "sgbd-comment"
        return _apply_override(n, c, argset, de)

    # --- ラッチ: 作動して保持、解除ジョブ無し ------------------------------
    if n.startswith("DSC_SIM_"):
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
    if "PIN_NUMMER" in argset:
        c.cls, c.kind, c.audience, c.risk = CLASS_TEST, "hold", AUD_TECH, RISK_HIGH
        c.actor, c.termination = ACTOR_APP, TERM_APP_STOP
        c.stop_job, c.irreversible = job, "irr_pin"
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
    c.cls, c.kind, c.audience, c.risk = CLASS_READ, "unknown", AUD_TECH, RISK_MED
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
    """
    if not any(_RAW_BIT_SLOT.match(a) for a in argset):
        return False
    return "parameterliste" in comment.lower()


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
    c.provenance = "authored"
    return c
