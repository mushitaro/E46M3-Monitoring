#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""個体ごとの注意文。`cautions.py` の族の表より優先される。

族の一般論で足りるものはここに書かない——`STEUERN_EV1..8` の8本は同じ危険を
共有しているので、8回書けば8箇所のうち1箇所だけ直す事故を招くだけである。

ここに書くのは、族の文では言い足りない個体だけ。
"""
from __future__ import annotations

from .mss54 import MSS54
from .smg2 import SMG2
from .dsc_mk60 import DSC_MK60

OVERRIDES: dict[str, dict[str, tuple[str, str]]] = {
    "mss54": MSS54,
    "smg2": SMG2,
    "dsc_mk60": DSC_MK60,
}
