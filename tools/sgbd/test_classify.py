#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""classify.py の網羅性と、既知の誤分類が再発しないことの検査。

`python tools/sgbd/test_classify.py`
"""
from __future__ import annotations

import collections
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from sgbd import classify, model  # noqa: E402

DUMP = os.path.join(os.path.dirname(__file__), "..", "SgbdDump", "out")
SGBDS = ("MSS54DS0", "SMG2", "DSC_E46")
FAILS: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        FAILS.append(msg)


dumps = {s: model.load(DUMP, s) for s in SGBDS}
rows: dict[tuple[str, str], classify.JobClassification] = {}
for sgbd, d in dumps.items():
    for j in d.jobs:
        rows[(sgbd, j.name)] = classify.classify(sgbd, j.name, j.comment, [a.name for a in j.args])


def c(sgbd: str, job: str) -> classify.JobClassification:
    return rows[(sgbd, job)]


# --- 1. 全ジョブが分類され、各ファセットの合計が総数に一致する ---------------
# 192 件が消えたのは、分類できないものを黙って落としたから。落とさず
# `unknown` に入れる方針なので、合計は必ず一致しなければならない。
TOTAL = 323
check(len(rows) == TOTAL, f"expected {TOTAL} jobs, classified {len(rows)}")
for label, key in (("class", "cls"), ("audience", "audience"), ("system", "system"), ("kind", "kind")):
    ctr = collections.Counter(getattr(v, key) for v in rows.values())
    check(sum(ctr.values()) == TOTAL, f"{label} facet sums to {sum(ctr.values())}, not {TOTAL}")

# --- 2. `unknown` を無制限に許さない ----------------------------------------
# 不明であること自体は事実だが、増えたら気付く必要がある。
unknown_sys = [f"{s}.{j}" for (s, j), v in rows.items() if v.system == "unknown"]
unknown_kind = [f"{s}.{j}" for (s, j), v in rows.items() if v.kind == "unknown"]
check(not unknown_sys, f"jobs with no system: {unknown_sys}")
check(not unknown_kind, f"jobs with no operation kind: {unknown_kind}")

# --- 3. 旧生成器の誤分類が再発しないこと ------------------------------------
# 読取ジョブが「永続書込」側に置かれていた 5 件。
for sgbd, job in (
    ("MSS54DS0", "ABGLEICHWERTE_LESEN"),
    ("MSS54DS0", "ABGLEICHFLAG_LESEN"),
    ("SMG2", "GETRIEBEDATEN_LESEN"),
    ("SMG2", "ADAPTIONSWERTE_LESEN"),
    ("DSC_E46", "ABGLEICHWERTE_LESEN"),
):
    v = c(sgbd, job)
    check(v.cls == classify.CLASS_READ, f"{sgbd}.{job}: cls={v.cls}, expected read")
    check(v.kind == "read", f"{sgbd}.{job}: kind={v.kind}, expected read")
    check(v.risk == classify.RISK_LOW, f"{sgbd}.{job}: risk={v.risk}, expected low")
    check(v.irreversible is None, f"{sgbd}.{job}: a read must not be marked irreversible")

# 検査スタンプ書込は、同じ操作が PRUEFSTEMPEL_SCHREIBEN として除外されていた
# 一方で ID_SCHREIBEN として較正扱いで露出していた。
v = c("DSC_E46", "ID_SCHREIBEN")
check(v.cls == classify.CLASS_PROGRAMMING, f"ID_SCHREIBEN: cls={v.cls}, expected programming")

# 較正のためのセッション解錠。それ自体は較正しない。
v = c("MSS54DS0", "ABGLEICH_LOGIN_REQUEST")
check(v.cls == classify.CLASS_PROTOCOL, f"ABGLEICH_LOGIN_REQUEST: cls={v.cls}")

# --- 4. ラッチは止められない。STOP を出す根拠を与えてはいけない -------------
for job in ("DSC_SIM_VA", "DSC_SIM_HA", "DSC_SIM_VA3"):
    v = c("DSC_E46", job)
    check(v.kind == "latching", f"{job}: kind={v.kind}")
    check(v.termination == classify.TERM_NONE, f"{job}: termination={v.termination}")
    check(v.irreversible == "irr_latching", f"{job}: irreversible={v.irreversible}")
    check(v.stop_job is None, f"{job}: has a stop_job, but the SGBD exposes no release job")

# --- 5. SYSTEMCHECK は「開始 → 別ジョブで結果」------------------------------
# 対応は一様ではない。DMTL_ECOS には読み手が無く、LAUFUNRUHE には開始役が無い。
v = c("MSS54DS0", "START_SYSTEMCHECK_DMTL")
check(v.kind == "deferred", f"START_SYSTEMCHECK_DMTL: kind={v.kind}")
check(v.result_delivery == classify.DELIVER_COMPANION, f"...: delivery={v.result_delivery}")
check(v.result_job == "LESEN_SYSTEMCHECK_DMTL", f"...: result_job={v.result_job}")
check(c("MSS54DS0", "START_SYSTEMCHECK_DMTL_ECOS").result_job is None,
      "DMTL_ECOS has no reader in the SGBD; inventing one would send the wrong read")
check(c("MSS54DS0", "START_SYSTEMCHECK_SEK_LUFT").stop_job == "STOP_SYSTEMCHECK_SEK_LUFT",
      "SEK_LUFT is the only systemcheck with a stop job")

# --- 6. SMG II 試験プログラムの前提と停止 ------------------------------------
v = c("SMG2", "TESTPRG_STARTEN")
check(v.kind == "procedure", f"TESTPRG_STARTEN: kind={v.kind}")
check(v.prerequisite_jobs == ["TESTPRG_STOP"], f"...: prerequisites={v.prerequisite_jobs}")
# 進行状況はこのジョブ自身の再送で読む。以前ここには `STATUS_TESTPRG` と書いて
# あったが、SMG II の46ジョブにそんな名前は無い。SGBD が `TEST_STATUS_BYTE` の
# コメントで「Job solange anstossen, bis dieses Result ungleich 1 liefert!」と
# 明言しており、INPA の SMG2.IPO も同じことをしている。
check(v.stop_job == "TESTPRG_STOP" and v.result_job == "TESTPRG_STARTEN", f"...: {v.stop_job}/{v.result_job}")

# 停止が「同じジョブ＋別の引数」であるものは、引数値をジョブ名として出さない。
# `INAKTIV` は `STEUERART1` の値であって、ジョブではない。
v = c("SMG2", "STEUERN_STELLGLIED")
check(v.stop_job == "STEUERN_STELLGLIED", f"STEUERN_STELLGLIED: stop_job={v.stop_job}")
check(v.stop_args == {"STEUERART1": "INAKTIV"}, f"STEUERN_STELLGLIED: stop_args={v.stop_args}")

# **すべてのモジュールで**、名指しされたジョブは実在しなければならない。
# この不変条件が無かったので、`STATUS_TESTPRG` / `DIAGNOSE_ERHALTEN` / `INAKTIV`
# の3つが幻のまま出荷されていた。
for (sgbd_name, jid), cl in rows.items():
    known = {j for (s, j) in rows if s == sgbd_name}
    for ref, where in (
        *[(p, "prerequisite") for p in cl.prerequisite_jobs],
        (cl.stop_job, "stop"),
        (cl.result_job, "result"),
    ):
        if ref is None:
            continue
        check(ref in known, f"{sgbd_name}.{jid}: {where} job {ref!r} does not exist in this module")
check(v.ecu_timeout_sec == 10, f"...: ecu timeout={v.ecu_timeout_sec}")

# SGBD が前段ジョブを明言しているのは SMG2 だけ。他モジュールの同名ジョブに
# 規則を主張してはいけない。
v = c("SMG2", "STEUERN_STELLGLIED")
check(v.prerequisite_jobs == ["ANSTEUERUNG_VORBEREITEN"], f"SMG2 STEUERN_STELLGLIED: {v.prerequisite_jobs}")
check((v.ecu_timeout_sec, v.max_hold_sec) == (10, 60), f"...: {v.ecu_timeout_sec}/{v.max_hold_sec}")

# --- 7. リンク自身を壊すジョブに実行制御を与えない --------------------------
for sgbd, job in (("SMG2", "BAUDRATEN_UMSTELLUNG"), ("SMG2", "SET_EDIC_BAUDRATE")):
    v = c(sgbd, job)
    check(v.cls == classify.CLASS_PROGRAMMING, f"{job}: cls={v.cls}")
    check(v.audience == classify.AUD_PROTOCOL, f"{job}: audience={v.audience}")

# --- 8. 故障メモリ ----------------------------------------------------------
# 消去は書込。旧アプリが実車で到達できた唯一の書込がこれ。
v = c("MSS54DS0", "FS_LOESCHEN")
check(v.cls == classify.CLASS_CALIBRATION and v.kind == "write", f"FS_LOESCHEN: {v.cls}/{v.kind}")
check(v.risk == classify.RISK_HIGH and v.audience == classify.AUD_OWNER, f"FS_LOESCHEN: {v.risk}/{v.audience}")
check(c("MSS54DS0", "FS_LESEN").kind == "read", "FS_LESEN must be a read")
check(c("MSS54DS0", "FS_LESEN_TEXT").kind == "read", "FS_LESEN_TEXT must be a read")
check(c("DSC_E46", "FS_LESEN_KB90").kind == "read", "FS_LESEN_KB90 must be a read")
check(all(v.system == "faults" for (s, j), v in rows.items() if j.startswith("FS_")),
      "every FS_* job belongs to the faults system")

# --- 9. RAM 書換と EEPROM 書換を同じ扱いにしない ----------------------------
check(c("MSS54DS0", "CO_EINZELABGLEICH_VERSTELLEN").cls == classify.CLASS_CALIBRATION,
      "CO_EINZELABGLEICH_VERSTELLEN writes RAM only")
v = c("MSS54DS0", "CO_EINZELABGLEICH_PROGRAMMIEREN")
check(v.cls == classify.CLASS_PROGRAMMING and v.irreversible == "irr_eeprom",
      f"CO_EINZELABGLEICH_PROGRAMMIEREN: {v.cls}/{v.irreversible}")

# --- 10. インジェクタ・点火コイル・スタータ・燃料ポンプはエンジン停止が要る --
for job in ("STEUERN_EV1", "STEUERN_ZS8", "STEUERN_START", "STEUERN_EKP"):
    v = c("MSS54DS0", job)
    check(v.risk == classify.RISK_HIGH, f"{job}: risk={v.risk}")
    check("engine_off" in v.preconditions, f"{job}: preconditions={v.preconditions}")

# --- 11. 生ビットを直接叩くジョブは、その部分集合より緩く扱わない ------------
# `STEUERN_DIGITAL` は 8 電磁弁＋ポンプ＋予圧ポンプを任意の組合せで駆動できる
# のに medium/owner だった。その **真部分集合**（AVVL 1 本）しか叩かない
# `DRUCKABBAU_VL` は high/technician。最も強力なものが最も緩かった。
dig = c("DSC_E46", "STEUERN_DIGITAL")
sub = c("DSC_E46", "DRUCKABBAU_VL")
check(dig.risk == classify.RISK_HIGH, f"STEUERN_DIGITAL: risk={dig.risk}")
check(dig.audience == classify.AUD_TECH, f"STEUERN_DIGITAL: audience={dig.audience}")
check(dig.provenance == "sgbd-comment", f"STEUERN_DIGITAL: provenance={dig.provenance}")
check("stationary" in dig.preconditions, f"STEUERN_DIGITAL: {dig.preconditions}")
check((dig.risk, dig.audience) == (sub.risk, sub.audience),
      f"superset {dig.risk}/{dig.audience} vs subset {sub.risk}/{sub.audience}")

# 反例。`TRIG_SCHREIBEN` は同じ `ORTn` という引数名を使うが、中身は車輪アドレスと
# トリガ閾値であって電磁弁ではない——油圧を一切駆動しない。引数名で判定していた
# 版はここに「生ビットを直接駆動する」という嘘の注記を付けていた。判定できるのは
# SGBD のコメントが弁を列挙しているか否かだけである。
trig = c("DSC_E46", "TRIG_SCHREIBEN")
check(trig.note is None or "raw actuator bits" not in trig.note,
      f"TRIG_SCHREIBEN must not be called a direct actuation: {trig.note}")
check(trig.audience == classify.AUD_OWNER,
      f"TRIG_SCHREIBEN must keep its own audience, not the valve rule's: {trig.audience}")

# --- 11b. コメント散文から起こした引数の選択肢が、逐語のとおりであること ------
# SGBD が値を表ではなく引数コメントの文章に書いている引数は全 323 ジョブ中 4 つ。
# ここを取りこぼすと、UI は自由入力欄を出し、値が存在することすら見えなくなる
# ——`ADAPTIONSWERTE_LESEN` の引数 2 がまさにそうなっていた。
# 逆に取りすぎると嘘の選択肢が出る。`ADAPTIONSWERT_LOESCHEN` のコメント後半の
# "Hinweis:" 2 行がその罠で、選択肢に化けていないことをここで固定する。
import gen_ecu_data as _gen  # noqa: E402  (tools/ is already on sys.path)


def _arg_comment(sgbd: str, job: str, arg: str) -> str:
    for j in dumps[sgbd].jobs:
        if j.name == job:
            for a in j.args:
                if a.name == arg:
                    return a.comment
    return ""


EXPECTED_COMMENT_OPTIONS = {
    ("SMG2", "ADAPTIONSWERTE_LESEN", "ADAPTION_LESEN"): [
        ("0", "Adaptionswerte Kupplung lesen"),
        ("1", "Adaptionswerte Getriebe lesen"),
        ("2", "Getriebedaten lesen"),
    ],
    ("SMG2", "ADAPTIONSWERTE_LOESCHEN", "ADAPTIONSWERT_LOESCHEN"): [
        ("0", "Kupplungskennlinie loeschen"),
        ("1", "Getriebedaten loeschen"),
    ],
    ("SMG2", "CODIERDATEN_SCHREIBEN", "AKTIVIERUNG"): [("0", "inaktiv"), ("1", "aktiv")],
    ("SMG2", "CODIERDATEN_SCHREIBEN", "CODIERUNG"): [("ROLLENBETRIEB", ""), ("RADABRISS", "")],
}

for (sgbd, job, arg), expected in EXPECTED_COMMENT_OPTIONS.items():
    picked = _gen.comment_options(job, arg, _arg_comment(sgbd, job, arg))
    check(picked is not None, f"{job}.{arg}: no options parsed from the comment")
    if picked:
        got = [(o["value"], o.get("note", "")) for o in picked[0]]
        check(got == expected, f"{job}.{arg}: {got!r} != {expected!r}")
        check("table" not in picked[1], f"{job}.{arg}: must not name a table it did not read")

# コメントから起こしていない引数に対しては何も作らないこと。
check(_gen.comment_options("FS_LESEN", "IRGENDWAS", "Argument: 0 / Argument: 1") is None,
      "comment_options must only fire on the four (job, arg) pairs named above")

# その 4 つが本当に「表を持たない enum」の全部であること。ここが増えたら、
# 新しい引数が自由入力欄のまま出荷されようとしている。
uncovered = []
for sgbd, d in dumps.items():
    for j in d.jobs:
        for a in j.args:
            if a.kind != model.ARG_ENUM:
                continue
            if _gen.arg_options(d, j.name, a.name):
                continue
            if (sgbd, j.name, a.name) in EXPECTED_COMMENT_OPTIONS:
                continue
            uncovered.append(f"{sgbd}.{j.name}.{a.name}")
check(not uncovered, f"enum args with no options at all: {uncovered}")

# --- 11c. 引数 2 に名前付き結果が 1 つも紐づかないこと ------------------------
# 「2 にも何か割り当たるはずだ」と書いた `^(HEX_GETRIEBEDATEN|GETRIEBE)` は
# 0 件一致だった。0 件一致の規則は網羅しているように読めて、実際は当て推量。
_smg2 = dumps["SMG2"]
_adapt = next(j for j in _smg2.jobs if j.name == "ADAPTIONSWERTE_LESEN")
_two = [r.name for r in _adapt.results if r.when_arg and "2" in r.when_arg[1]]
check(not _two, f"ADAPTION_LESEN=2 must bind no named result, got {_two}")
check(any(r.name == "DATEN" and not r.when_arg for r in _adapt.results),
      "DATEN must be always-returned — it is all that argument 2 delivers")

# --- 12. 読取に前提条件も不可逆マークも付かないこと --------------------------
for (s, j), v in rows.items():
    if v.cls == classify.CLASS_READ:
        check(v.irreversible is None, f"{s}.{j}: a read is marked irreversible")
        check(v.termination == classify.TERM_SELF, f"{s}.{j}: a read must terminate by itself")

if FAILS:
    print(f"FAIL ({len(FAILS)})")
    for f in FAILS:
        print("  -", f)
    sys.exit(1)

by_class = collections.Counter(v.cls for v in rows.values())
by_aud = collections.Counter(v.audience for v in rows.values())
print(f"ok - {len(rows)} jobs, no unknowns")
print(f"   class:    {dict(by_class.most_common())}")
print(f"   audience: {dict(by_aud.most_common())}")
