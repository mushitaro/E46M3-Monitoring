#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CD changer の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


CDC_46: dict[str, tuple[str, str]] = {
    'STEUERGERAETE_RESET': (
        '制御ユニットが再起動します。数秒間、通信と機能が途切れます。',
        'The control unit reboots. Communication and function drop for a few seconds.',
    ),
}
