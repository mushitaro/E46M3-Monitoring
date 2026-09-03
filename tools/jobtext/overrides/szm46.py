#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Centre console switch centre SZM の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


SZM46: dict[str, tuple[str, str]] = {
    'STEUERN_IO': (
        "IO_ID 0x00〜0x09 はスイッチ入力の偽装（シートヒータ・サンブラインド・サラウンド・端子状態）、0x10〜0x17 は LED/出力。IO_BYTE は 'EIN'/'AUS'。サンブラインドを偽装するとブラインドが動きます。",
        "IO_ID 0x00-0x09 fakes switch inputs (seat heaters, sunblind, surround, terminal states); 0x10-0x17 are LEDs/outputs. IO_BYTE is 'EIN'/'AUS'. Faking the sunblind switch moves the blind.",
    ),
}
