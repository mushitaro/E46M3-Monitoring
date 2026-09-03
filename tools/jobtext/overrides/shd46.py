#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sunroof SHD の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


SHD46: dict[str, tuple[str, str]] = {
    'STEUERN_DIGITAL': (
        'サンルーフが動きます（SSHDH/SSHDZ/SSHDA = スイッチ偽装, TIPP_H/Z/A = ワンタッチ, RSHDZ = 閉リレー）。開口部に手・頭が無いことを確認し、EIN=0 で必ず戻すこと。',
        'The sunroof moves (SSHDH/SSHDZ/SSHDA fake the switch, TIPP_H/Z/A one-touch, RSHDZ the close relay). Keep hands and heads out of the opening and always release with EIN=0.',
    ),
}
