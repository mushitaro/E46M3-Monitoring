#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Xenon left の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


XENON_L: dict[str, tuple[str, str]] = {
    'ADAPTIVWERT_LOESCHEN': (
        '交換した部品に対応する適応値だけを消します。引数は WECHSEL_LAMPE / WECHSEL_ZUENDMODUL / WECHSEL_STEUERGERAET のいずれか。交換していないのに消さないこと。',
        'Clears only the adaptive value for the part you replaced. Argument is WECHSEL_LAMPE / WECHSEL_ZUENDMODUL / WECHSEL_STEUERGERAET. Do not clear it for a part that was not replaced.',
    ),
}
