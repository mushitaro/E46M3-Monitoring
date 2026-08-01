#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SGBD ダンプ → 型付きレコード。

ここが持つのは「ダンプに何が書いてあるか」の解釈だけで、
「そのジョブが危険か」「オーナーに見せるか」といった判断は `classify.py` が持つ。

## 結果(_RESULTS)の扱いで押さえるべき3点

1. **`_EINH` / `_TEXT` は独立した結果ではなく、値の付属物**。
   `STAT_MOTORDREHZAHL_WERT` / `_EINH` / `_TEXT` は論理的に1行。
   旧生成器は `n.endswith(('_EINH','_TEXT'))` で両方を捨てていたが、
   `_TEXT` は **ECU 自身が返す平文の判定文**（例:
   `LESEN_SYSTEMCHECK_DMTL_TEXT`）で、データセット中もっともオーナー向け
   価値が高い。捨ててよいのは表示位置の問題であって存在ではない。

2. **`JOB_STATUS` は 2311 結果中 317 を占める配管**。TELEGRAMM_ANF/ANT や
   `_AUFTRAG*`/`_ANTWORT*`/`_TEL_*` も同様。役割を付けて分離しないと、
   「ジョブの中身を漏れなく出す」が「配管を9割出す」になる。

3. **結果は引数条件付きのことがある**。SMG2 `ADAPTIONSWERTE_LESEN` は 216 結果を
   宣言するが、引数 `ADAPTION_LESEN` が 0=クラッチ / 1=変速機 / 2=変速機データ に
   分割する（コメントに独語で書いてあるだけで機械可読ではない）。
   分割を推測した場合は必ず `provenance='inferred'` を付け、UI が
   「これは推測だ」と言えるようにする。
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Iterable

# ---------------------------------------------------------------------------
# 結果のロール
# ---------------------------------------------------------------------------

ROLE_VALUE = "value"        # 測定値・保存値。オーナーに見せる本体
ROLE_UNIT = "unit"          # *_EINH。ECU が実行時に埋める単位
ROLE_TEXT = "text"          # *_TEXT。ECU 自身が返す平文
ROLE_STATUS = "status"      # JOB_STATUS。呼び出しが成功したか
ROLE_TELEGRAM = "telegram"  # 送受信フレームのエコー
ROLE_RAW = "raw"            # DATEN / BINAER_BUFFER 等の生バッファ

_STATUS_NAMES = {"JOB_STATUS", "JOBSTATUS"}
_RAW_NAMES = {"DATEN", "BINAER_BUFFER", "HEX_GETRIEBEDATEN", "ID_DATEN"}
_TELEGRAM_RE = re.compile(
    r"^(TELEGRAMM_(ANF|ANT)|_?(AUFTRAG|ANTWORT)\d*|_TEL_(ANFRAGE|ANTWORT))$", re.I
)


def result_role(name: str) -> str:
    """結果名 → ロール。名前だけで決まる（SGBD は型でも区別しない）。"""
    n = name.upper()
    if n in _STATUS_NAMES:
        return ROLE_STATUS
    if _TELEGRAM_RE.match(n):
        return ROLE_TELEGRAM
    if n in _RAW_NAMES:
        return ROLE_RAW
    if n.endswith("_EINH"):
        return ROLE_UNIT
    if n.endswith("_TEXT"):
        return ROLE_TEXT
    return ROLE_VALUE


def value_of(name: str, siblings: set[str]) -> str | None:
    """`_EINH` / `_TEXT` が修飾している値結果を、同じジョブの結果名から解決する。

    語尾を落とすだけでは足りない。実データの分布（全2311結果を走査）:

        _EINH -> _WERT   414    RAM_LESEN_EINH      -> RAM_LESEN_WERT
        _TEXT -> _WERT   101    F_UW1_TEXT          -> F_UW1_WERT
        _EINH -> bare     35    EVAN_VERSTELLZEIT_FRUEH_EINH -> ..._FRUEH
        _TEXT -> _NR      28    F_ORT_TEXT          -> F_ORT_NR
        _TEXT -> bare      1
        対応なし          11

    `F_ORT_TEXT` の値は `F_ORT` ではなく `F_ORT_NR` である。語尾落としだけで
    決め打ちすると 554 件が存在しない相手を指す。
    """
    n = name
    for suffix in ("_EINH", "_TEXT"):
        if not n.upper().endswith(suffix):
            continue
        base = n[: -len(suffix)]
        for cand in (base + "_WERT", base + "_NR", base):
            if cand != n and cand in siblings:
                return cand
        return None
    return None


# ---------------------------------------------------------------------------
# 引数の種別
# ---------------------------------------------------------------------------

ARG_ENUM = "enum"            # SGBD が取りうる値を列挙している
ARG_BYTE = "byte"
ARG_INT = "int"
ARG_HEX_STRING = "hexString"  # "Adresse,Datenbyte: Bsp.: 0A,1B"
ARG_BLOB = "blob"
ARG_JOB_REF = "jobRef"        # TESTPRG_NR のように別表の番号を指す


def arg_kind(name: str, type_: str, comment: str) -> str:
    """引数名・型・コメントから入力の性質を決める。

    UI が自由入力欄ではなく本物のコントロールを出せるかどうかがここで決まる。
    列挙が取れるのは 323 ジョブ中 46 が引数を持ち、そのうち 12 だけ。
    """
    n = name.upper()
    c = (comment or "").lower()
    t = (type_ or "").lower()

    if n in ("TESTPRG_NR", "STELLGL"):
        return ARG_JOB_REF
    # コメント中に "0 = ...", "Argument: 0" のような対応表があるか
    if re.search(r"\b\d+\s*[:=]\s*\S", c) or "argument:" in c:
        return ARG_ENUM
    if "hex_string" in c or "hex string" in c or re.search(r"bsp\.?:\s*[0-9a-f]{2},", c):
        return ARG_HEX_STRING
    if "binaer" in t or "binary" in t or "blob" in t:
        return ARG_BLOB
    if n.endswith("_ANZAHL") or "int" in t:
        return ARG_INT
    return ARG_BYTE


# ---------------------------------------------------------------------------
# 引数による結果の分割
# ---------------------------------------------------------------------------

# SMG2 ADAPTIONSWERTE_LESEN のみに存在する分割。
# コメント: "Adaptionswerte Kupplung lesen, Argument: 0 /
#            Adaptionswerte Getriebe lesen, Argument: 1 /
#            Getriebedaten lesen, Argument: 2"
# SGBD は結果側にこの対応を持たないため、名前の接頭辞から推測するしかない。
# 推測であることは provenance で明示し、UI に出す。
_ARG_PARTITIONS: dict[tuple[str, str], dict[str, list[str]]] = {
    ("SMG2", "ADAPTIONSWERTE_LESEN"): {
        # 0 = クラッチ。弁の零電流特性(ADAPT_SMIN/SMAX/IMIN/IMAX)、過負荷回数、
        #     食いつき点、位置、キャリブレーション曲線 K1..K10 / 位置制御 P0..P5。
        "0": [r"^(KUPPL|I_NULL_VENT_KUPPL|UEBERDECKUNG_VENT_KUPPL|ZAHL_KUPPL|"
              r"POS_EINKUP|POS_AUSKUP|NULLPUNKT_KUPPL|"
              r"ADAPT_K\d|ADAPT_P\d|ADAPT_[SI](MIN|MAX)|M_KUPPL|T_KL1\d|OFF_A_LONG)"],
        # 1 = 変速機。シフト経路・セレクト角・各ギア窓・最大シフト力での変速回数、
        #     および軸速度差。
        "1": [r"^(SW_|WW_|ANSCHLAG_SW|POS_SW|OFF_I_WW|OFF_WWSPUR|OFF_SCHALTWEGSPUR|"
              r"KORR_WW|KORR_SW|ANZ_SCHALT|DIFF_V_ACHS|ADAPT_G|GANG|ANZ_RENNSTART)"],
        "2": [r"^(HEX_GETRIEBEDATEN|GETRIEBE)"],
    },
}


def partition_for(sgbd: str, job: str, result: str) -> tuple[str, list[str]] | None:
    """(引数名, その結果が返る引数値のリスト) または None（常に返る）。"""
    table = _ARG_PARTITIONS.get((sgbd.upper(), job.upper()))
    if not table:
        return None
    arg = "ADAPTION_LESEN"
    hits = [v for v, pats in table.items() if any(re.match(p, result, re.I) for p in pats)]
    return (arg, hits) if hits else None


# ---------------------------------------------------------------------------
# レコード
# ---------------------------------------------------------------------------


@dataclass
class SgbdResult:
    name: str
    type: str
    comment: str
    role: str
    value_of: str | None = None
    when_arg: tuple[str, list[str]] | None = None


@dataclass
class SgbdArg:
    name: str
    type: str
    comment: str
    kind: str


@dataclass
class SgbdJob:
    name: str
    comment: str
    args: list[SgbdArg] = field(default_factory=list)
    results: list[SgbdResult] = field(default_factory=list)

    def results_by_role(self, role: str) -> list[SgbdResult]:
        return [r for r in self.results if r.role == role]


@dataclass
class SgbdTable:
    """SGBD 内部テーブル。1行目が列名、以降がデータ行。"""

    name: str
    columns: list[str]
    rows: list[list[str]]

    def dicts(self) -> list[dict[str, str]]:
        return [dict(zip(self.columns, r)) for r in self.rows]


@dataclass
class SgbdDump:
    sgbd: str
    job_count: int
    jobs: list[SgbdJob]
    tables: dict[str, SgbdTable]
    sha256: str

    def job(self, name: str) -> SgbdJob | None:
        return next((j for j in self.jobs if j.name.upper() == name.upper()), None)

    def table(self, name: str) -> SgbdTable | None:
        return self.tables.get(name.upper())


def load(dump_dir: str, sgbd: str) -> SgbdDump:
    """ダンプを読み、ロール・種別・分割を解決したレコードにする。

    `jobCount` と実際のジョブ数の不一致はここで即座に落とす。旧生成器はこの
    表明を持たず、323 ジョブ中 192 が黙って消えていた。
    """
    import hashlib

    path = os.path.join(dump_dir, sgbd + ".json")
    blob = open(path, "rb").read()
    d = json.loads(blob.decode("utf-8"))

    if d["jobCount"] != len(d["jobs"]):
        raise SystemExit(
            f"{sgbd}: jobCount={d['jobCount']} but {len(d['jobs'])} jobs in the dump. "
            "Re-run tools/SgbdDump; do not generate from a partial dump."
        )

    jobs: list[SgbdJob] = []
    for j in d["jobs"]:
        args = [
            SgbdArg(
                name=a["name"],
                type=a.get("type", ""),
                comment=a.get("comment", ""),
                kind=arg_kind(a["name"], a.get("type", ""), a.get("comment", "")),
            )
            for a in (j.get("args") or [])
        ]
        raw_results = j.get("results") or []
        siblings = {r["name"] for r in raw_results}
        results = []
        for r in raw_results:
            role = result_role(r["name"])
            target = value_of(r["name"], siblings) if role in (ROLE_UNIT, ROLE_TEXT) else None
            # 修飾すべき値が同じジョブに無い `_TEXT` は、付属物ではなく **それ自体が値**。
            # `FS_LESEN_TEXT.F_ORT_TEXT`（故障箇所の名前だけを返すジョブ）や
            # `STATUS_SYNC_MODE_TEXT` がそれで、ECU が返す平文そのものが答えになる。
            # 付属物として扱うと、そのジョブの唯一の中身が「単位欄」に落ちる。
            if role == ROLE_TEXT and target is None:
                role = ROLE_VALUE
            results.append(
                SgbdResult(
                    name=r["name"],
                    type=r.get("type", ""),
                    comment=r.get("comment", ""),
                    role=role,
                    value_of=target,
                    when_arg=partition_for(sgbd, j["job"], r["name"]),
                )
            )
        jobs.append(SgbdJob(name=j["job"], comment=j.get("comment", ""), args=args, results=results))

    tables = {}
    for name, rows in (d.get("tables") or {}).items():
        if not rows:
            continue
        tables[name.upper()] = SgbdTable(name=name, columns=rows[0], rows=rows[1:])

    return SgbdDump(
        sgbd=d["sgbd"],
        job_count=d["jobCount"],
        jobs=jobs,
        tables=tables,
        sha256=hashlib.sha256(blob).hexdigest(),
    )


def load_all(dump_dir: str, sgbds: Iterable[str]) -> dict[str, SgbdDump]:
    return {s: load(dump_dir, s) for s in sgbds}
