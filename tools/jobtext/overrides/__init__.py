#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""手書きのジョブ説明。テンプレート生成の上に被せる。

## どれを手で書くのか

1. **`class` が calibration / programming のもの（全49件）** — 生成器が強制する。
   「失敗したら何を疑うか」が総称文で済むなら、それは書いていないのと同じ。
   車の状態を恒久的に変える操作でそれをやるのは怠慢である。
2. **DSC の較正10件** — テンプレートが原理的に効かない。SGBD のコメントが
   `DRUCKSENSOR_DSC_ABGLEICHEN` と `QUERBESCHLEUNIGUNGSSENSOR_DSC_ABGLEICHEN` で
   どちらも `"Default init job"`、`ABGLEICH_DSC_SENSOREN` と
   `ABGLEICH_LWS_AQ_SENSOREN` に至っては**完全に同一の文字列**。
   部品×動作で回すと、違うジョブに同じ説明が出る。
3. **SYSTEMCHECK 11件** — 現行アプリで完全に不可視だったもの。二次空気・
   タンクリーク・DMTL・TEV は、オーナーが車検と警告灯で実際に困る項目そのもの。
4. **DSC 油圧13件** — ブレーキモジュレータを駆動する。SGBD 自身が
   「ポンプは自動停止しない・最大60秒・100barでリリーフ弁が開きポンプが劣化する」
   と警告している。

各値は `(ja, en)` のタプル。スロット名は gen_jobtext.SLOTS と `caution`。
"""
from __future__ import annotations

from .mss54 import MSS54
from .smg2 import SMG2
from .dsc_mk60 import DSC_MK60

OVERRIDES: dict[str, dict[str, dict[str, tuple[str, str]]]] = {
    "mss54": MSS54,
    "smg2": SMG2,
    "dsc_mk60": DSC_MK60,
}
