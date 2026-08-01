#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SGBD の結果コメントから数値の規定値を取り出す。

これがこのリポジトリで「調整値の範囲」を名乗れる唯一の出所である。全ダンプを
走査した結果、Min/Default/Max を書いているのは **SMG2 の `ADAPTIONSWERTE_LESEN`
だけ、44 件**。MSS54DS0 と DSC_E46 はゼロ。MSS54 の `BETRIEBSWTAB` には `RANGE`
列があるが 79 行すべて空。したがって「規定値なし」は MSS54/DSC にとって欠落では
なく事実であり、UI はそう表示しなければならない。

## `Default` は目標値ではない

`KUPPL_SCHLEIF_PKT_INK_WERT`（クラッチ食いつき点）は Min 72 / Default 97 / Max 227。
この値は **学習によって既定値から離れるのが正常**で、97 に戻っていることこそ
「まだ学習していない」の徴候になりうる。`Default` を「目標値」として描くと、
最も判断が要る値でちょうど嘘になる。フィールド名は `default` のままにし、
UI では「出荷既定」と訳す。合否は **Min..Max の範囲内かどうか**だけで出す。

## 実在する書式（7種）

    Min.: 72, Default: 97 Ink, Max.: 227
    Min.: 800, Default: 1002 mA, Max.: 1200
    Min.: -15,875, Default: 0 km/h Max.: 15,875        ← 独語小数コンマ、Max前カンマ無し
    Immer: 700 Nm                                       ← 範囲ではなく唯一の合法値
    Wertebereich: 0 - 524280 km   /   Wertebereich 0 - 31
    Hinweis: Differenz AK zu EK ist min.: 430 Ink, max.: 590
    Hinweis: Differenz AK zu EK ist min. 430 Ink, max.590   ← 同じ制約、句読点違い

## 誤マッチさせてはいけないもの

`...oder ausser Bereich` という定型文が 13 件ある。`Bereich` だけを見て拾うと
範囲が「ある」ことになり、範囲外判定が全件で誤る。語境界で `Wertebereich` に
限定し、`ausser` が直前にある場合を除外する。
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class ValueSpec:
    min: float | None = None
    max: float | None = None
    default: float | None = None
    always: float | None = None
    unit: str | None = None
    source: str = ""


@dataclass
class CrossFieldConstraint:
    """2つのフィールドの差に対する制約。

    `Hinweis: Differenz AK zu EK ist min.: 430 Ink, max.: 590` は
    `POS_EINKUP_WERT - POS_AUSKUP_WERT` の制約であって、どちらか一方の範囲では
    ない。片方の ValueSpec に押し込むと、そのフィールド単体の合否が嘘になる。
    """

    between: tuple[str, str]
    relation: str = "difference"
    min: float | None = None
    max: float | None = None
    unit: str | None = None
    source: str = ""


def _num(s: str) -> float:
    """独語表記の数値。小数点はコンマ、桁区切りは使われていない。"""
    return float(s.strip().replace(",", "."))


_N = r"[-+]?\d+(?:[.,]\d+)?"
# 単位は次のキーワードまで。`Ink` `mA` `km/h` `Nm` `mV` `(Ink)remente` などが来る。
_UNIT = r"(?:\s*\(?([A-Za-z][A-Za-z/^°]*)\)?[A-Za-z]*)?"

_MIN = re.compile(rf"\bmin\.?\s*:?\s*({_N})", re.I)
_MAX = re.compile(rf"\bmax\.?\s*:?\s*({_N})", re.I)
_DEFAULT = re.compile(rf"\bdefault\s*:?\s*({_N}){_UNIT}", re.I)
_ALWAYS = re.compile(rf"\bimmer\s*:?\s*({_N}){_UNIT}", re.I)
# `Wertebereich` に限定し、`ausser Bereich` を拾わない。
_RANGE = re.compile(rf"\bwertebereich\s*:?\s*({_N})\s*-\s*({_N}){_UNIT}", re.I)
_DIFF = re.compile(
    rf"differenz\s+(\w+)\s+zu\s+(\w+)\s+ist\s+min\.?\s*:?\s*({_N})"
    rf"{_UNIT}\s*,?\s*max\.?\s*:?\s*({_N})",
    re.I,
)


def parse_spec(comment: str) -> ValueSpec | None:
    """コメント1件 → ValueSpec。数値が1つも取れなければ None。"""
    if not comment:
        return None
    c = comment.replace("\n", " ")

    spec = ValueSpec(source=comment)

    m = _RANGE.search(c)
    if m:
        spec.min, spec.max = _num(m.group(1)), _num(m.group(2))
        spec.unit = m.group(3)
        return spec

    m = _ALWAYS.search(c)
    if m:
        spec.always = _num(m.group(1))
        spec.unit = m.group(2)
        # `Immer:` が付く値は Min/Default/Max も併記されることがある
        # (M_KUPPL_MAX_WERT: "Min.: 1, Default: 700 Nm, Max.: 1020 / Immer: 700 Nm")
        # ので、続けて拾う。

    # フィールド間制約の中の min/max は、その行のフィールド自身の範囲ではない。
    # 拾う前に取り除く。
    c_wo_diff = _DIFF.sub(" ", c)

    m = _DEFAULT.search(c_wo_diff)
    if m:
        spec.default = _num(m.group(1))
        spec.unit = spec.unit or m.group(2)
    m = _MIN.search(c_wo_diff)
    if m:
        spec.min = _num(m.group(1))
    m = _MAX.search(c_wo_diff)
    if m:
        spec.max = _num(m.group(1))

    # `max` だけの一致は範囲ではなく散文。実例:
    #   FS_LESEN.PRUEFCODE  "alle Pruefcodes, max. 1024 Byte"  ← バッファ長
    #   M_KUPPL_MAX_WERT    "max. uebertragbares Kupplungsmoment / Min.: 1, ..."
    #                        ← 前半は散文、後半が本物（数値を要求する正規表現が
    #                          前半を飛ばすので結果は正しいが、前半だけの行もある）
    # 上限だけを範囲として出すと「1024 バイト超は異常」のような検査が生まれる。
    # 下限か既定値のどちらかを伴って初めて範囲とみなす。`Wertebereich` は
    # 両端を明示するので上で早期 return しており、この判定に掛からない。
    if spec.min is None and spec.default is None and spec.always is None:
        return None
    return spec


def parse_cross_field(result_name: str, comment: str, resolve: dict[str, str]) -> CrossFieldConstraint | None:
    """`Hinweis: Differenz AK zu EK ist min.: 430 Ink, max.: 590` を制約にする。

    `resolve` は略号→結果名の対応（AK→POS_AUSKUP_WERT, EK→POS_EINKUP_WERT）。
    未知の略号は制約を作らない — 推測で2つのフィールドを結ぶと、無関係な値どうしを
    比較する検査が生まれる。
    """
    if not comment:
        return None
    m = _DIFF.search(comment.replace("\n", " "))
    if not m:
        return None
    a, b = m.group(1).upper(), m.group(2).upper()
    if a not in resolve or b not in resolve:
        return None
    return CrossFieldConstraint(
        # `Differenz AK zu EK` = AK からみた EK の差 = EK - AK
        between=(resolve[b], resolve[a]),
        min=_num(m.group(3)),
        max=_num(m.group(5)),
        unit=m.group(4),
        source=comment,
    )


# `Differenz AK zu EK` の略号。SMG2 のクラッチ位置。
CLUTCH_ABBREV = {
    "AK": "POS_AUSKUP_WERT",  # Auskuppelstellung
    "EK": "POS_EINKUP_WERT",  # Einkuppelstellung
}
