#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Seat memory, passenger の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations

from ._shared import _SM_IO_EN, _SM_IO_JA

B_SM46_4: dict[str, tuple[str, str]] = {
    'STEUERN_IO': (
        _SM_IO_JA,
        _SM_IO_EN,
    ),
}
