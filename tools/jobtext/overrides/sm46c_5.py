#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Seat memory, driver (convertible) の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


SM46C_5: dict[str, tuple[str, str]] = {
    'STEUERN_IO': (
        "シートが動きます（SLV/SHV/SNV/LNV = 前後・高さ・傾き・背もたれ、POS_1..3 = メモリ呼出, KHV = ヘッドレスト, EH = イージーエントリ）。シートに誰も座らず、後席の足元・シート下に物や手が無いことを確認してください。止めるには ORT1='STOP' を送ります。",
        "The seat moves (SLV/SHV/SNV/LNV = fore-aft, height, tilt, backrest; POS_1..3 = memory recall; KHV = head restraint, EH = easy entry). Nobody in the seat, nothing and no hands under it or behind it. Send ORT1='STOP' to halt.",
    ),
}
